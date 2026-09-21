-- =============================================================================
-- Migration 062: Advanced Finance, Bank Reconciliation, Credit/Debit Notes, Refunds & GST Foundation
-- Maintenance Management ERP — Phase 11 Advanced Finance
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Document Types & Period Status Enum Extensions
-- ---------------------------------------------------------------------------
ALTER TYPE public.period_status ADD VALUE IF NOT EXISTS 'review';

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'TRF';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'STMT';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'REC';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'DBN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'SCN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'REF';

-- ---------------------------------------------------------------------------
-- 2. Chart of Accounts & Period Enhancements
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chart_of_accounts' AND column_name = 'account_sub_type'
  ) THEN
    ALTER TABLE public.chart_of_accounts
      ADD COLUMN account_sub_type text NOT NULL DEFAULT 'operating',
      ADD COLUMN is_system boolean NOT NULL DEFAULT false,
      ADD COLUMN is_reconciled boolean NOT NULL DEFAULT false,
      ADD COLUMN depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0);
  END IF;
END $$;

-- Prevent Deletion of System Accounts or Accounts with Transaction History
CREATE OR REPLACE FUNCTION public.trg_guard_chart_of_accounts_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lines_count integer;
  v_children_count integer;
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System accounts cannot be deleted (Account ID: %, Code: %)', OLD.id, OLD.account_code;
  END IF;

  SELECT count(*) INTO v_lines_count
  FROM public.journal_lines
  WHERE account_id = OLD.id;

  IF v_lines_count > 0 THEN
    RAISE EXCEPTION 'Account cannot be deleted because it has % posted journal lines (Account ID: %)', v_lines_count, OLD.id;
  END IF;

  SELECT count(*) INTO v_children_count
  FROM public.chart_of_accounts
  WHERE parent_account_id = OLD.id;

  IF v_children_count > 0 THEN
    RAISE EXCEPTION 'Account cannot be deleted because it has % child sub-accounts (Account ID: %)', v_children_count, OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_guard_delete ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_guard_delete
  BEFORE DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_chart_of_accounts_delete();

