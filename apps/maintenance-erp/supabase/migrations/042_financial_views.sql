-- =============================================================================
-- Migration 042: Financial Reporting Views & Customer Aging Buckets
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- High-performance views for financial dashboards, credit controllers, and accounts receivable:
--   1. view_customer_balances: Real-time receivables, credits, collections, and net exposure
--   2. view_customer_invoice_aging: Strict aging buckets (Current, 1-30, 31-60, 61-90, 90+ days overdue)
--   3. view_sales_reporting: Commercial sales volume by customer and branch
--   4. view_quotation_pipeline: Proposal pipeline stages, values, and conversion rates
--   5. view_invoice_summary: Invoice status distribution and collection ratios
--   6. view_payment_collections: Daily collections and payment channel distribution
-- Uses security_invoker = true so queries automatically inherit caller RLS policies.

-- ---------------------------------------------------------------------------
-- 1. View: view_customer_balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_customer_balances
WITH (security_invoker = true)
AS
SELECT
  c.company_id,
  c.id AS customer_id,
  c.code AS customer_code,
  c.name AS customer_name,
  c.currency,
  COALESCE(inv.total_invoiced, 0.000) AS total_invoiced,
  COALESCE(cn.total_credited, 0.000) AS total_credited,
  COALESCE(inv.total_paid, 0.000) AS total_paid,
  COALESCE(inv.total_outstanding, 0.000) AS total_outstanding,
  COALESCE(inv.total_overdue, 0.000) AS total_overdue,
  COALESCE(pmt.total_unallocated, 0.000) AS total_unallocated_payments,
  (COALESCE(inv.total_outstanding, 0.000) - COALESCE(pmt.total_unallocated, 0.000)) AS net_receivable
FROM public.customers c
LEFT JOIN LATERAL (
  SELECT
    SUM(i.grand_total) AS total_invoiced,
    SUM(i.amount_paid) AS total_paid,
    SUM(i.amount_due) AS total_outstanding,
    SUM(CASE WHEN i.due_date < CURRENT_DATE AND i.amount_due > 0 THEN i.amount_due ELSE 0.000 END) AS total_overdue
  FROM public.invoices i
  WHERE i.customer_id = c.id
    AND i.status IN ('issued', 'partially_paid', 'paid', 'overdue')
) inv ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(cr.grand_total) AS total_credited
  FROM public.credit_notes cr
  WHERE cr.customer_id = c.id
    AND cr.status IN ('approved', 'issued', 'applied')
) cn ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(p.unallocated_amount) AS total_unallocated
  FROM public.payments p
  WHERE p.customer_id = c.id
    AND p.status IN ('received', 'cleared')
) pmt ON true;

COMMENT ON VIEW public.view_customer_balances IS 'Consolidated accounts receivable balances, credit notes, and unallocated advance receipts per client.';

-- ---------------------------------------------------------------------------
-- 2. View: view_customer_invoice_aging
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_customer_invoice_aging
WITH (security_invoker = true)
AS
SELECT
  c.company_id,
  c.id AS customer_id,
  c.code AS customer_code,
  c.name AS customer_name,
  c.currency,
  COALESCE(SUM(CASE WHEN i.due_date >= CURRENT_DATE THEN i.amount_due ELSE 0.000 END), 0.000) AS current_amount,
  COALESCE(SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 1 AND 30 THEN i.amount_due ELSE 0.000 END), 0.000) AS days_1_30,
  COALESCE(SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60 THEN i.amount_due ELSE 0.000 END), 0.000) AS days_31_60,
  COALESCE(SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90 THEN i.amount_due ELSE 0.000 END), 0.000) AS days_61_90,
  COALESCE(SUM(CASE WHEN (CURRENT_DATE - i.due_date) > 90 THEN i.amount_due ELSE 0.000 END), 0.000) AS days_90_plus,
  COALESCE(SUM(CASE WHEN i.due_date < CURRENT_DATE THEN i.amount_due ELSE 0.000 END), 0.000) AS total_overdue,
  COALESCE(SUM(i.amount_due), 0.000) AS total_outstanding
FROM public.customers c
JOIN public.invoices i ON i.customer_id = c.id
WHERE i.status IN ('issued', 'partially_paid', 'overdue')
  AND i.amount_due > 0.000
GROUP BY c.company_id, c.id, c.code, c.name, c.currency;

COMMENT ON VIEW public.view_customer_invoice_aging IS 'Aging schedule of outstanding invoices split into standard 30-day chronological delinquency buckets.';

