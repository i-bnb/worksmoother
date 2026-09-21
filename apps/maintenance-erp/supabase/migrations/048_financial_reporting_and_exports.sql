-- =============================================================================
-- Migration 048: Financial Statements, Job Profitability & Tally/Zoho Export
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. view_trial_balance (Opening, Period, and Closing balances)
--   2. view_general_ledger (Detailed line-by-line audit report)
--   3. view_profit_and_loss (P&L: Revenues, COGS, Expenses, Net Profit)
--   4. view_balance_sheet (Assets, Liabilities, Equity)
--   5. view_job_profitability (Revenue vs Material + Labor + Expense margins per Work Order)
--   6. view_accounts_payable_summary (Supplier balances and overdue payables)
--   7. export_accounting_vouchers() (Format-agnostic Tally/Zoho export RPC)

-- ---------------------------------------------------------------------------
-- 1. View: view_trial_balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_trial_balance
WITH (security_invoker = true)
AS
WITH posted_lines AS (
  SELECT
    jl.account_id,
    COALESCE(SUM(jl.debit), 0.000) as period_debit,
    COALESCE(SUM(jl.credit), 0.000) as period_credit
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.status = 'posted'
  GROUP BY jl.account_id
)
SELECT
  coa.id as account_id,
  coa.company_id,
  coa.branch_id,
  coa.account_code,
  coa.account_name,
  coa.account_type,
  ag.name as group_name,
  coa.currency,
  coa.opening_balance_debit as opening_debit,
  coa.opening_balance_credit as opening_credit,
  COALESCE(pl.period_debit, 0.000) as period_debit,
  COALESCE(pl.period_credit, 0.000) as period_credit,
  -- Closing Debit / Credit calculation based on account normal balance
  CASE
    WHEN coa.account_type IN ('asset', 'expense') THEN
      GREATEST(
        (coa.opening_balance_debit + COALESCE(pl.period_debit, 0.000)) -
        (coa.opening_balance_credit + COALESCE(pl.period_credit, 0.000)),
        0.000
      )
    ELSE
      0.000
  END as closing_debit,
  CASE
    WHEN coa.account_type IN ('liability', 'equity', 'revenue') THEN
      GREATEST(
        (coa.opening_balance_credit + COALESCE(pl.period_credit, 0.000)) -
        (coa.opening_balance_debit + COALESCE(pl.period_debit, 0.000)),
        0.000
      )
    ELSE
      0.000
  END as closing_credit,
  -- Net Balance (positive indicates debit normal, negative indicates credit normal)
  (coa.opening_balance_debit + COALESCE(pl.period_debit, 0.000)) -
  (coa.opening_balance_credit + COALESCE(pl.period_credit, 0.000)) as net_balance
FROM public.chart_of_accounts coa
LEFT JOIN public.account_groups ag ON ag.id = coa.account_group_id
LEFT JOIN posted_lines pl ON pl.account_id = coa.id
WHERE coa.is_active = true;

COMMENT ON VIEW public.view_trial_balance IS 'Trial Balance showing opening, period movements, and closing balances from posted journals.';

-- ---------------------------------------------------------------------------
-- 2. View: view_general_ledger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_general_ledger
WITH (security_invoker = true)
AS
SELECT
  je.company_id,
  je.branch_id,
  je.id as journal_id,
  je.journal_number,
  je.journal_date,
  je.reference_type,
  je.reference_id,
  jl.id as line_id,
  coa.id as account_id,
  coa.account_code,
  coa.account_name,
  coa.account_type,
  jl.description,
  jl.debit,
  jl.credit,
  jl.base_debit,
  jl.base_credit,
  jl.customer_id,
  c.name as customer_name,
  jl.supplier_id,
  s.name as supplier_name,
  jl.work_order_id,
  jl.cost_center_id,
  cc.code as cost_center_code
FROM public.journal_lines jl
JOIN public.journal_entries je ON je.id = jl.journal_entry_id
JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
LEFT JOIN public.customers c ON c.id = jl.customer_id
LEFT JOIN public.suppliers s ON s.id = jl.supplier_id
LEFT JOIN public.cost_centers cc ON cc.id = jl.cost_center_id
WHERE je.status = 'posted'
ORDER BY je.journal_date ASC, je.journal_number ASC, jl.created_at ASC;

COMMENT ON VIEW public.view_general_ledger IS 'Audit-level General Ledger reporting all line movements across posted transactions.';

