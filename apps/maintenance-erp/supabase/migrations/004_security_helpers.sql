-- =============================================================================
-- Migration 004: Security Helper Functions
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- High-performance, reusable PostgreSQL functions for authentication & authorization.
-- These functions are used in RLS policies across the entire schema.
-- They support both:
--   1. Direct lookup from public.profiles and public.user_roles tables
--   2. Direct extraction from Supabase Custom Access Token Hook JWT claims (app_metadata / user_metadata)
-- All helper functions are marked SECURITY DEFINER with fixed search_path to prevent search_path hijacking.

-- ---------------------------------------------------------------------------
-- 1. Helper: Current User ID
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid();
$$;

COMMENT ON FUNCTION public.get_current_user_id() IS 'Returns the authenticated user UUID from auth.uid().';

-- ---------------------------------------------------------------------------
-- 2. Helper: Current User JWT Claims (for Custom Access Token Hook preparation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_jwt_claim(claim_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
BEGIN
  -- Extract claims from current session setting if set by Supabase Auth
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;

  IF claims IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check root level, app_metadata, and user_metadata
  IF claims ? claim_key THEN
    RETURN claims ->> claim_key;
  ELSIF (claims -> 'app_metadata') ? claim_key THEN
    RETURN (claims -> 'app_metadata') ->> claim_key;
  ELSIF (claims -> 'user_metadata') ? claim_key THEN
    RETURN (claims -> 'user_metadata') ->> claim_key;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_jwt_claim(text) IS 'Extracts a claim from the Supabase JWT context (handles root, app_metadata, user_metadata).';

-- ---------------------------------------------------------------------------
-- 3. Helper: Current Company ID
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_company text;
  v_company_id uuid;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check JWT claim first (for Custom Access Token Hook optimization)
  v_jwt_company := public.get_jwt_claim('company_id');
  IF v_jwt_company IS NOT NULL AND v_jwt_company ~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN v_jwt_company::uuid;
  END IF;

  -- Fallback to database lookup in public.profiles
  SELECT p.company_id INTO v_company_id
  FROM public.profiles p
  WHERE p.id = v_uid AND p.is_active = true;

  RETURN v_company_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_company_id() IS 'Returns the active company_id for the current authenticated user (JWT claim or profiles lookup).';

-- ---------------------------------------------------------------------------
-- 4. Helper: Current Branch ID
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_branch_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_branch text;
  v_branch_id uuid;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check JWT claim first
  v_jwt_branch := public.get_jwt_claim('branch_id');
  IF v_jwt_branch IS NOT NULL AND v_jwt_branch ~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN v_jwt_branch::uuid;
  END IF;

  -- Fallback to database lookup in public.profiles
  SELECT p.branch_id INTO v_branch_id
  FROM public.profiles p
  WHERE p.id = v_uid AND p.is_active = true;

  RETURN v_branch_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_branch_id() IS 'Returns the active branch_id for the current authenticated user (JWT claim or profiles lookup).';

-- ---------------------------------------------------------------------------
-- 5. Helper: User Has Role in Current Company
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(required_role public.user_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_company_id uuid;
  v_has boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_company_id := public.get_current_company_id();
  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Direct verification against active user_roles table
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.company_id = v_company_id
      AND ur.role = required_role
      AND ur.is_active = true
      AND (ur.revoked_at IS NULL OR ur.revoked_at > now())
  ) INTO v_has;

  RETURN v_has;
END;
$$;

COMMENT ON FUNCTION public.has_role(public.user_role) IS 'Returns true if current user holds the specified active role in their current company.';

-- ---------------------------------------------------------------------------
-- 6. Helper: User Has Any of the Given Roles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles public.user_role[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_company_id uuid;
  v_has boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_company_id := public.get_current_company_id();
  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.company_id = v_company_id
      AND ur.role = ANY(required_roles)
      AND ur.is_active = true
      AND (ur.revoked_at IS NULL OR ur.revoked_at > now())
  ) INTO v_has;

  RETURN v_has;
END;
$$;

COMMENT ON FUNCTION public.has_any_role(public.user_role[]) IS 'Returns true if current user holds ANY of the specified active roles in their current company.';

-- ---------------------------------------------------------------------------
-- 7. Helper: Company Membership Check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_company_member(target_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_company_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN target_company_id = public.get_current_company_id();
END;
$$;

COMMENT ON FUNCTION public.is_company_member(uuid) IS 'Validates whether the given company_id matches the current authenticated user active company.';

-- ---------------------------------------------------------------------------
-- 8. Helper: Branch Access Check
-- ---------------------------------------------------------------------------
-- Rules:
-- - NULL branch on record means company-wide record: accessible to any permitted company user.
-- - Owner Admin has company-wide access to all branches.
-- - Operations Manager has company-wide access across all branches unless restricted.
-- - Other roles (supervisor, technician, storekeeper, etc.) can access:
--     a) records where target_branch_id is NULL (company-wide)
--     b) records where target_branch_id matches their profile branch_id
--     c) records where they hold a specific active user_role assigned to that branch
CREATE OR REPLACE FUNCTION public.can_access_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_company_id uuid;
  v_profile_branch uuid;
