-- =============================================================================
-- Migration 046: Central Double-Entry Posting & Reversal Engine
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. post_journal_entry(): Validates balance, active accounts, open periods, and locks with FOR UPDATE
--   2. reverse_journal_entry(): Inverts debits/credits atomically, links reversal_of_journal_id
--   3. validate_trial_balance(): System-level validation confirming Total Debits = Total Credits
--   4. Automatic Subsystem Postings:
--      - post_invoice_to_gl()
--      - post_payment_to_gl()
--      - post_credit_note_to_gl()
--      - post_inventory_cogs_to_gl()

-- ---------------------------------------------------------------------------
-- 1. Helper: Resolve Standard Default Company GL Accounts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_default_gl_account(
  p_company_id uuid,
  p_purpose text -- 'ar', 'ap', 'bank', 'cash', 'revenue', 'cogs', 'inventory', 'tax_output', 'tax_input'
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF p_purpose = 'ar' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND is_control_account = true AND account_type = 'asset'
      AND (account_code LIKE '120%' OR account_name ILIKE '%receivable%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'ap' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND is_control_account = true AND account_type = 'liability'
      AND (account_code LIKE '201%' OR account_name ILIKE '%payable%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose IN ('bank', 'cash') THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'asset'
      AND (account_code LIKE '10%' OR account_name ILIKE '%' || p_purpose || '%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'revenue' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'revenue'
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'cogs' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'expense'
      AND (account_code LIKE '50%' OR account_name ILIKE '%cogs%' OR account_name ILIKE '%cost of goods%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'inventory' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'asset'
      AND (account_code LIKE '130%' OR account_name ILIKE '%inventory%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'tax_output' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'liability'
      AND (account_code LIKE '202%' OR account_name ILIKE '%tax%' OR account_name ILIKE '%vat%')
    ORDER BY account_code LIMIT 1;

  ELSIF p_purpose = 'tax_input' THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND account_type = 'asset'
      AND (account_code LIKE '140%' OR account_name ILIKE '%tax%' OR account_name ILIKE '%vat%')
    ORDER BY account_code LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Core RPC: post_journal_entry()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_journal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journal RECORD;
  v_period RECORD;
  v_line_count integer;
  v_sum_debit numeric(14,3);
  v_sum_credit numeric(14,3);
  v_inactive_accounts integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Check permissions (Accountant or Owner Admin)
  IF NOT (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role)) THEN
    RAISE EXCEPTION 'Unauthorized: Only accountants and administrators may post journal entries'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lock journal header FOR UPDATE
  SELECT id, company_id, branch_id, journal_number, journal_date, period_id, status, currency, exchange_rate
  INTO v_journal
  FROM public.journal_entries
  WHERE id = p_journal_id
  FOR UPDATE;

  IF v_journal.id IS NULL THEN
    RAISE EXCEPTION 'Journal entry % not found', p_journal_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_journal.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_journal.status = 'posted' THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', p_journal_id);
  END IF;

  IF v_journal.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Cannot post journal %: current status is "%" (must be draft or approved)',
      v_journal.journal_number, v_journal.status USING ERRCODE = '22000';
  END IF;

  -- 3. Validate accounting period
  IF v_journal.period_id IS NOT NULL THEN
    SELECT id, status INTO v_period
    FROM public.accounting_periods
    WHERE id = v_journal.period_id;

    IF v_period.id IS NULL OR v_period.status <> 'open' THEN
      RAISE EXCEPTION 'Cannot post journal %: accounting period is % (must be open)',
        v_journal.journal_number, COALESCE(v_period.status::text, 'not found') USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 4. Calculate line aggregates
  SELECT
    COUNT(*),
    COALESCE(SUM(debit), 0.000),
    COALESCE(SUM(credit), 0.000)
  INTO v_line_count, v_sum_debit, v_sum_credit
  FROM public.journal_lines
  WHERE journal_entry_id = p_journal_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Cannot post journal %: must contain at least 2 lines (found %)',
      v_journal.journal_number, v_line_count USING ERRCODE = '22000';
  END IF;

  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'Cannot post unbalanced journal %: Total Debit (%) does not equal Total Credit (%)',
      v_journal.journal_number, v_sum_debit, v_sum_credit USING ERRCODE = '22000';
  END IF;

  IF v_sum_debit <= 0 THEN
    RAISE EXCEPTION 'Cannot post journal % with zero total debit/credit', v_journal.journal_number
      USING ERRCODE = '22000';
  END IF;

  -- 5. Verify all referenced accounts are active
  SELECT COUNT(*) INTO v_inactive_accounts
  FROM public.journal_lines jl
  JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
  WHERE jl.journal_entry_id = p_journal_id AND coa.is_active = false;

  IF v_inactive_accounts > 0 THEN
    RAISE EXCEPTION 'Cannot post journal %: references % inactive account(s)',
      v_journal.journal_number, v_inactive_accounts USING ERRCODE = '22000';
  END IF;

  -- 6. Stamp base currency amounts on lines
  UPDATE public.journal_lines
  SET
    base_debit = ROUND(debit * v_journal.exchange_rate, 3),
    base_credit = ROUND(credit * v_journal.exchange_rate, 3)
  WHERE journal_entry_id = p_journal_id;

  -- 7. Transition status to posted
  UPDATE public.journal_entries
  SET
    total_debit = v_sum_debit,
    total_credit = v_sum_credit,
    status = 'posted',
    posted_by = auth.uid(),
    posted_at = v_now,
    updated_at = v_now
  WHERE id = p_journal_id;

  RETURN jsonb_build_object(
    'success', true,
    'journal_id', p_journal_id,
    'journal_number', v_journal.journal_number,
    'total_debit', v_sum_debit,
    'total_credit', v_sum_credit,
    'posted_at', v_now
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Core RPC: reverse_journal_entry()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_journal_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig RECORD;
  v_reversal_id uuid;
  v_reversal_number text;
  v_post_res jsonb;
  v_now timestamptz := now();
BEGIN
  IF NOT (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role)) THEN
    RAISE EXCEPTION 'Unauthorized: Only accountants and administrators may reverse journal entries'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_orig
  FROM public.journal_entries
  WHERE id = p_journal_id
  FOR UPDATE;

  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Journal entry % not found', p_journal_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_orig.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Cannot reverse journal %: status is "%" (only posted journals can be reversed)',
      v_orig.journal_number, v_orig.status USING ERRCODE = '22000';
  END IF;

  -- Verify it hasn't already been reversed
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE reversal_of_journal_id = p_journal_id AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Journal % has already been reversed', v_orig.journal_number USING ERRCODE = '22000';
  END IF;

  -- Create reversal journal entry
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, period_id, reference_type, reference_id,
    description, currency, exchange_rate, status, total_debit, total_credit,
    created_by, reversal_of_journal_id, created_at, updated_at
  ) VALUES (
    v_orig.company_id, v_orig.branch_id, CURRENT_DATE, v_orig.period_id, 'reversal', v_orig.id,
    'Reversal of ' || v_orig.journal_number || ': ' || COALESCE(p_reason, 'Correction'),
    v_orig.currency, v_orig.exchange_rate, 'draft', v_orig.total_credit, v_orig.total_debit,
    auth.uid(), v_orig.id, v_now, v_now
  )
  RETURNING id, journal_number INTO v_reversal_id, v_reversal_number;

  -- Copy lines with inverted debit and credit
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, base_debit, base_credit,
    description, customer_id, supplier_id, employee_id, work_order_id, cost_center_id
  )
  SELECT
    v_reversal_id,
    account_id,
    credit, -- Invert
    debit,  -- Invert
    base_credit,
    base_debit,
    'Reversal: ' || COALESCE(description, ''),
    customer_id, supplier_id, employee_id, work_order_id, cost_center_id
  FROM public.journal_lines
  WHERE journal_entry_id = p_journal_id;

  -- Post the reversal journal
  v_post_res := public.post_journal_entry(v_reversal_id);

  -- Mark original as reversed
  UPDATE public.journal_entries
  SET status = 'reversed', updated_at = v_now
  WHERE id = p_journal_id;

  RETURN jsonb_build_object(
    'success', true,
    'original_journal_id', p_journal_id,
    'reversal_journal_id', v_reversal_id,
    'reversal_journal_number', v_reversal_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Integrity RPC: validate_trial_balance()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_trial_balance(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_debit numeric(14,3) := 0.000;
  v_total_credit numeric(14,3) := 0.000;
  v_discrepancy numeric(14,3) := 0.000;
  v_unbalanced_journals jsonb;
BEGIN
  SELECT
    COALESCE(SUM(jl.debit), 0.000),
    COALESCE(SUM(jl.credit), 0.000)
  INTO v_total_debit, v_total_credit
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.company_id = p_company_id AND je.status = 'posted';

  v_discrepancy := v_total_debit - v_total_credit;

  -- Identify any specific unbalanced posted journals
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_unbalanced_journals
  FROM (
    SELECT
      je.id,
      je.journal_number,
      SUM(jl.debit) as debits,
      SUM(jl.credit) as credits,
      (SUM(jl.debit) - SUM(jl.credit)) as diff
    FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.company_id = p_company_id AND je.status = 'posted'
    GROUP BY je.id, je.journal_number
    HAVING SUM(jl.debit) <> SUM(jl.credit)
  ) x;

  RETURN jsonb_build_object(
    'is_balanced', (v_discrepancy = 0.000),
    'company_id', p_company_id,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'discrepancy', v_discrepancy,
    'unbalanced_journals', v_unbalanced_journals
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Subsystem Auto-Poster: post_invoice_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_invoice_to_gl(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv RECORD;
  v_ar_account uuid;
  v_rev_account uuid;
  v_tax_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.is_posted_to_gl AND v_inv.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_inv.gl_journal_entry_id);
  END IF;

  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post draft invoice % to GL (must be issued or active)', v_inv.invoice_number USING ERRCODE = '22000';
  END IF;

  -- Resolve accounts
  v_ar_account := public.get_default_gl_account(v_inv.company_id, 'ar');
  v_rev_account := public.get_default_gl_account(v_inv.company_id, 'revenue');
  v_tax_account := public.get_default_gl_account(v_inv.company_id, 'tax_output');

  IF v_ar_account IS NULL OR v_rev_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post invoice: Accounts Receivable or Revenue account not configured in Chart of Accounts'
      USING ERRCODE = '22000';
  END IF;

  -- Create journal entry
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_inv.company_id, v_inv.branch_id, v_inv.invoice_date, 'invoice', v_inv.id,
    'Commercial Invoice ' || v_inv.invoice_number, v_inv.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Accounts Receivable (Grand Total)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
  ) VALUES (
    v_journal_id, v_ar_account, v_inv.grand_total, 0.000,
    'AR Receivable for ' || v_inv.invoice_number, v_inv.customer_id, v_inv.work_order_id
  );

  -- Line 2: Cr Revenue (Taxable Amount)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
  ) VALUES (
    v_journal_id, v_rev_account, 0.000, v_inv.taxable_amount,
    'Sales/Service Revenue for ' || v_inv.invoice_number, v_inv.customer_id, v_inv.work_order_id
  );

  -- Line 3: Cr Tax Payable (Tax Amount, if applicable)
  IF v_inv.tax_amount > 0 THEN
    IF v_tax_account IS NULL THEN
      RAISE EXCEPTION 'Cannot post invoice: Output Tax Payable account not configured in Chart of Accounts'
        USING ERRCODE = '22000';
    END IF;

    INSERT INTO public.journal_lines (
      journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
    ) VALUES (
      v_journal_id, v_tax_account, 0.000, v_inv.tax_amount,
      'Output VAT/Tax for ' || v_inv.invoice_number, v_inv.customer_id, v_inv.work_order_id
    );
  END IF;

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  -- Update invoice GL stamp
  UPDATE public.invoices
  SET
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'journal_id', v_journal_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Subsystem Auto-Poster: post_payment_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payment_to_gl(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pmt RECORD;
  v_bank_account uuid;
  v_ar_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_pmt
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_pmt.id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_pmt.is_posted_to_gl AND v_pmt.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_pmt.gl_journal_entry_id);
  END IF;

  -- Resolve bank account: payment_method GL mapping or fallback bank
  IF v_pmt.payment_method_id IS NOT NULL THEN
    SELECT gl_account_id INTO v_bank_account
    FROM public.payment_methods
    WHERE id = v_pmt.payment_method_id;
  END IF;

  IF v_bank_account IS NULL THEN
    v_bank_account := public.get_default_gl_account(v_pmt.company_id, 'bank');
  END IF;

  v_ar_account := public.get_default_gl_account(v_pmt.company_id, 'ar');

  IF v_bank_account IS NULL OR v_ar_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post payment: Bank or Accounts Receivable account not configured'
      USING ERRCODE = '22000';
  END IF;

  -- Create journal entry
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_pmt.company_id, v_pmt.branch_id, v_pmt.payment_date, 'payment', v_pmt.id,
    'Customer Payment ' || v_pmt.payment_number, v_pmt.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Bank/Cash Asset
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id
  ) VALUES (
    v_journal_id, v_bank_account, v_pmt.amount, 0.000,
    'Payment Receipt ' || v_pmt.payment_number, v_pmt.customer_id
  );

  -- Line 2: Cr Accounts Receivable
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id
  ) VALUES (
    v_journal_id, v_ar_account, 0.000, v_pmt.amount,
    'AR Settlement ' || v_pmt.payment_number, v_pmt.customer_id
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  -- Update payment GL stamp
  UPDATE public.payments
  SET
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'journal_id', v_journal_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Subsystem Auto-Poster: post_credit_note_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_credit_note_to_gl(p_credit_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cn RECORD;
  v_ar_account uuid;
  v_rev_account uuid;
  v_tax_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_cn
  FROM public.credit_notes
  WHERE id = p_credit_note_id
  FOR UPDATE;

  IF v_cn.id IS NULL THEN
    RAISE EXCEPTION 'Credit Note % not found', p_credit_note_id USING ERRCODE = 'P0002';
  END IF;

  IF v_cn.is_posted_to_gl AND v_cn.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_cn.gl_journal_entry_id);
  END IF;

  v_ar_account := public.get_default_gl_account(v_cn.company_id, 'ar');
  v_rev_account := public.get_default_gl_account(v_cn.company_id, 'revenue');
  v_tax_account := public.get_default_gl_account(v_cn.company_id, 'tax_output');

  IF v_ar_account IS NULL OR v_rev_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post credit note: Accounts Receivable or Revenue account not configured'
      USING ERRCODE = '22000';
  END IF;

  -- Create journal entry
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_cn.company_id, v_cn.branch_id, v_cn.credit_note_date, 'credit_note', v_cn.id,
    'Credit Note ' || v_cn.credit_note_number || ': ' || v_cn.reason, v_cn.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Revenue / Sales Returns (Taxable amount)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
  ) VALUES (
    v_journal_id, v_rev_account, v_cn.taxable_amount, 0.000,
    'Sales Return/Adjustment ' || v_cn.credit_note_number, v_cn.customer_id, v_cn.work_order_id
  );

  -- Line 2: Dr Tax Payable (Reversal of Output Tax)
  IF v_cn.tax_amount > 0 THEN
    IF v_tax_account IS NULL THEN
      RAISE EXCEPTION 'Cannot post credit note: Tax Output account not configured' USING ERRCODE = '22000';
    END IF;

    INSERT INTO public.journal_lines (
      journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
    ) VALUES (
      v_journal_id, v_tax_account, v_cn.tax_amount, 0.000,
      'Tax Adjustment ' || v_cn.credit_note_number, v_cn.customer_id, v_cn.work_order_id
    );
  END IF;

  -- Line 3: Cr Accounts Receivable (Grand Total)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, customer_id, work_order_id
  ) VALUES (
    v_journal_id, v_ar_account, 0.000, v_cn.grand_total,
    'AR Credit ' || v_cn.credit_note_number, v_cn.customer_id, v_cn.work_order_id
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  -- Update credit note GL stamp
  UPDATE public.credit_notes
  SET
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_credit_note_id;

  RETURN jsonb_build_object(
    'success', true,
    'credit_note_id', p_credit_note_id,
    'journal_id', v_journal_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Subsystem Auto-Poster: post_inventory_cogs_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_inventory_cogs_to_gl(p_stock_ledger_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ledger RECORD;
  v_cogs_account uuid;
  v_inv_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_ledger
  FROM public.stock_ledger
  WHERE id = p_stock_ledger_id;

  IF v_ledger.id IS NULL THEN
    RAISE EXCEPTION 'Stock ledger record % not found', p_stock_ledger_id USING ERRCODE = 'P0002';
  END IF;

  IF v_ledger.movement_direction <> 'out' OR v_ledger.total_cost <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'Not an outbound movement with positive valuation');
  END IF;

  v_cogs_account := public.get_default_gl_account(v_ledger.company_id, 'cogs');
  v_inv_account := public.get_default_gl_account(v_ledger.company_id, 'inventory');

  IF v_cogs_account IS NULL OR v_inv_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post COGS: Cost of Goods Sold or Inventory asset account not configured'
      USING ERRCODE = '22000';
  END IF;

  -- Create COGS journal
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_ledger.company_id, v_ledger.branch_id, CURRENT_DATE, 'inventory_cogs', v_ledger.id,
    'COGS for ' || v_ledger.movement_type || ' (' || v_ledger.reference_type || ')', 'AED', 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Cost of Goods Sold (Total Cost)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description,
    work_order_id
  ) VALUES (
    v_journal_id, v_cogs_account, ROUND(v_ledger.total_cost, 3), 0.000,
    'COGS: ' || v_ledger.movement_type,
    CASE WHEN v_ledger.reference_type = 'work_order' THEN v_ledger.reference_id ELSE NULL END
  );

  -- Line 2: Cr Inventory Asset (Total Cost)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description,
    work_order_id
  ) VALUES (
    v_journal_id, v_inv_account, 0.000, ROUND(v_ledger.total_cost, 3),
    'Inventory deduction: ' || v_ledger.movement_type,
    CASE WHEN v_ledger.reference_type = 'work_order' THEN v_ledger.reference_id ELSE NULL END
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  RETURN jsonb_build_object(
    'success', true,
    'stock_ledger_id', p_stock_ledger_id,
    'journal_id', v_journal_id,
    'cogs_amount', ROUND(v_ledger.total_cost, 3)
  );
END;
$$;