-- ---------------------------------------------------------------------------
-- 3. View: view_profit_and_loss
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_profit_and_loss
WITH (security_invoker = true)
AS
SELECT
  coa.company_id,
  coa.account_type,
  coa.account_code,
  coa.account_name,
  COALESCE(ag.name, 'Unclassified') as group_name,
  CASE
    WHEN coa.account_type = 'revenue' THEN
      COALESCE(SUM(jl.credit - jl.debit), 0.000)
    WHEN coa.account_type = 'expense' THEN
      COALESCE(SUM(jl.debit - jl.credit), 0.000)
    ELSE 0.000
  END as amount
FROM public.chart_of_accounts coa
LEFT JOIN public.account_groups ag ON ag.id = coa.account_group_id
LEFT JOIN public.journal_lines jl ON jl.account_id = coa.id
LEFT JOIN public.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
WHERE coa.account_type IN ('revenue', 'expense')
GROUP BY coa.company_id, coa.account_type, coa.account_code, coa.account_name, ag.name;

COMMENT ON VIEW public.view_profit_and_loss IS 'Profit and Loss performance view categorizing revenues and expenses.';

-- ---------------------------------------------------------------------------
-- 4. View: view_balance_sheet
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_balance_sheet
WITH (security_invoker = true)
AS
SELECT
  coa.company_id,
  coa.account_type,
  coa.account_code,
  coa.account_name,
  COALESCE(ag.name, 'Unclassified') as group_name,
  CASE
    WHEN coa.account_type = 'asset' THEN
      (coa.opening_balance_debit - coa.opening_balance_credit) +
      COALESCE(SUM(jl.debit - jl.credit), 0.000)
    WHEN coa.account_type IN ('liability', 'equity') THEN
      (coa.opening_balance_credit - coa.opening_balance_debit) +
      COALESCE(SUM(jl.credit - jl.debit), 0.000)
    ELSE 0.000
  END as balance
FROM public.chart_of_accounts coa
LEFT JOIN public.account_groups ag ON ag.id = coa.account_group_id
LEFT JOIN public.journal_lines jl ON jl.account_id = coa.id
LEFT JOIN public.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
WHERE coa.account_type IN ('asset', 'liability', 'equity')
GROUP BY coa.company_id, coa.account_type, coa.account_code, coa.account_name, ag.name,
         coa.opening_balance_debit, coa.opening_balance_credit;

COMMENT ON VIEW public.view_balance_sheet IS 'Balance Sheet statement showing Assets, Liabilities, and Equity balances.';

-- ---------------------------------------------------------------------------
-- 5. View: view_job_profitability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_job_profitability
WITH (security_invoker = true)
AS
WITH wo_invoiced AS (
  SELECT
    work_order_id,
    COALESCE(SUM(grand_total), 0.000) as invoiced_revenue
  FROM public.invoices
  WHERE work_order_id IS NOT NULL AND status NOT IN ('draft', 'cancelled')
  GROUP BY work_order_id
),
wo_materials AS (
  SELECT
    work_order_id,
    COALESCE(SUM(total_cost), 0.000) as material_cost
  FROM public.job_material_movements
  WHERE movement_type = 'installed'
  GROUP BY work_order_id
),
wo_labor AS (
  SELECT
    t.work_order_id,
    ROUND(COALESCE(SUM(t.duration_minutes) / 60.0, 0), 2) as labor_hours,
    ROUND(COALESCE(SUM((t.duration_minutes / 60.0) * COALESCE(e.hourly_cost_rate, s.default_labor_cost_rate, 50.000)), 0), 3) as labor_cost
  FROM public.timesheets t
  JOIN public.employees e ON e.id = t.technician_id
  JOIN public.work_orders wo ON wo.id = t.work_order_id
  LEFT JOIN public.settings s ON s.company_id = wo.company_id
  WHERE t.duration_minutes IS NOT NULL
  GROUP BY t.work_order_id
),
wo_expenses AS (
  SELECT
    work_order_id,
    COALESCE(SUM(amount), 0.000) as direct_expenses
  FROM public.expenses
  WHERE work_order_id IS NOT NULL AND status IN ('approved', 'posted')
  GROUP BY work_order_id
)
SELECT
  wo.id as work_order_id,
  wo.company_id,
  wo.branch_id,
  wo.order_number,
  wo.title,
  wo.status as work_order_status,
  c.id as customer_id,
  c.name as customer_name,
  COALESCE(inv.invoiced_revenue, 0.000) as revenue,
  COALESCE(mat.material_cost, 0.000) as material_cost,
  COALESCE(lab.labor_hours, 0.00) as labor_hours,
  COALESCE(lab.labor_cost, 0.000) as labor_cost,
  COALESCE(exp.direct_expenses, 0.000) as direct_expenses,
  (COALESCE(mat.material_cost, 0.000) + COALESCE(lab.labor_cost, 0.000) + COALESCE(exp.direct_expenses, 0.000)) as total_cost,
  (COALESCE(inv.invoiced_revenue, 0.000) - (COALESCE(mat.material_cost, 0.000) + COALESCE(lab.labor_cost, 0.000) + COALESCE(exp.direct_expenses, 0.000))) as gross_margin,
  CASE
    WHEN COALESCE(inv.invoiced_revenue, 0.000) > 0 THEN
      ROUND(
        ((COALESCE(inv.invoiced_revenue, 0.000) - (COALESCE(mat.material_cost, 0.000) + COALESCE(lab.labor_cost, 0.000) + COALESCE(exp.direct_expenses, 0.000))) / inv.invoiced_revenue) * 100.0,
        2
      )
    ELSE 0.00
  END as gross_margin_percentage
