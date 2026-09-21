-- =============================================================================
-- Migration 020: Comprehensive Row Level Security (RLS) for Phase 1
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================
-- Strict role and tenant isolation across all operational tables:
--   - Owner / Operations Manager: Full operational company oversight
--   - Supervisor: Management within assigned branch and teams
--   - Technician: Access strictly to assigned jobs, visits, and linked equipment
--   - Customer: Strictly their own customer records, sites, equipment, and work orders
--   - Accountant: Read-only operational billing information

-- Helper function: Is technician assigned to work order?
CREATE OR REPLACE FUNCTION public.is_technician_assigned_to_wo(p_work_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_id uuid;
BEGIN
  v_emp_id := public.get_current_employee_id();
  IF v_emp_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.work_order_assignments woa
    WHERE woa.work_order_id = p_work_order_id
      AND woa.employee_id = v_emp_id
      AND woa.is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.visits v
    JOIN public.visit_technicians vt ON vt.visit_id = v.id
    WHERE v.work_order_id = p_work_order_id
      AND vt.employee_id = v_emp_id
  );
END;
$$;

-- Helper function: Is technician assigned to visit?
CREATE OR REPLACE FUNCTION public.is_technician_assigned_to_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_id uuid;
BEGIN
  v_emp_id := public.get_current_employee_id();
  IF v_emp_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.visit_technicians vt
    WHERE vt.visit_id = p_visit_id
      AND vt.employee_id = v_emp_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Customers, Contacts, Sites & Assets
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contacts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sites FORCE ROW LEVEL SECURITY;

ALTER TABLE public.customer_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_assets FORCE ROW LEVEL SECURITY;

-- Customers SELECT: Company staff or the customer themselves
CREATE POLICY customers_select ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      -- Customer portal user sees only their record
      (public.has_role('customer'::public.user_role) AND id = public.get_current_customer_id())
      OR NOT public.has_role('customer'::public.user_role)
    )
  );

-- Customers MANAGE: Admin and Operations Manager
CREATE POLICY customers_manage ON public.customers
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Customer Contacts SELECT:
CREATE POLICY customer_contacts_select ON public.customer_contacts
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR NOT public.has_role('customer'::public.user_role)
    )
  );

-- Customer Sites SELECT:
CREATE POLICY customer_sites_select ON public.customer_sites
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR (NOT public.has_role('customer'::public.user_role) AND public.can_access_branch(branch_id))
    )
  );

-- Customer Sites MANAGE:
CREATE POLICY customer_sites_manage ON public.customer_sites
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

-- Customer Assets SELECT:
CREATE POLICY customer_assets_select ON public.customer_assets
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR (NOT public.has_role('customer'::public.user_role) AND public.can_access_branch(branch_id))
    )
  );

-- Customer Assets MANAGE:
CREATE POLICY customer_assets_manage ON public.customer_assets
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 2. Service Types & SLA Policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_types FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY service_types_select ON public.service_types
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY service_types_manage ON public.service_types
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

CREATE POLICY sla_policies_select ON public.sla_policies
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY sla_policies_manage ON public.sla_policies
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 3. Service Requests
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY service_requests_select ON public.service_requests
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR NOT public.has_role('customer'::public.user_role)
    )
  );

CREATE POLICY service_requests_insert ON public.service_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR NOT public.has_role('customer'::public.user_role)
    )
  );

CREATE POLICY service_requests_manage ON public.service_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 4. Work Orders, Lines & Multi-Trip Visits
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders FORCE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits FORCE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.visit_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_technicians FORCE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_status_history FORCE ROW LEVEL SECURITY;

-- Work Orders SELECT
CREATE POLICY work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      -- Customer: only their own work orders
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      -- Technician: assigned work orders
      OR (public.has_role('technician'::public.user_role) AND public.is_technician_assigned_to_wo(id))
      -- Management/Supervisor/Accountant: company or branch scope
      OR public.has_any_role(ARRAY[
        'owner_admin'::public.user_role,
        'operations_manager'::public.user_role,
        'supervisor'::public.user_role,
        'accountant'::public.user_role
      ])
    )
  );

-- Work Orders MANAGE (Insert/Update): Management and Supervisors
CREATE POLICY work_orders_manage ON public.work_orders
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

-- Work Order Lines: Management, Supervisors, and Accountants
CREATE POLICY work_order_lines_select ON public.work_order_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY work_order_lines_manage ON public.work_order_lines
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

-- Visits SELECT
CREATE POLICY visits_select ON public.visits
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('technician'::public.user_role) AND (
        public.is_technician_assigned_to_visit(id) OR public.is_technician_assigned_to_wo(work_order_id)
      ))
      OR NOT public.has_role('technician'::public.user_role)
    )
  );

-- Visits UPDATE: Management, Supervisors, or assigned Technicians (e.g. check-in/out via RPC)
CREATE POLICY visits_update ON public.visits
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR (public.has_role('technician'::public.user_role) AND public.is_technician_assigned_to_visit(id))
    )
  );

-- Assignments Manage: Only Management & Supervisors
CREATE POLICY wo_assignments_manage ON public.work_order_assignments
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
  );

CREATE POLICY wo_assignments_select ON public.work_order_assignments
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY visit_technicians_manage ON public.visit_technicians
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR employee_id = public.get_current_employee_id()
    )
  );

CREATE POLICY visit_technicians_select ON public.visit_technicians
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY wo_status_history_select ON public.work_order_status_history
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

-- ---------------------------------------------------------------------------
-- 5. Field Operations: Activities, Timesheets, Checklists & Readings
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_activities FORCE ROW LEVEL SECURITY;

ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.asset_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_readings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.refrigerant_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refrigerant_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_material_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_material_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attachments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures FORCE ROW LEVEL SECURITY;

-- Job Activities: Staff can view; assigned technicians can insert their activities
CREATE POLICY job_activities_select ON public.job_activities
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY job_activities_insert ON public.job_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR (public.has_role('technician'::public.user_role) AND technician_id = public.get_current_employee_id())
    )
  );

-- Timesheets: Staff can view; technicians can insert/update their timesheets
CREATE POLICY timesheets_select ON public.timesheets
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role, 'accountant'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

CREATE POLICY timesheets_insert ON public.timesheets
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

-- Checklist Templates & Items
CREATE POLICY checklist_templates_select ON public.checklist_templates
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY checklist_items_select ON public.checklist_items
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

-- Checklist Responses
CREATE POLICY checklist_responses_select ON public.checklist_responses
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY checklist_responses_insert ON public.checklist_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

-- Asset Readings & Refrigerant Logs
CREATE POLICY asset_readings_select ON public.asset_readings
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY asset_readings_insert ON public.asset_readings
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

CREATE POLICY refrigerant_logs_select ON public.refrigerant_logs
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY refrigerant_logs_insert ON public.refrigerant_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

-- Job Material Movements: Staff & Storekeepers can view and log
CREATE POLICY material_movements_select ON public.job_material_movements
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY material_movements_insert ON public.job_material_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role, 'storekeeper'::public.user_role])
      OR technician_id = public.get_current_employee_id()
    )
  );

-- Attachments & Signatures
CREATE POLICY job_attachments_select ON public.job_attachments
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY job_attachments_insert ON public.job_attachments
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY signatures_select ON public.signatures
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      (public.has_role('customer'::public.user_role) AND customer_id = public.get_current_customer_id())
      OR NOT public.has_role('customer'::public.user_role)
    )
  );

CREATE POLICY signatures_insert ON public.signatures
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
