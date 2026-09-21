-- =============================================================================
-- Migration 003: Profiles, Roles, Employees & Teams
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- auth.users is owned by Supabase. This migration creates:
--   profiles     → 1:1 extension of auth.users with business context
--   user_roles   → role assignments (a user may hold different roles per company/branch)
--   employees    → HR/operational record linked to a profile
--   teams        → grouping of employees
--   team_members → junction table

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Automatically populated when a user signs up (via Supabase trigger in 004).
CREATE TABLE public.profiles (
  id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
  branch_id     uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  full_name     text        NOT NULL DEFAULT '',
  phone         text,
  avatar_url    text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Tenant lookup
CREATE INDEX idx_profiles_company_id ON public.profiles (company_id);
CREATE INDEX idx_profiles_branch_id  ON public.profiles (branch_id);
CREATE INDEX idx_profiles_is_active  ON public.profiles (company_id, is_active);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.profiles IS 'Business-context extension of auth.users. Created automatically on user signup.';
COMMENT ON COLUMN public.profiles.company_id IS 'Primary company assignment. Drives RLS.';
COMMENT ON COLUMN public.profiles.branch_id  IS 'Default branch for the user. May be null for company-wide users.';

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------
-- A user may have multiple active role assignments (e.g., storekeeper at Branch A,
-- supervisor at Branch B). RLS helper functions use the MOST PRIVILEGED active role
-- for that company, or the most specific branch-scoped role.
CREATE TABLE public.user_roles (
  id            uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid              NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    uuid              NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id     uuid              REFERENCES public.branches(id) ON DELETE CASCADE,  -- NULL = company-wide
  role          public.user_role  NOT NULL,
  granted_by    uuid              REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at    timestamptz       NOT NULL DEFAULT now(),
  revoked_at    timestamptz,                    -- NULL means currently active
  is_active     boolean           NOT NULL DEFAULT true,
  created_at    timestamptz       NOT NULL DEFAULT now(),
  updated_at    timestamptz       NOT NULL DEFAULT now()
);

-- Only one active role per user per company per branch (NULL branch = company-wide slot)
-- Using a partial unique index to handle NULL branch_id correctly
CREATE UNIQUE INDEX uq_user_roles_active
  ON public.user_roles (user_id, company_id, role, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = true;

CREATE INDEX idx_user_roles_user_company ON public.user_roles (user_id, company_id);
CREATE INDEX idx_user_roles_company_role ON public.user_roles (company_id, role);
CREATE INDEX idx_user_roles_branch       ON public.user_roles (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX idx_user_roles_active       ON public.user_roles (user_id, is_active);

CREATE TRIGGER set_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.user_roles IS 'Role assignments. A user holds at most one active role per company/branch combination. Revoking sets is_active=false and revoked_at.';

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
-- Operational HR record. Not all auth users are employees (customers are not).
CREATE TABLE public.employees (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id       uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  employee_code   text        NOT NULL,
  job_title       text,
  department      text,
  hire_date       date,
  end_date        date,       -- null = currently employed
  is_active       boolean     NOT NULL DEFAULT true,
  notes           text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_employee_dates CHECK (end_date IS NULL OR end_date >= hire_date)
);

-- Employee code is unique within a company
CREATE UNIQUE INDEX uq_employees_code ON public.employees (company_id, employee_code);
-- A profile can only have one employee record per company
CREATE UNIQUE INDEX uq_employees_profile ON public.employees (company_id, profile_id);

CREATE INDEX idx_employees_company     ON public.employees (company_id);
CREATE INDEX idx_employees_branch      ON public.employees (branch_id);
CREATE INDEX idx_employees_is_active   ON public.employees (company_id, is_active);

CREATE TRIGGER set_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.employees IS 'HR/operational record for staff. Linked 1:1 to a profile within a company.';

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE public.teams (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id     uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  name          text        NOT NULL,
  description   text,
  team_lead_id  uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_teams_name ON public.teams (company_id, name);
CREATE INDEX idx_teams_company ON public.teams (company_id);
CREATE INDEX idx_teams_branch  ON public.teams (branch_id);

CREATE TRIGGER set_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.teams IS 'Groups of employees (typically technician teams). A team has one lead and belongs to a branch.';

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
CREATE TABLE public.team_members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  employee_id   uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  is_active     boolean     NOT NULL DEFAULT true,

  CONSTRAINT chk_team_member_dates CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- An employee can only be an active member of a team once
CREATE UNIQUE INDEX uq_team_members_active
  ON public.team_members (team_id, employee_id)
  WHERE is_active = true;

CREATE INDEX idx_team_members_team     ON public.team_members (team_id);
CREATE INDEX idx_team_members_employee ON public.team_members (employee_id);
CREATE INDEX idx_team_members_company  ON public.team_members (company_id);

COMMENT ON TABLE public.team_members IS 'Junction table: employee-to-team assignments. Employees may be in multiple teams.';

-- ---------------------------------------------------------------------------
-- Trigger: auto-create profile on auth.users insert
-- ---------------------------------------------------------------------------
-- When Supabase Auth creates a new user, we immediately create a stub profile.
-- The profile is populated with company/branch assignments separately (e.g., during onboarding).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent: safe to re-run
  RETURN NEW;
END;
$$;

-- Attach to auth schema (Supabase supports this)
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a stub profile row whenever a new auth.users row is inserted. Called by Supabase Auth after email verification or OTP confirmation.';