BEGIN
  IF target_branch_id IS NULL THEN
    RETURN true;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_company_id := public.get_current_company_id();
  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Ensure branch actually belongs to current user's company
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = target_branch_id
      AND b.company_id = v_company_id
      AND b.is_active = true
  ) THEN
    RETURN false;
  END IF;

  -- Owner Admin & Operations Manager have company-wide access across all branches
  IF public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role]) THEN
    RETURN true;
  END IF;

  -- Check if user profile default branch matches
  v_profile_branch := public.get_current_branch_id();
  IF v_profile_branch IS NOT NULL AND v_profile_branch = target_branch_id THEN
    RETURN true;
  END IF;

  -- Check if user has an explicit role mapped to this branch
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.company_id = v_company_id
      AND ur.branch_id = target_branch_id
      AND ur.is_active = true
      AND (ur.revoked_at IS NULL OR ur.revoked_at > now())
  );
END;
$$;

COMMENT ON FUNCTION public.can_access_branch(uuid) IS 'Determines if the authenticated user has permission to read or manipulate records for the given branch_id.';

-- ---------------------------------------------------------------------------
-- 9. Helper: Supabase Custom Access Token Hook (JWT Claim Enrichment)
-- ---------------------------------------------------------------------------
-- This function can be registered in Supabase Dashboard -> Authentication -> Hooks
-- as the "Custom Access Token (JWT) Hook".
-- When called by Supabase Auth upon minting a token, it injects company_id, branch_id, and role
-- into the JWT claims directly, making downstream RLS checks subquery-free!
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_company_id uuid;
  v_branch_id uuid;
  v_role text;
  v_claims jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims := event -> 'claims';

  -- Find active company and branch from profile
  SELECT p.company_id, p.branch_id
  INTO v_company_id, v_branch_id
  FROM public.profiles p
  WHERE p.id = v_user_id AND p.is_active = true;

  -- Find highest priority active role in that company
  IF v_company_id IS NOT NULL THEN
    SELECT ur.role::text
    INTO v_role
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.company_id = v_company_id
      AND ur.is_active = true
      AND (ur.revoked_at IS NULL OR ur.revoked_at > now())
    ORDER BY
      CASE ur.role
        WHEN 'owner_admin' THEN 1
        WHEN 'operations_manager' THEN 2
        WHEN 'supervisor' THEN 3
        WHEN 'accountant' THEN 4
        WHEN 'storekeeper' THEN 5
        WHEN 'technician' THEN 6
        WHEN 'customer' THEN 7
        ELSE 8
      END ASC
    LIMIT 1;
  END IF;

  -- Inject claims into JWT
  IF v_company_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{company_id}', to_jsonb(v_company_id::text));
  END IF;
  IF v_branch_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{branch_id}', to_jsonb(v_branch_id::text));
  END IF;
  IF v_role IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role));
  END IF;

  event := jsonb_set(event, '{claims}', v_claims);
  RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS 'Hook function for Supabase Custom Access Token (JWT) Hook. Enriches JWT with company_id, branch_id, and user_role.';
