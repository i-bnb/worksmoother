-- =============================================================================
-- Migration 054: Accounting Settings, Financial Periods, Statements & Controls
-- Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
-- =============================================================================
-- Features:
--   1. Accounting configuration extensions on settings table
--   2. financial_category_mappings table (Operational categories -> Chart of Accounts)
--   3. Fiscal year calculation engine (e.g. April 1 - March 31 for India)
--   4. Financial period validation & control procedures (close_period, lock_period)
--   5. Expense approval workflow with self-approval guards
--   6. Chronological Customer Statement RPC (AR with opening/closing balances)
--   7. Chronological Supplier Statement RPC (AP with opening/closing balances)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status ENUM Extensions
-- ---------------------------------------------------------------------------
ALTER TYPE public.expense_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE public.expense_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ---------------------------------------------------------------------------
-- 2. Extend settings with Accounting Configurations
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'fiscal_year_start_month'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN fiscal_year_start_month integer NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month >= 1 AND fiscal_year_start_month <= 12),
      ADD COLUMN accounting_base_currency text NOT NULL DEFAULT 'INR',
      ADD COLUMN decimal_precision integer NOT NULL DEFAULT 3 CHECK (decimal_precision >= 2 AND decimal_precision <= 4),
      ADD COLUMN default_payment_terms text NOT NULL DEFAULT 'Net 30',
      ADD COLUMN default_due_days integer NOT NULL DEFAULT 30 CHECK (default_due_days >= 0),
      ADD COLUMN allow_future_dated_transactions boolean NOT NULL DEFAULT false,
      ADD COLUMN allow_self_expense_approval boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Table: financial_category_mappings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_category_mappings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category_code   text        NOT NULL, -- 'SERVICE_REVENUE', 'PARTS_COST', 'LABOR_COST', 'TRAVEL_EXPENSE', etc.
  account_id      uuid        NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  description     text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_cat_mapping_company_code
  ON public.financial_category_mappings (company_id, category_code);

CREATE INDEX IF NOT EXISTS idx_fin_cat_mapping_lookup
  ON public.financial_category_mappings (company_id, is_active);

CREATE TRIGGER set_financial_category_mappings_updated_at
  BEFORE UPDATE ON public.financial_category_mappings
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.financial_category_mappings IS 'Maps operational business transaction categories directly to Chart of Accounts records.';

SELECT public.attach_audit_trigger('financial_category_mappings');

