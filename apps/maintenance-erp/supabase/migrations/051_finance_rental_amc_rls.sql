-- =============================================================================
-- Migration 051: Comprehensive Multi-Tenant RLS for Finance, Rental & AMC
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================

-- Enable Row Level Security across all Phase 3 tables
ALTER TABLE public.account_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bill_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rental_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contracts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contract_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_reservations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_returns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_charges         ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.amc_contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_contract_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_schedules          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. Finance & Accounting Policies (Accountant, Admin & Operations)
-- ---------------------------------------------------------------------------

-- account_groups: Company members can view; Accountants/Admins can manage
CREATE POLICY account_groups_select ON public.account_groups
  FOR SELECT USING (public.is_company_member(company_id));

CREATE POLICY account_groups_manage ON public.account_groups
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

-- chart_of_accounts: Company members can view; Accountants/Admins can manage
CREATE POLICY coa_select ON public.chart_of_accounts
  FOR SELECT USING (public.is_company_member(company_id));

CREATE POLICY coa_manage ON public.chart_of_accounts
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

-- accounting_periods: Company members can view; Accountants/Admins can manage
CREATE POLICY periods_select ON public.accounting_periods
  FOR SELECT USING (public.is_company_member(company_id));

CREATE POLICY periods_manage ON public.accounting_periods
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

-- cost_centers: Company members can view; Admins/Managers can manage
CREATE POLICY cost_centers_select ON public.cost_centers
  FOR SELECT USING (public.is_company_member(company_id));

CREATE POLICY cost_centers_manage ON public.cost_centers
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'accountant'::public.user_role])
  );

-- bank_accounts: Accountants & Admins only
CREATE POLICY bank_accounts_select ON public.bank_accounts
  FOR SELECT USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

CREATE POLICY bank_accounts_manage ON public.bank_accounts
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

-- journal_entries: Accountants & Admins can read & manage; others denied
CREATE POLICY journals_select ON public.journal_entries
  FOR SELECT USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

CREATE POLICY journals_manage ON public.journal_entries
  FOR ALL USING (
    public.is_company_member(company_id) AND
    (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
  );

-- journal_lines: Tied to journal_entries company membership & accountant/admin role
CREATE POLICY journal_lines_select ON public.journal_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.is_company_member(je.company_id)
        AND (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
    )
  );

CREATE POLICY journal_lines_manage ON public.journal_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.is_company_member(je.company_id)
        AND (public.has_role('accountant'::public.user_role) OR public.has_role('owner_admin'::public.user_role))
    )
  );

-- supplier_bills & lines: Company internal staff can view; Accountants & Admins manage
CREATE POLICY supplier_bills_select ON public.supplier_bills
  FOR SELECT USING (
    public.is_company_member(company_id) AND
    NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY supplier_bills_manage ON public.supplier_bills
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'accountant'::public.user_role, 'operations_manager'::public.user_role])
  );

CREATE POLICY supplier_bill_lines_select ON public.supplier_bill_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.supplier_bills sb
      WHERE sb.id = supplier_bill_lines.bill_id
        AND public.is_company_member(sb.company_id)
        AND NOT public.has_role('customer'::public.user_role)
    )
  );

CREATE POLICY supplier_bill_lines_manage ON public.supplier_bill_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.supplier_bills sb
      WHERE sb.id = supplier_bill_lines.bill_id
        AND public.is_company_member(sb.company_id)
        AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'accountant'::public.user_role])
    )
  );

-- supplier_payments: Accountants & Admins
CREATE POLICY supplier_payments_policy ON public.supplier_payments
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'accountant'::public.user_role])
  );

-- expenses: Staff can create/view their own; Managers & Accountants can view/approve all
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT USING (
    public.is_company_member(company_id) AND (
      created_by = auth.uid() OR
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.profile_id = auth.uid()) OR
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'accountant'::public.user_role])
    )
  );

CREATE POLICY expenses_manage ON public.expenses
  FOR ALL USING (
    public.is_company_member(company_id) AND (
      created_by = auth.uid() OR
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'accountant'::public.user_role])
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Rental Subsystem Policies (Operations, Storekeepers & Customer Portal)
-- ---------------------------------------------------------------------------

-- rental_assets: Internal staff can view; Storekeepers & Managers can manage
CREATE POLICY rental_assets_select ON public.rental_assets
  FOR SELECT USING (
    public.is_company_member(company_id) AND
    NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY rental_assets_manage ON public.rental_assets
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

-- rental_contracts: Staff can view; Customers can only view their own
CREATE POLICY rental_contracts_select ON public.rental_contracts
  FOR SELECT USING (
    public.is_company_member(company_id) AND (
      NOT public.has_role('customer'::public.user_role) OR
      customer_id = public.get_current_customer_id()
    )
  );

CREATE POLICY rental_contracts_manage ON public.rental_contracts
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

CREATE POLICY rental_contract_lines_select ON public.rental_contract_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = rental_contract_lines.rental_contract_id
        AND public.is_company_member(rc.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR rc.customer_id = public.get_current_customer_id())
    )
  );

CREATE POLICY rental_contract_lines_manage ON public.rental_contract_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = rental_contract_lines.rental_contract_id
        AND public.is_company_member(rc.company_id)
        AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );

-- rental_reservations, deliveries, returns, charges:
CREATE POLICY rental_reservations_policy ON public.rental_reservations
  FOR ALL USING (
    public.is_company_member(company_id) AND
    NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY rental_deliveries_select ON public.rental_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = rental_deliveries.rental_contract_id
        AND public.is_company_member(rc.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR rc.customer_id = public.get_current_customer_id())
    )
  );

CREATE POLICY rental_returns_select ON public.rental_returns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = rental_returns.rental_contract_id
        AND public.is_company_member(rc.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR rc.customer_id = public.get_current_customer_id())
    )
  );

CREATE POLICY rental_charges_select ON public.rental_charges
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = rental_charges.rental_contract_id
        AND public.is_company_member(rc.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR rc.customer_id = public.get_current_customer_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. AMC Subsystem Policies (Operations, Technicians & Customer Portal)
-- ---------------------------------------------------------------------------

-- amc_contracts: Staff can view; Customers can only view their own
CREATE POLICY amc_contracts_select ON public.amc_contracts
  FOR SELECT USING (
    public.is_company_member(company_id) AND (
      NOT public.has_role('customer'::public.user_role) OR
      customer_id = public.get_current_customer_id()
    )
  );

CREATE POLICY amc_contracts_manage ON public.amc_contracts
  FOR ALL USING (
    public.is_company_member(company_id) AND
    public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

CREATE POLICY amc_contract_assets_select ON public.amc_contract_assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.amc_contracts ac
      WHERE ac.id = amc_contract_assets.amc_contract_id
        AND public.is_company_member(ac.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR ac.customer_id = public.get_current_customer_id())
    )
  );

CREATE POLICY amc_contract_assets_manage ON public.amc_contract_assets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.amc_contracts ac
      WHERE ac.id = amc_contract_assets.amc_contract_id
        AND public.is_company_member(ac.company_id)
        AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );

CREATE POLICY amc_schedules_select ON public.amc_schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.amc_contracts ac
      WHERE ac.id = amc_schedules.amc_contract_id
        AND public.is_company_member(ac.company_id)
        AND (NOT public.has_role('customer'::public.user_role) OR ac.customer_id = public.get_current_customer_id())
    )
  );

CREATE POLICY amc_schedules_manage ON public.amc_schedules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.amc_contracts ac
      WHERE ac.id = amc_schedules.amc_contract_id
        AND public.is_company_member(ac.company_id)
        AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );
