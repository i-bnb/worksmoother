-- =============================================================================
-- Migration 005: Row Level Security (RLS) Policies
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Enables RLS on every organization and profile table.
-- Strict tenant isolation: no user can ever read, insert, update, or delete records
-- across company boundaries.
-- All policies utilize the helper functions defined in Migration 004.

-- ---------------------------------------------------------------------------
-- 1. Table: companies
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;

-- Select: Members can only view their own company
CREATE POLICY companies_select_tenant ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    id = public.get_current_company_id()
  );

-- Update: Only owner_admin can modify company details
CREATE POLICY companies_update_admin ON public.companies
  FOR UPDATE
  TO authenticated
  USING (
    id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  )
  WITH CHECK (
    id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  );

-- ---------------------------------------------------------------------------
-- 2. Table: branches
-- ---------------------------------------------------------------------------
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches FORCE ROW LEVEL SECURITY;

-- Select: Accessible to company members within their permitted branch scope
CREATE POLICY branches_select_scope ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.can_access_branch(id)
  );

-- Insert: Only owner_admin or operations_manager can create branches
CREATE POLICY branches_insert_management ON public.branches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Update: Only owner_admin or operations_manager can update branches
CREATE POLICY branches_update_management ON public.branches
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Delete: Only owner_admin can delete a branch
CREATE POLICY branches_delete_admin ON public.branches
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  );

-- ---------------------------------------------------------------------------
-- 3. Table: profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

-- Select: Users can view their own profile, or colleagues within the same company
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      company_id IS NOT NULL 
      AND company_id = public.get_current_company_id()
      AND (
        -- Customers can only see their own profile or assigned contact profiles
        NOT public.has_role('customer'::public.user_role)
        OR id = auth.uid()
      )
    )
  );

-- Insert: Users can insert their own profile (or handle_new_user trigger via security definer)
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid()
  );

-- Update: Users can update their own profile, or administrators can update profiles in their company
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Table: user_roles
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

-- Select: A user can see their own roles, or managers/admins can see all roles in their company
CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );

-- Insert: Only owner_admin and operations_manager can assign roles in their company
CREATE POLICY user_roles_insert_admin ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    -- Operations managers cannot grant owner_admin role
    AND (
      public.has_role('owner_admin'::public.user_role)
      OR role != 'owner_admin'::public.user_role
    )
  );

-- Update: Only owner_admin and operations_manager can modify roles
CREATE POLICY user_roles_update_admin ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    AND (
      public.has_role('owner_admin'::public.user_role)
      OR role != 'owner_admin'::public.user_role
    )
  );

-- Delete: Only owner_admin can delete a role assignment
CREATE POLICY user_roles_delete_admin ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  );

-- ---------------------------------------------------------------------------
-- 5. Table: employees
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;

-- Select: Employees can view their own record, or company staff can view employee list
CREATE POLICY employees_select ON public.employees
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      profile_id = auth.uid()
      OR (
        NOT public.has_role('customer'::public.user_role)
        AND public.can_access_branch(branch_id)
      )
    )
  );

-- Insert/Update: Only owner_admin, operations_manager, or supervisor (for their branch)
CREATE POLICY employees_modify_management ON public.employees
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

-- ---------------------------------------------------------------------------
-- 6. Tables: teams and team_members
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members FORCE ROW LEVEL SECURITY;

-- Teams Select: Company staff can view teams in their branch scope
CREATE POLICY teams_select ON public.teams
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
    AND public.can_access_branch(branch_id)
  );

-- Teams Manage: Admin, operations_manager, or supervisor
CREATE POLICY teams_manage ON public.teams
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
    AND public.can_access_branch(branch_id)
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
    AND public.can_access_branch(branch_id)
  );

-- Team Members Select:
CREATE POLICY team_members_select ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

-- Team Members Manage: Admin, operations_manager, or supervisor
CREATE POLICY team_members_manage ON public.team_members
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