-- ---------------------------------------------------------------------------
-- 4. Function: get_fiscal_year()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fiscal_year(
  p_company_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start_month integer := 4;
  v_date date := COALESCE(p_date, CURRENT_DATE);
  v_month integer;
  v_year integer;
  v_start_year integer;
  v_end_year integer;
BEGIN
  SELECT fiscal_year_start_month INTO v_start_month
  FROM public.settings
  WHERE company_id = p_company_id;

  v_start_month := COALESCE(v_start_month, 4);
  v_month := EXTRACT(MONTH FROM v_date)::integer;
  v_year := EXTRACT(YEAR FROM v_date)::integer;

  IF v_start_month = 1 THEN
    -- Calendar year fiscal year
    RETURN v_year::text;
  END IF;

  IF v_month >= v_start_month THEN
    v_start_year := v_year;
    v_end_year := v_year + 1;
  ELSE
    v_start_year := v_year - 1;
    v_end_year := v_year;
  END IF;

  RETURN v_start_year::text || '-' || v_end_year::text;
END;
$$;

COMMENT ON FUNCTION public.get_fiscal_year(uuid, date)
IS 'Computes the standard fiscal year string (e.g. 2026-2027) based on company fiscal year start month setting.';

-- ---------------------------------------------------------------------------
-- 5. Function: validate_financial_period()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_financial_period(
  p_company_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_allow_future boolean := false;
BEGIN
  SELECT allow_future_dated_transactions INTO v_allow_future
  FROM public.settings
  WHERE company_id = p_company_id;

  IF NOT COALESCE(v_allow_future, false) AND p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Future-dated financial transactions are not permitted by company settings'
      USING ERRCODE = '22000';
  END IF;

  SELECT id, status, period_name INTO v_period
  FROM public.accounting_periods
  WHERE company_id = p_company_id
    AND p_date >= start_date AND p_date <= end_date
  LIMIT 1;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'No financial accounting period found for transaction date %', p_date
      USING ERRCODE = '22000';
  END IF;

  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'Financial period "%" is %: transaction creation and posting are restricted.',
      v_period.period_name, v_period.status
      USING ERRCODE = '22000';
  END IF;

  RETURN v_period.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: close_accounting_period() and lock_accounting_period()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_accounting_period(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  SELECT * INTO v_period FROM public.accounting_periods WHERE id = p_period_id FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Accounting period % not found', p_period_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.has_role(v_period.company_id, 'accountant') OR public.has_role(v_period.company_id, 'owner_admin')) THEN
    RAISE EXCEPTION 'Unauthorized: Only accountants or administrators can close accounting periods' USING ERRCODE = '42501';
  END IF;

  IF v_period.status = 'locked' THEN
    RAISE EXCEPTION 'Period % is already locked and cannot be modified', v_period.period_name USING ERRCODE = '22000';
  END IF;

  UPDATE public.accounting_periods
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_period_id;

  RETURN jsonb_build_object('success', true, 'period_id', p_period_id, 'status', 'closed');
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_accounting_period(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  SELECT * INTO v_period FROM public.accounting_periods WHERE id = p_period_id FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Accounting period % not found', p_period_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_role(v_period.company_id, 'owner_admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only organization administrators can permanently lock accounting periods' USING ERRCODE = '42501';
  END IF;

  UPDATE public.accounting_periods
  SET status = 'locked',
      locked_at = now(),
      locked_by = auth.uid(),
      updated_at = now()
  WHERE id = p_period_id;

  RETURN jsonb_build_object('success', true, 'period_id', p_period_id, 'status', 'locked');
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: approve_expense() (with self-approval guard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exp RECORD;
  v_allow_self boolean := false;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;

  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_exp.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- Only operations manager, accountant or owner_admin can approve expenses
  IF NOT (
    public.has_role(v_exp.company_id, 'operations_manager') OR
    public.has_role(v_exp.company_id, 'accountant') OR
    public.has_role(v_exp.company_id, 'owner_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not possess expense approval authority' USING ERRCODE = '42501';
  END IF;

  -- Self-approval guard
  SELECT allow_self_expense_approval INTO v_allow_self
  FROM public.settings
  WHERE company_id = v_exp.company_id;

  IF v_exp.created_by = auth.uid() AND NOT COALESCE(v_allow_self, false) THEN
    RAISE EXCEPTION 'Self-approval of expenses is prohibited by organization policy' USING ERRCODE = '42501';
  END IF;

  IF v_exp.status <> 'submitted' AND v_exp.status <> 'draft' THEN
    RAISE EXCEPTION 'Expense % is in status % and cannot be approved', v_exp.expense_number, v_exp.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.expenses
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  WHERE id = p_expense_id;

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', p_expense_id,
    'expense_number', v_exp.expense_number,
    'status', 'approved'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: pay_expense()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_expense(
  p_expense_id uuid,
  p_payment_method text DEFAULT 'bank_transfer',
  p_bank_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exp RECORD;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;

  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_exp.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_exp.status <> 'approved' THEN
    RAISE EXCEPTION 'Expense % is in status %, only approved expenses can be paid', v_exp.expense_number, v_exp.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.expenses
  SET status = 'paid',
      updated_at = now()
  WHERE id = p_expense_id;

  -- Automatically post to general ledger if not already posted
  PERFORM public.post_expense_to_gl(p_expense_id);

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', p_expense_id,
    'expense_number', v_exp.expense_number,
    'status', 'paid',
    'amount', v_exp.amount
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: get_customer_statement()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cust RECORD;
  v_opening_inv numeric(14,3) := 0.000;
  v_opening_pay numeric(14,3) := 0.000;
  v_opening_cn numeric(14,3) := 0.000;
  v_opening_bal numeric(14,3) := 0.000;
  v_running_bal numeric(14,3) := 0.000;
  v_tx_list jsonb := '[]'::jsonb;
  v_rec RECORD;
BEGIN
  SELECT id, company_id, name, code INTO v_cust
  FROM public.customers WHERE id = p_customer_id;

  IF v_cust.id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- 1. Calculate opening balance before p_from_date
  SELECT COALESCE(sum(grand_total), 0.000) INTO v_opening_inv
  FROM public.invoices
  WHERE customer_id = p_customer_id
    AND invoice_date < p_from_date
    AND status NOT IN ('cancelled', 'void');

  SELECT COALESCE(sum(pa.allocated_amount), 0.000) INTO v_opening_pay
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.id = pa.payment_id
  WHERE p.customer_id = p_customer_id
    AND p.payment_date < p_from_date
    AND p.status NOT IN ('cancelled', 'reversed');

  SELECT COALESCE(sum(grand_total), 0.000) INTO v_opening_cn
  FROM public.credit_notes
  WHERE customer_id = p_customer_id
    AND credit_note_date < p_from_date
    AND status NOT IN ('cancelled');

  v_opening_bal := round(v_opening_inv - v_opening_pay - v_opening_cn, 3);
  v_running_bal := v_opening_bal;

  -- 2. Fetch and order transactions within range
  FOR v_rec IN
    WITH combined_tx AS (
      -- Invoices (Dr to customer)
      SELECT
        invoice_date as tx_date,
        'invoice' as tx_type,
        invoice_number as document_number,
        'Commercial Invoice' as description,
        grand_total as debit,
        0.000 as credit,
        id as document_id
      FROM public.invoices
      WHERE customer_id = p_customer_id
        AND invoice_date >= p_from_date AND invoice_date <= p_to_date
        AND status NOT IN ('cancelled', 'void')

      UNION ALL

      -- Payments (Cr to customer)
      SELECT
        p.payment_date as tx_date,
        'payment' as tx_type,
        p.payment_number as document_number,
        concat('Customer Payment (', p.payment_method, ')') as description,
        0.000 as debit,
        pa.allocated_amount as credit,
        p.id as document_id
      FROM public.payment_allocations pa
      JOIN public.payments p ON p.id = pa.payment_id
      WHERE p.customer_id = p_customer_id
        AND p.payment_date >= p_from_date AND p.payment_date <= p_to_date
        AND p.status NOT IN ('cancelled', 'reversed')

      UNION ALL

      -- Credit Notes (Cr to customer)
      SELECT
        credit_note_date as tx_date,
        'credit_note' as tx_type,
        credit_note_number as document_number,
        'Commercial Credit Note' as description,
        0.000 as debit,
        grand_total as credit,
        id as document_id
      FROM public.credit_notes
      WHERE customer_id = p_customer_id
        AND credit_note_date >= p_from_date AND credit_note_date <= p_to_date
        AND status NOT IN ('cancelled')
    )
    SELECT * FROM combined_tx
    ORDER BY tx_date ASC, tx_type DESC
  LOOP
    v_running_bal := round(v_running_bal + v_rec.debit - v_rec.credit, 3);

    v_tx_list := v_tx_list || jsonb_build_object(
      'date', v_rec.tx_date,
      'type', v_rec.tx_type,
      'document_number', v_rec.document_number,
      'description', v_rec.description,
      'debit', v_rec.debit,
      'credit', v_rec.credit,
      'balance', v_running_bal,
      'document_id', v_rec.document_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_name', v_cust.name,
    'customer_code', v_cust.code,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'opening_balance', v_opening_bal,
    'transactions', v_tx_list,
    'closing_balance', v_running_bal
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: get_supplier_statement()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_supp RECORD;
  v_opening_bill numeric(14,3) := 0.000;
  v_opening_pay numeric(14,3) := 0.000;
  v_opening_bal numeric(14,3) := 0.000;
  v_running_bal numeric(14,3) := 0.000;
  v_tx_list jsonb := '[]'::jsonb;
  v_rec RECORD;
BEGIN
  SELECT id, company_id, name, code INTO v_supp
  FROM public.suppliers WHERE id = p_supplier_id;

  IF v_supp.id IS NULL THEN
    RAISE EXCEPTION 'Supplier % not found', p_supplier_id USING ERRCODE = 'P0002';
  END IF;

  -- 1. Calculate opening balance before p_from_date
  SELECT COALESCE(sum(grand_total), 0.000) INTO v_opening_bill
  FROM public.supplier_bills
  WHERE supplier_id = p_supplier_id
    AND bill_date < p_from_date
    AND status NOT IN ('cancelled');

  SELECT COALESCE(sum(amount), 0.000) INTO v_opening_pay
  FROM public.supplier_payments
  WHERE supplier_id = p_supplier_id
    AND payment_date < p_from_date
    AND status NOT IN ('cancelled');

  v_opening_bal := round(v_opening_bill - v_opening_pay, 3);
  v_running_bal := v_opening_bal;

  -- 2. Fetch and order transactions within range
  FOR v_rec IN
    WITH combined_tx AS (
      -- Supplier Bills (Cr to Accounts Payable)
      SELECT
        bill_date as tx_date,
        'bill' as tx_type,
        bill_number as document_number,
        'Vendor Procurement Bill' as description,
        grand_total as credit,
        0.000 as debit,
        id as document_id
      FROM public.supplier_bills
      WHERE supplier_id = p_supplier_id
        AND bill_date >= p_from_date AND bill_date <= p_to_date
        AND status NOT IN ('cancelled')

      UNION ALL

      -- Supplier Payments (Dr to Accounts Payable)
      SELECT
        payment_date as tx_date,
        'payment' as tx_type,
        payment_number as document_number,
        'Vendor Disbursement Payment' as description,
        0.000 as credit,
        amount as debit,
        id as document_id
      FROM public.supplier_payments
      WHERE supplier_id = p_supplier_id
        AND payment_date >= p_from_date AND payment_date <= p_to_date
        AND status NOT IN ('cancelled')
    )
    SELECT * FROM combined_tx
    ORDER BY tx_date ASC, tx_type DESC
  LOOP
    v_running_bal := round(v_running_bal + v_rec.credit - v_rec.debit, 3);

    v_tx_list := v_tx_list || jsonb_build_object(
      'date', v_rec.tx_date,
      'type', v_rec.tx_type,
      'document_number', v_rec.document_number,
      'description', v_rec.description,
      'credit', v_rec.credit,
      'debit', v_rec.debit,
      'balance', v_running_bal,
      'document_id', v_rec.document_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id,
    'supplier_name', v_supp.name,
    'supplier_code', v_supp.code,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'opening_balance', v_opening_bal,
    'transactions', v_tx_list,
    'closing_balance', v_running_bal
  );
END;
$$;
