-- =============================================================================
-- Migration 052: Bank Reconciliation Foundation & Expiry/Notification Triggers
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. Bank reconciliation staging (batches, statement lines, matching status)
--   2. view_bank_reconciliation_summary
--   3. check_and_enqueue_expiry_notifications() (Queues AMC & Rental expiry alerts via enqueue_job)

-- ---------------------------------------------------------------------------
-- 1. Table: bank_reconciliation_batches
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_reconciliation_batches (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id   uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  statement_date    date          NOT NULL,
  opening_balance   numeric(14,3) NOT NULL,
  closing_balance   numeric(14,3) NOT NULL,
  status            text          NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'reconciled', 'cancelled'
  reconciled_by     uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  reconciled_at     timestamptz,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_recon_account ON public.bank_reconciliation_batches (bank_account_id, statement_date);

CREATE TRIGGER set_bank_recon_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_batches
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 2. Table: bank_statement_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_statement_lines (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid          NOT NULL REFERENCES public.bank_reconciliation_batches(id) ON DELETE CASCADE,
  line_date             date          NOT NULL,
  description           text          NOT NULL,
  reference_number      text,
  withdrawal_amount     numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (withdrawal_amount >= 0),
  deposit_amount        numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (deposit_amount >= 0),
  match_status          text          NOT NULL DEFAULT 'unmatched', -- 'unmatched', 'matched', 'partially_matched', 'reconciled'
  matched_journal_id    uuid          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  matched_payment_id    uuid          REFERENCES public.payments(id) ON DELETE SET NULL,
  matched_at            timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_statement_line_amounts CHECK (NOT (withdrawal_amount > 0 AND deposit_amount > 0)),
  CONSTRAINT chk_statement_line_nonzero CHECK (withdrawal_amount > 0 OR deposit_amount > 0)
);

CREATE INDEX idx_bank_statement_lines_batch ON public.bank_statement_lines (batch_id, match_status);

-- Enable RLS on Bank Reconciliation
ALTER TABLE public.bank_reconciliation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines         ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_recon_policy ON public.bank_reconciliation_batches
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

CREATE POLICY bank_stmt_lines_policy ON public.bank_statement_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.bank_reconciliation_batches brb
      WHERE brb.id = bank_statement_lines.batch_id
        AND public.is_company_member(brb.company_id)
        AND (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. View: view_bank_reconciliation_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_bank_reconciliation_summary
WITH (security_invoker = true)
AS
SELECT
  brb.id as batch_id,
  brb.company_id,
  ba.id as bank_account_id,
  ba.account_name,
  ba.bank_name,
  ba.currency,
  brb.statement_date,
  brb.opening_balance,
  brb.closing_balance,
  brb.status as reconciliation_status,
  COUNT(bsl.id) as total_statement_lines,
  COUNT(bsl.id) FILTER (WHERE bsl.match_status = 'reconciled' OR bsl.match_status = 'matched') as matched_lines,
  COUNT(bsl.id) FILTER (WHERE bsl.match_status = 'unmatched') as unmatched_lines,
  COALESCE(SUM(bsl.deposit_amount), 0.000) as total_deposits,
  COALESCE(SUM(bsl.withdrawal_amount), 0.000) as total_withdrawals
FROM public.bank_reconciliation_batches brb
JOIN public.bank_accounts ba ON ba.id = brb.bank_account_id
LEFT JOIN public.bank_statement_lines bsl ON bsl.batch_id = brb.id
GROUP BY brb.id, brb.company_id, ba.id, ba.account_name, ba.bank_name, ba.currency,
         brb.statement_date, brb.opening_balance, brb.closing_balance, brb.status;

COMMENT ON VIEW public.view_bank_reconciliation_summary IS 'Summary of bank statement reconciliation batches and matched progress.';

-- ---------------------------------------------------------------------------
-- 4. Procedure: check_and_enqueue_expiry_notifications()
-- ---------------------------------------------------------------------------
-- Scheduled worker function: Enqueues alerts for expiring AMCs, due visits, and overdue rentals
CREATE OR REPLACE FUNCTION public.check_and_enqueue_expiry_notifications(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_amc RECORD;
  v_rental RECORD;
  v_inv RECORD;
  v_enqueued integer := 0;
BEGIN
  -- 1. AMC Contracts expiring in 30 days
  FOR v_amc IN
    SELECT id, contract_number, customer_id, end_date
    FROM public.amc_contracts
    WHERE company_id = p_company_id
      AND status = 'active'
      AND end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
  LOOP
    PERFORM public.enqueue_job(
      'notifications',
      jsonb_build_object(
        'event_type', 'amc_expiring_soon',
        'amc_contract_id', v_amc.id,
        'contract_number', v_amc.contract_number,
        'customer_id', v_amc.customer_id,
        'end_date', v_amc.end_date
      ),
      now(),
      p_company_id
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  -- 2. Overdue Rental Contracts
  FOR v_rental IN
    SELECT id, contract_number, customer_id, expected_return_date
    FROM public.rental_contracts
    WHERE company_id = p_company_id
      AND status = 'active'
      AND expected_return_date < CURRENT_DATE
  LOOP
    PERFORM public.enqueue_job(
      'notifications',
      jsonb_build_object(
        'event_type', 'rental_return_overdue',
        'rental_contract_id', v_rental.id,
        'contract_number', v_rental.contract_number,
        'customer_id', v_rental.customer_id,
        'expected_return_date', v_rental.expected_return_date
      ),
      now(),
      p_company_id
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  -- 3. Overdue Invoices
  FOR v_inv IN
    SELECT id, invoice_number, customer_id, due_date, amount_due
    FROM public.invoices
    WHERE company_id = p_company_id
      AND status IN ('issued', 'partially_paid')
      AND due_date < CURRENT_DATE
  LOOP
    PERFORM public.enqueue_job(
      'notifications',
      jsonb_build_object(
        'event_type', 'invoice_overdue_alert',
        'invoice_id', v_inv.id,
        'invoice_number', v_inv.invoice_number,
        'customer_id', v_inv.customer_id,
        'due_date', v_inv.due_date,
        'amount_due', v_inv.amount_due
      ),
      now(),
      p_company_id
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'notifications_enqueued', v_enqueued
  );
END;
$$;