-- Stored procedure to reopen a closed/locked financial period
CREATE OR REPLACE FUNCTION public.reopen_accounting_period(
  p_period_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period record;
BEGIN
  SELECT * INTO v_period
  FROM public.accounting_periods
  WHERE id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;

  IF v_period.status = 'open' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Period is already open', 'status', 'open');
  END IF;

  UPDATE public.accounting_periods
  SET status = 'open',
      closed_at = NULL,
      closed_by = NULL,
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE id = p_period_id;

  -- Insert audit log entry
  INSERT INTO public.audit_logs (
    company_id, user_id, action, entity_name, entity_id, old_data, new_data
  ) VALUES (
    v_period.company_id,
    p_user_id,
    'UPDATE'::public.audit_action,
    'accounting_periods',
    p_period_id,
    jsonb_build_object('status', v_period.status),
    jsonb_build_object('status', 'open', 'reopen_reason', p_reason, 'reopened_at', now())
  );

  RETURN jsonb_build_object(
    'success', true,
    'period_id', p_period_id,
    'previous_status', v_period.status,
    'status', 'open',
    'reopened_by', p_user_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Bank Accounts Extensions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bank_accounts' AND column_name = 'account_number_full'
  ) THEN
    ALTER TABLE public.bank_accounts
      ADD COLUMN account_number_full text,
      ADD COLUMN ifsc_code text,
      ADD COLUMN swift_code text,
      ADD COLUMN routing_number text,
      ADD COLUMN branch_name text,
      ADD COLUMN account_type text NOT NULL DEFAULT 'current',
      ADD COLUMN statement_balance numeric(14,3) NOT NULL DEFAULT 0.000,
      ADD COLUMN cleared_balance numeric(14,3) NOT NULL DEFAULT 0.000,
      ADD COLUMN last_reconciled_date date;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Bank Statement Imports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  bank_account_id     uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  batch_number        text          NOT NULL,
  provider_type       text          NOT NULL DEFAULT 'csv', -- 'csv', 'manual', 'camt053', 'ofx'
  file_name           text,
  status              text          NOT NULL DEFAULT 'imported' CHECK (status IN ('pending', 'parsed', 'imported', 'reconciled', 'failed')),
  total_lines         integer       NOT NULL DEFAULT 0 CHECK (total_lines >= 0),
  total_debit         numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (total_debit >= 0),
  total_credit        numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (total_credit >= 0),
  opening_balance     numeric(14,3),
  closing_balance     numeric(14,3),
  raw_data            jsonb,
  created_by          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_imports_batch
  ON public.bank_statement_imports (company_id, batch_number);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_account
  ON public.bank_statement_imports (bank_account_id, status);

CREATE TRIGGER set_bank_statement_imports_updated_at
  BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('bank_statement_imports');

-- ---------------------------------------------------------------------------
-- 5. Bank Transactions (Imported / Clearing Lines)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  bank_account_id       uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  statement_import_id   uuid          REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  transaction_date      date          NOT NULL,
  value_date            date,
  transaction_type      text          NOT NULL CHECK (transaction_type IN ('debit', 'credit')),
  amount                numeric(14,3) NOT NULL CHECK (amount > 0),
  balance_after         numeric(14,3),
  description           text          NOT NULL,
  reference_number      text,
  payee_payer           text,
  reconciliation_status text          NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN ('UNMATCHED', 'MATCHED', 'PARTIALLY_MATCHED', 'RECONCILED', 'IGNORED')),
  matched_entity_type   text, -- 'customer_payment', 'supplier_payment', 'expense', 'journal_entry', 'bank_transfer'
  matched_entity_id     uuid,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date
  ON public.bank_transactions (bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciliation
  ON public.bank_transactions (bank_account_id, reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_ref
  ON public.bank_transactions (company_id, reference_number);

CREATE TRIGGER set_bank_transactions_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('bank_transactions');

-- ---------------------------------------------------------------------------
-- 6. Bank Reconciliation Sessions & Matches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_sessions (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  bank_account_id             uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  session_number              text          NOT NULL,
  statement_date              date          NOT NULL,
  statement_opening_balance   numeric(14,3) NOT NULL,
  statement_closing_balance   numeric(14,3) NOT NULL,
  cleared_balance             numeric(14,3) NOT NULL DEFAULT 0.000,
  system_opening_balance      numeric(14,3) NOT NULL DEFAULT 0.000,
  system_closing_balance      numeric(14,3) NOT NULL DEFAULT 0.000,
  uncleared_debits            numeric(14,3) NOT NULL DEFAULT 0.000,
  uncleared_credits           numeric(14,3) NOT NULL DEFAULT 0.000,
  difference                  numeric(14,3) NOT NULL DEFAULT 0.000,
  status                      text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'reconciled', 'cancelled')),
  reconciled_at               timestamptz,
  reconciled_by               uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                       text,
  created_by                  uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_sessions_number
  ON public.bank_reconciliation_sessions (company_id, session_number);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_account
  ON public.bank_reconciliation_sessions (bank_account_id, status);

CREATE TRIGGER set_bank_reconciliation_sessions_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_sessions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('bank_reconciliation_sessions');

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_matches (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id            uuid          NOT NULL REFERENCES public.bank_reconciliation_sessions(id) ON DELETE CASCADE,
  bank_transaction_id   uuid          NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  matched_entity_type   text          NOT NULL, -- 'customer_payment', 'supplier_payment', 'expense', 'journal_entry', 'bank_transfer'
  matched_entity_id     uuid          NOT NULL,
  matched_amount        numeric(14,3) NOT NULL CHECK (matched_amount > 0),
  match_type            text          NOT NULL DEFAULT 'manual' CHECK (match_type IN ('exact', 'auto', 'manual')),
  notes                 text,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_matches_session
  ON public.bank_reconciliation_matches (session_id);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_matches_tx
  ON public.bank_reconciliation_matches (bank_transaction_id);

-- ---------------------------------------------------------------------------
-- 7. Bank Transfers (Inter-Account Transfers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_transfers (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transfer_number       text          NOT NULL,
  source_account_id     uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  destination_account_id uuid         NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  transfer_date         date          NOT NULL DEFAULT CURRENT_DATE,
  amount                numeric(14,3) NOT NULL CHECK (amount > 0),
  transfer_fee          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (transfer_fee >= 0),
  fee_account_id        uuid          REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  exchange_rate         numeric(12,6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate > 0),
  reference_number      text,
  status                text          NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'cancelled')),
  gl_journal_entry_id   uuid          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes                 text,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_transfers_different_accounts CHECK (source_account_id <> destination_account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transfers_company_number
  ON public.bank_transfers (company_id, transfer_number);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_source
  ON public.bank_transfers (source_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_dest
  ON public.bank_transfers (destination_account_id);

CREATE TRIGGER set_bank_transfers_updated_at
  BEFORE UPDATE ON public.bank_transfers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('bank_transfers');

-- ---------------------------------------------------------------------------
-- 8. Customer Credit Notes Extensions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_notes' AND column_name = 'credit_note_type'
  ) THEN
    ALTER TABLE public.credit_notes
      ADD COLUMN credit_note_type text NOT NULL DEFAULT 'sales_return',
      ADD COLUMN refunded_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (refunded_amount >= 0),
      ADD COLUMN tax_snapshot jsonb,
      ADD COLUMN applied_invoices jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_note_lines' AND column_name = 'cgst_rate'
  ) THEN
    ALTER TABLE public.credit_note_lines
      ADD COLUMN cgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (cgst_rate >= 0),
      ADD COLUMN cgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (cgst_amount >= 0),
      ADD COLUMN sgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (sgst_rate >= 0),
      ADD COLUMN sgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (sgst_amount >= 0),
      ADD COLUMN igst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (igst_rate >= 0),
      ADD COLUMN igst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (igst_amount >= 0),
      ADD COLUMN hsn_sac_code text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Debit Notes (Customer & Supplier Adjustments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debit_notes (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  party_type            text          NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  customer_id           uuid          REFERENCES public.customers(id) ON DELETE RESTRICT,
  supplier_id           uuid          REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  debit_note_number     text          NOT NULL,
  reference_invoice_id  uuid          REFERENCES public.invoices(id) ON DELETE SET NULL,
  reference_bill_id     uuid          REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
  debit_note_date       date          NOT NULL DEFAULT CURRENT_DATE,
  currency              text          NOT NULL DEFAULT 'INR',
  subtotal              numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  tax_amount            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total           numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (grand_total > 0),
  amount_paid           numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (amount_paid >= 0),
  amount_due            numeric(14,3) GENERATED ALWAYS AS (grand_total - amount_paid) STORED,
  reason                text          NOT NULL,
  status                text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'posted', 'paid', 'cancelled')),
  is_posted_to_gl       boolean       NOT NULL DEFAULT false,
  gl_journal_entry_id   uuid          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  tax_snapshot          jsonb,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_debit_note_party CHECK (
    (party_type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
    (party_type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_debit_notes_company_number
  ON public.debit_notes (company_id, debit_note_number);

CREATE INDEX IF NOT EXISTS idx_debit_notes_party
  ON public.debit_notes (company_id, party_type, status);

CREATE TRIGGER set_debit_notes_updated_at
  BEFORE UPDATE ON public.debit_notes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('debit_notes');

CREATE TABLE IF NOT EXISTS public.debit_note_lines (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  debit_note_id         uuid          NOT NULL REFERENCES public.debit_notes(id) ON DELETE CASCADE,
  item_id               uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description           text          NOT NULL,
  quantity              numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price            numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  tax_rate              numeric(5,2)  NOT NULL DEFAULT 0.00,
  cgst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  cgst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  sgst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  sgst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  igst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  igst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  hsn_sac_code          text,
  line_total            numeric(14,3) NOT NULL CHECK (line_total >= 0),
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debit_note_lines_note
  ON public.debit_note_lines (debit_note_id);

-- ---------------------------------------------------------------------------
-- 10. Supplier Credit Notes (Vendor Purchase Returns & Adjustments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_credit_notes (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  supplier_id           uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  bill_id               uuid          REFERENCES public.supplier_bills(id) ON DELETE RESTRICT,
  po_id                 uuid          REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  credit_note_number    text          NOT NULL,
  vendor_credit_note_number text,
  credit_note_date      date          NOT NULL DEFAULT CURRENT_DATE,
  currency              text          NOT NULL DEFAULT 'INR',
  subtotal              numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  tax_amount            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total           numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (grand_total > 0),
  amount_applied        numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (amount_applied >= 0),
  refunded_amount       numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (refunded_amount >= 0),
  amount_remaining      numeric(14,3) GENERATED ALWAYS AS (grand_total - amount_applied - refunded_amount) STORED,
  reason                text          NOT NULL,
  status                text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'applied', 'refunded', 'cancelled')),
  is_posted_to_gl       boolean       NOT NULL DEFAULT false,
  gl_journal_entry_id   uuid          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  tax_snapshot          jsonb,
  applied_bills         jsonb         NOT NULL DEFAULT '[]'::jsonb,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_credit_applied_bounds CHECK ((amount_applied + refunded_amount) <= grand_total)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credit_notes_number
  ON public.supplier_credit_notes (company_id, credit_note_number);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_bill
  ON public.supplier_credit_notes (bill_id);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_supplier
  ON public.supplier_credit_notes (supplier_id, status);

CREATE TRIGGER set_supplier_credit_notes_updated_at
  BEFORE UPDATE ON public.supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('supplier_credit_notes');

CREATE TABLE IF NOT EXISTS public.supplier_credit_note_lines (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_credit_note_id uuid        NOT NULL REFERENCES public.supplier_credit_notes(id) ON DELETE CASCADE,
  item_id               uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description           text          NOT NULL,
  quantity              numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price            numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  tax_rate              numeric(5,2)  NOT NULL DEFAULT 0.00,
  cgst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  cgst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  sgst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  sgst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  igst_rate             numeric(5,2)  NOT NULL DEFAULT 0.00,
  igst_amount           numeric(14,3) NOT NULL DEFAULT 0.000,
  hsn_sac_code          text,
  line_total            numeric(14,3) NOT NULL CHECK (line_total >= 0),
  expense_account_id    uuid          REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_lines_note
  ON public.supplier_credit_note_lines (supplier_credit_note_id);

-- ---------------------------------------------------------------------------
-- 11. Financial Refunds (Customer & Supplier Disbursements)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_refunds (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  refund_number         text          NOT NULL,
  refund_type           text          NOT NULL CHECK (refund_type IN ('customer_refund', 'supplier_refund')),
  party_id              uuid          NOT NULL, -- customer_id or supplier_id
  source_type           text          NOT NULL CHECK (source_type IN ('credit_note', 'advance_payment', 'overpayment')),
  source_id             uuid          NOT NULL, -- credit_note_id or payment_id / supplier_payment_id
  bank_account_id       uuid          NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  refund_date           date          NOT NULL DEFAULT CURRENT_DATE,
  currency              text          NOT NULL DEFAULT 'INR',
  amount                numeric(14,3) NOT NULL CHECK (amount > 0),
  payment_method        text          NOT NULL DEFAULT 'bank_transfer',
  reference_number      text,
  reason                text          NOT NULL,
  status                text          NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'approved', 'completed', 'failed', 'cancelled')),
  is_posted_to_gl       boolean       NOT NULL DEFAULT false,
  gl_journal_entry_id   uuid          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  idempotency_key       text,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_refunds_company_number
  ON public.financial_refunds (company_id, refund_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_refunds_idempotency
  ON public.financial_refunds (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_refunds_party
  ON public.financial_refunds (company_id, refund_type, party_id);

CREATE TRIGGER set_financial_refunds_updated_at
  BEFORE UPDATE ON public.financial_refunds
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('financial_refunds');

-- ---------------------------------------------------------------------------
-- 12. Tax Profiles & HSN/SAC Code Master
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_profiles (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type           text          NOT NULL CHECK (entity_type IN ('company', 'customer', 'supplier')),
  entity_id             uuid          NOT NULL,
  gstin                 text,
  legal_name            text          NOT NULL,
  trade_name            text,
  pan_number            text,
  state_code            text          NOT NULL, -- e.g. '27', '29', '07'
  state_name            text          NOT NULL,
  registration_type     text          NOT NULL DEFAULT 'regular' CHECK (registration_type IN ('regular', 'composition', 'consumer', 'unregistered', 'sez', 'overseas')),
  place_of_supply_state text,
  is_rcm_applicable     boolean       NOT NULL DEFAULT false,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_profiles_entity
  ON public.tax_profiles (company_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_tax_profiles_gstin
  ON public.tax_profiles (company_id, gstin) WHERE gstin IS NOT NULL;

CREATE TRIGGER set_tax_profiles_updated_at
  BEFORE UPDATE ON public.tax_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('tax_profiles');

CREATE TABLE IF NOT EXISTS public.hsn_sac_codes (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                  text          NOT NULL, -- '998717', '8415', etc.
  description           text          NOT NULL,
  code_type             text          NOT NULL CHECK (code_type IN ('goods', 'services')),
  gst_rate              numeric(5,2)  NOT NULL DEFAULT 18.00 CHECK (gst_rate >= 0),
  cgst_rate             numeric(5,2)  NOT NULL DEFAULT 9.00 CHECK (cgst_rate >= 0),
  sgst_rate             numeric(5,2)  NOT NULL DEFAULT 9.00 CHECK (sgst_rate >= 0),
  igst_rate             numeric(5,2)  NOT NULL DEFAULT 18.00 CHECK (igst_rate >= 0),
  cess_rate             numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (cess_rate >= 0),
  is_active             boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hsn_sac_codes_company_code
  ON public.hsn_sac_codes (company_id, code);

CREATE INDEX IF NOT EXISTS idx_hsn_sac_codes_lookup
  ON public.hsn_sac_codes (company_id, is_active);

CREATE TRIGGER set_hsn_sac_codes_updated_at
  BEFORE UPDATE ON public.hsn_sac_codes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('hsn_sac_codes');

-- Add tax_snapshot to invoices & supplier_bills
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'tax_snapshot'
  ) THEN
    ALTER TABLE public.invoices
      ADD COLUMN tax_snapshot jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_bills' AND column_name = 'tax_snapshot'
  ) THEN
    ALTER TABLE public.supplier_bills
      ADD COLUMN tax_snapshot jsonb;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. Enable RLS on all newly created tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hsn_sac_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_statement_imports_tenant_isolation" ON public.bank_statement_imports
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "bank_transactions_tenant_isolation" ON public.bank_transactions
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "bank_reconciliation_sessions_tenant_isolation" ON public.bank_reconciliation_sessions
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "bank_reconciliation_matches_tenant_isolation" ON public.bank_reconciliation_matches
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "bank_transfers_tenant_isolation" ON public.bank_transfers
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "debit_notes_tenant_isolation" ON public.debit_notes
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "debit_note_lines_tenant_isolation" ON public.debit_note_lines
  FOR ALL USING (
    debit_note_id IN (SELECT id FROM public.debit_notes WHERE company_id = public.get_current_company_id())
  );

CREATE POLICY "supplier_credit_notes_tenant_isolation" ON public.supplier_credit_notes
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "supplier_credit_note_lines_tenant_isolation" ON public.supplier_credit_note_lines
  FOR ALL USING (
    supplier_credit_note_id IN (SELECT id FROM public.supplier_credit_notes WHERE company_id = public.get_current_company_id())
  );

CREATE POLICY "financial_refunds_tenant_isolation" ON public.financial_refunds
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "tax_profiles_tenant_isolation" ON public.tax_profiles
  FOR ALL USING (company_id = public.get_current_company_id());

CREATE POLICY "hsn_sac_codes_tenant_isolation" ON public.hsn_sac_codes
  FOR ALL USING (company_id = public.get_current_company_id());
