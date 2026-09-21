-- =============================================================================
-- Migration 041: Multi-Tenant Row Level Security for Sales & Finance
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Enforces tenant isolation, branch scoping, and strict RBAC across all Phase 2B tables:
--   - Owner/Admin & Operations Manager: Full commercial & operational permissions
--   - Accountant: Full control over invoices, credit notes, payments, and tax configuration
--   - Storekeeper: Sales order reading for fulfillment dispatch
--   - Technician: Visibility into assigned work order billing only
--   - Customer: Strictly scoped to own approved/issued quotations and invoices

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on all Phase 2B Tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Policies: tax_codes & payment_methods
-- ---------------------------------------------------------------------------
CREATE POLICY rls_tax_codes_select ON public.tax_codes
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY rls_tax_codes_modify ON public.tax_codes
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant') OR public.has_role('operations_manager'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant') OR public.has_role('operations_manager'))
  );

CREATE POLICY rls_payment_methods_select ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY rls_payment_methods_modify ON public.payment_methods
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );

-- ---------------------------------------------------------------------------
-- 3. Policies: quotations & quotation_lines
-- ---------------------------------------------------------------------------
CREATE POLICY rls_quotations_select ON public.quotations
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      -- Internal staff with branch authorization
      (
        NOT public.has_role('customer')
        AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
      )
      -- Customer Portal: Visible only if belonging to authenticated customer and proposal has been sent/finalized
      OR (
        public.has_role('customer')
        AND customer_id = public.get_current_customer_id()
        AND status IN ('sent', 'accepted', 'rejected', 'expired')
      )
    )
  );

CREATE POLICY rls_quotations_modify ON public.quotations
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('operations_manager')
      OR public.has_role('supervisor')
      OR public.has_role('accountant')
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('operations_manager')
      OR public.has_role('supervisor')
      OR public.has_role('accountant')
    )
  );

CREATE POLICY rls_quotation_lines_select ON public.quotation_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_lines.quotation_id
    )
  );

CREATE POLICY rls_quotation_lines_modify ON public.quotation_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_lines.quotation_id
        AND public.is_company_member(q.company_id)
        AND (q.branch_id IS NULL OR public.is_branch_authorized(q.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('operations_manager')
          OR public.has_role('supervisor')
          OR public.has_role('accountant')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_lines.quotation_id
        AND public.is_company_member(q.company_id)
        AND (q.branch_id IS NULL OR public.is_branch_authorized(q.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('operations_manager')
          OR public.has_role('supervisor')
          OR public.has_role('accountant')
        )
    )
  );

CREATE POLICY rls_quote_history_select ON public.quotation_status_history
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 4. Policies: sales_orders & sales_order_lines
-- ---------------------------------------------------------------------------
CREATE POLICY rls_sales_orders_select ON public.sales_orders
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      (
        NOT public.has_role('customer')
        AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
      )
      OR (
        public.has_role('customer')
        AND customer_id = public.get_current_customer_id()
        AND status <> 'draft'
      )
    )
  );

CREATE POLICY rls_sales_orders_modify ON public.sales_orders
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('operations_manager')
      OR public.has_role('accountant')
      OR public.has_role('storekeeper')
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('operations_manager')
      OR public.has_role('accountant')
      OR public.has_role('storekeeper')
    )
  );

CREATE POLICY rls_sales_order_lines_select ON public.sales_order_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_orders so
      WHERE so.id = sales_order_lines.sales_order_id
    )
  );