-- ---------------------------------------------------------------------------
-- 3. View: view_quotation_pipeline
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_quotation_pipeline
WITH (security_invoker = true)
AS
SELECT
  q.company_id,
  q.branch_id,
  COUNT(*) AS total_quotations,
  COUNT(*) FILTER (WHERE q.status = 'draft') AS draft_count,
  COALESCE(SUM(q.grand_total) FILTER (WHERE q.status = 'draft'), 0.000) AS draft_value,
  COUNT(*) FILTER (WHERE q.status = 'pending_approval') AS pending_approval_count,
  COALESCE(SUM(q.grand_total) FILTER (WHERE q.status = 'pending_approval'), 0.000) AS pending_approval_value,
  COUNT(*) FILTER (WHERE q.status = 'sent') AS sent_count,
  COALESCE(SUM(q.grand_total) FILTER (WHERE q.status = 'sent'), 0.000) AS sent_value,
  COUNT(*) FILTER (WHERE q.status = 'accepted') AS accepted_count,
  COALESCE(SUM(q.grand_total) FILTER (WHERE q.status = 'accepted'), 0.000) AS accepted_value,
  COUNT(*) FILTER (WHERE q.status = 'rejected') AS rejected_count,
  COUNT(*) FILTER (WHERE q.status = 'expired') AS expired_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE q.status IN ('accepted', 'rejected', 'expired')) > 0
    THEN round(
      (COUNT(*) FILTER (WHERE q.status = 'accepted')::numeric /
       COUNT(*) FILTER (WHERE q.status IN ('accepted', 'rejected', 'expired'))::numeric) * 100.00,
      2
    )
    ELSE 0.00
  END AS conversion_rate_percent
FROM public.quotations q
WHERE q.is_latest_version = true
GROUP BY q.company_id, q.branch_id;

COMMENT ON VIEW public.view_quotation_pipeline IS 'Commercial quotation pipeline metrics, pending review stages, and conversion ratios.';

-- ---------------------------------------------------------------------------
-- 4. View: view_invoice_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_invoice_summary
WITH (security_invoker = true)
AS
SELECT
  i.company_id,
  i.branch_id,
  COUNT(*) AS total_invoices,
  COUNT(*) FILTER (WHERE i.status = 'draft') AS draft_count,
  COUNT(*) FILTER (WHERE i.status = 'issued') AS issued_count,
  COUNT(*) FILTER (WHERE i.status = 'partially_paid') AS partially_paid_count,
  COUNT(*) FILTER (WHERE i.status = 'paid') AS paid_count,
  COUNT(*) FILTER (WHERE i.status = 'overdue' OR (i.due_date < CURRENT_DATE AND i.amount_due > 0)) AS overdue_count,
  COUNT(*) FILTER (WHERE i.status = 'cancelled') AS cancelled_count,
  COALESCE(SUM(i.grand_total) FILTER (WHERE i.status <> 'cancelled'), 0.000) AS total_billed_amount,
  COALESCE(SUM(i.amount_paid), 0.000) AS total_collected_amount,
  COALESCE(SUM(i.amount_due) FILTER (WHERE i.status <> 'cancelled'), 0.000) AS total_uncollected_amount
FROM public.invoices i
GROUP BY i.company_id, i.branch_id;

COMMENT ON VIEW public.view_invoice_summary IS 'Executive overview of billing distribution, collection progress, and open receivable exposure.';

-- ---------------------------------------------------------------------------
-- 5. View: view_payment_collections
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_payment_collections
WITH (security_invoker = true)
AS
SELECT
  p.company_id,
  p.branch_id,
  p.payment_date,
  p.payment_method,
  COUNT(*) AS transaction_count,
  COALESCE(SUM(p.amount), 0.000) AS total_received,
  COALESCE(SUM(p.allocated_amount), 0.000) AS total_allocated,
  COALESCE(SUM(p.unallocated_amount), 0.000) AS total_unallocated
FROM public.payments p
WHERE p.status IN ('received', 'cleared')
GROUP BY p.company_id, p.branch_id, p.payment_date, p.payment_method;

COMMENT ON VIEW public.view_payment_collections IS 'Daily receipt volumes, payment channels, and unallocated deposit tracking.';

-- ---------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.view_customer_balances TO authenticated;
GRANT SELECT ON public.view_customer_invoice_aging TO authenticated;
GRANT SELECT ON public.view_quotation_pipeline TO authenticated;
GRANT SELECT ON public.view_invoice_summary TO authenticated;
GRANT SELECT ON public.view_payment_collections TO authenticated;