FROM public.work_orders wo
JOIN public.customers c ON c.id = wo.customer_id
LEFT JOIN wo_invoiced inv ON inv.work_order_id = wo.id
LEFT JOIN wo_materials mat ON mat.work_order_id = wo.id
LEFT JOIN wo_labor lab ON lab.work_order_id = wo.id
LEFT JOIN wo_expenses exp ON exp.work_order_id = wo.id;

COMMENT ON VIEW public.view_job_profitability IS 'Work Order profitability analysis integrating materials, labor hours/rates, direct expenses, and revenue.';

-- ---------------------------------------------------------------------------
-- 6. View: view_accounts_payable_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_accounts_payable_summary
WITH (security_invoker = true)
AS
SELECT
  s.id as supplier_id,
  s.company_id,
  s.code as supplier_code,
  s.name as supplier_name,
  s.currency,
  s.payment_terms_days,
  COUNT(sb.id) as total_bills,
  COALESCE(SUM(sb.grand_total), 0.000) as total_billed,
  COALESCE(SUM(sb.amount_paid), 0.000) as total_paid,
  COALESCE(SUM(sb.amount_due), 0.000) as outstanding_balance,
  COALESCE(SUM(CASE WHEN CURRENT_DATE > sb.due_date AND sb.amount_due > 0 THEN sb.amount_due ELSE 0.000 END), 0.000) as overdue_balance
FROM public.suppliers s
LEFT JOIN public.supplier_bills sb ON sb.supplier_id = s.id AND sb.status NOT IN ('draft', 'cancelled')
GROUP BY s.id, s.company_id, s.code, s.name, s.currency, s.payment_terms_days;

COMMENT ON VIEW public.view_accounts_payable_summary IS 'Accounts Payable summary per supplier showing total billed, paid, and overdue balances.';

-- ---------------------------------------------------------------------------
-- 7. RPC: export_accounting_vouchers() (Tally / Zoho Books Export Abstraction)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_accounting_vouchers(
  p_company_id uuid,
  p_start_date date,
  p_end_date date,
  p_format text DEFAULT 'json' -- 'json', 'csv', 'tally_xml'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vouchers jsonb;
BEGIN
  IF NOT (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role)) THEN
    RAISE EXCEPTION 'Unauthorized: Only accountants and administrators may export accounting vouchers'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO v_vouchers
  FROM (
    SELECT
      je.id as journal_id,
      je.journal_number as voucher_number,
      je.journal_date as voucher_date,
      je.reference_type as voucher_type,
      je.description as narration,
      je.currency,
      je.exchange_rate,
      je.total_debit,
      je.total_credit,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'line_id', jl.id,
          'account_code', coa.account_code,
          'account_name', coa.account_name,
          'account_type', coa.account_type,
          'debit', jl.debit,
          'credit', jl.credit,
          'description', jl.description,
          'customer_name', c.name,
          'customer_tax_id', c.tax_id,
          'supplier_name', s.name,
          'supplier_tax_id', s.tax_id,
          'cost_center', cc.code
        ))
        FROM public.journal_lines jl
        JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
        LEFT JOIN public.customers c ON c.id = jl.customer_id
        LEFT JOIN public.suppliers s ON s.id = jl.supplier_id
        LEFT JOIN public.cost_centers cc ON cc.id = jl.cost_center_id
        WHERE jl.journal_entry_id = je.id
      ) as lines
    FROM public.journal_entries je
    WHERE je.company_id = p_company_id
      AND je.status = 'posted'
      AND je.journal_date >= p_start_date
      AND je.journal_date <= p_end_date
    ORDER BY je.journal_date ASC, je.journal_number ASC
  ) v;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'format', p_format,
    'total_vouchers', jsonb_array_length(v_vouchers),
    'vouchers', v_vouchers
  );
END;
$$;