CREATE POLICY rls_sales_order_lines_modify ON public.sales_order_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_orders so
      WHERE so.id = sales_order_lines.sales_order_id
        AND public.is_company_member(so.company_id)
        AND (so.branch_id IS NULL OR public.is_branch_authorized(so.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('operations_manager')
          OR public.has_role('accountant')
          OR public.has_role('storekeeper')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales_orders so
      WHERE so.id = sales_order_lines.sales_order_id
        AND public.is_company_member(so.company_id)
        AND (so.branch_id IS NULL OR public.is_branch_authorized(so.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('operations_manager')
          OR public.has_role('accountant')
          OR public.has_role('storekeeper')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Policies: invoices & invoice_lines
-- ---------------------------------------------------------------------------
CREATE POLICY rls_invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      -- Staff with branch authorization
      (
        NOT public.has_role('customer')
        AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
      )
      -- Customer Portal
      OR (
        public.has_role('customer')
        AND customer_id = public.get_current_customer_id()
        AND status IN ('issued', 'partially_paid', 'paid', 'overdue')
      )
    )
  );

CREATE POLICY rls_invoices_modify ON public.invoices
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('accountant')
      OR public.has_role('operations_manager')
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (
      public.has_role('owner_admin')
      OR public.has_role('accountant')
      OR public.has_role('operations_manager')
    )
  );

CREATE POLICY rls_invoice_lines_select ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.id = invoice_lines.invoice_id
    )
  );

CREATE POLICY rls_invoice_lines_modify ON public.invoice_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.id = invoice_lines.invoice_id
        AND public.is_company_member(inv.company_id)
        AND (inv.branch_id IS NULL OR public.is_branch_authorized(inv.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('accountant')
          OR public.has_role('operations_manager')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.id = invoice_lines.invoice_id
        AND public.is_company_member(inv.company_id)
        AND (inv.branch_id IS NULL OR public.is_branch_authorized(inv.branch_id))
        AND (
          public.has_role('owner_admin')
          OR public.has_role('accountant')
          OR public.has_role('operations_manager')
        )
    )
  );

CREATE POLICY rls_invoice_history_select ON public.invoice_status_history
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 6. Policies: credit_notes, payments & allocations
-- ---------------------------------------------------------------------------
CREATE POLICY rls_credit_notes_select ON public.credit_notes
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      (
        NOT public.has_role('customer')
        AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
      )
      OR (
        public.has_role('customer')
        AND customer_id = public.get_current_customer_id()
        AND status IN ('approved', 'issued', 'applied')
      )
    )
  );

CREATE POLICY rls_credit_notes_modify ON public.credit_notes
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );

CREATE POLICY rls_credit_note_lines_select ON public.credit_note_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.credit_notes cn
      WHERE cn.id = credit_note_lines.credit_note_id
    )
  );

CREATE POLICY rls_credit_note_lines_modify ON public.credit_note_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.credit_notes cn
      WHERE cn.id = credit_note_lines.credit_note_id
        AND public.is_company_member(cn.company_id)
        AND (cn.branch_id IS NULL OR public.is_branch_authorized(cn.branch_id))
        AND (public.has_role('owner_admin') OR public.has_role('accountant'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.credit_notes cn
      WHERE cn.id = credit_note_lines.credit_note_id
        AND public.is_company_member(cn.company_id)
        AND (cn.branch_id IS NULL OR public.is_branch_authorized(cn.branch_id))
        AND (public.has_role('owner_admin') OR public.has_role('accountant'))
    )
  );

CREATE POLICY rls_payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      (
        NOT public.has_role('customer')
        AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
      )
      OR (
        public.has_role('customer')
        AND customer_id = public.get_current_customer_id()
      )
    )
  );

CREATE POLICY rls_payments_modify ON public.payments
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (branch_id IS NULL OR public.is_branch_authorized(branch_id))
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );

CREATE POLICY rls_payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      NOT public.has_role('customer')
      OR EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = payment_allocations.payment_id
          AND p.customer_id = public.get_current_customer_id()
      )
    )
  );

CREATE POLICY rls_payment_allocations_modify ON public.payment_allocations
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );

-- ---------------------------------------------------------------------------
-- 7. Policies: payment_providers & payment_transactions
-- ---------------------------------------------------------------------------
CREATE POLICY rls_payment_providers_select ON public.payment_providers
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY rls_payment_providers_modify ON public.payment_providers
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );

CREATE POLICY rls_payment_trans_select ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY rls_payment_trans_modify ON public.payment_transactions
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role('owner_admin') OR public.has_role('accountant'))
  );
