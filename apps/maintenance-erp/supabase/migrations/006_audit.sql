-- =============================================================================
-- Migration 006: Reusable Audit Logging System
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Automatically captures row-level INSERT, UPDATE, and DELETE operations.
-- Features:
--   - Captures table name, primary key, action, user_id, company_id, old/new jsonb values
--   - Captures request_id and client IP if available in session headers
--   - Single generic trigger function; no duplicated trigger logic
--   - Helper procedure to attach trigger to any current or future business table
--   - Immutable audit trail: direct UPDATE or DELETE on audit_log is strictly prohibited

-- ---------------------------------------------------------------------------
-- 1. Table: audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE public.audit_log (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name    text                NOT NULL,
  record_id     uuid                NOT NULL,
  action        public.audit_action NOT NULL,
  user_id       uuid                REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id    uuid                REFERENCES public.companies(id) ON DELETE CASCADE,
  old_values    jsonb,
  new_values    jsonb,
  request_id    text,
  ip_address    text,
  created_at    timestamptz         NOT NULL DEFAULT now()
);

-- Optimized indexes for audit queries
CREATE INDEX idx_audit_log_company_time ON public.audit_log (company_id, created_at DESC);
CREATE INDEX idx_audit_log_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_user_action  ON public.audit_log (user_id, action);
CREATE INDEX idx_audit_log_created_at   ON public.audit_log (created_at DESC);

COMMENT ON TABLE public.audit_log IS 'Immutable audit trail capturing state changes on key business tables.';

-- ---------------------------------------------------------------------------
-- 2. Generic Audit Trigger Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_json jsonb := NULL;
  v_new_json jsonb := NULL;
  v_record_id uuid;
  v_company_id uuid := NULL;
  v_user_id uuid;
  v_request_id text := NULL;
  v_ip_address text := NULL;
  v_headers jsonb;
BEGIN
  -- Determine user ID
  v_user_id := auth.uid();

  -- Extract request context if running within PostgREST / Supabase API request
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
    IF v_headers IS NOT NULL THEN
      v_request_id := COALESCE(
        v_headers ->> 'x-request-id',
        v_headers ->> 'cf-ray',
        v_headers ->> 'x-correlation-id'
      );
      v_ip_address := COALESCE(
        v_headers ->> 'cf-connecting-ip',
        v_headers ->> 'x-forwarded-for',
        v_headers ->> 'x-real-ip'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback gracefully outside of HTTP context (e.g. CLI or background jobs)
    v_request_id := NULL;
    v_ip_address := NULL;
  END;

  -- Process operation-specific data
  IF (TG_OP = 'INSERT') THEN
    v_new_json := to_jsonb(NEW);
    v_record_id := (v_new_json ->> 'id')::uuid;
    
    -- Extract company_id from record or fallback to helper
    IF v_new_json ? 'company_id' AND v_new_json ->> 'company_id' IS NOT NULL THEN
      v_company_id := (v_new_json ->> 'company_id')::uuid;
    ELSIF TG_TABLE_NAME = 'companies' THEN
      v_company_id := v_record_id;
    ELSE
      v_company_id := public.get_current_company_id();
    END IF;

    INSERT INTO public.audit_log (
      table_name, record_id, action, user_id, company_id,
      old_values, new_values, request_id, ip_address, created_at
    ) VALUES (
      TG_TABLE_NAME, v_record_id, 'INSERT'::public.audit_action, v_user_id, v_company_id,
      NULL, v_new_json, v_request_id, v_ip_address, now()
    );

    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    v_record_id := (v_new_json ->> 'id')::uuid;

    IF v_new_json ? 'company_id' AND v_new_json ->> 'company_id' IS NOT NULL THEN
      v_company_id := (v_new_json ->> 'company_id')::uuid;
    ELSIF TG_TABLE_NAME = 'companies' THEN
      v_company_id := v_record_id;
    ELSE
      v_company_id := public.get_current_company_id();
    END IF;

    -- Avoid logging if row contents did not change
    IF v_old_json = v_new_json THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.audit_log (
      table_name, record_id, action, user_id, company_id,
      old_values, new_values, request_id, ip_address, created_at
    ) VALUES (
      TG_TABLE_NAME, v_record_id, 'UPDATE'::public.audit_action, v_user_id, v_company_id,
      v_old_json, v_new_json, v_request_id, v_ip_address, now()
    );

    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    v_old_json := to_jsonb(OLD);
    v_record_id := (v_old_json ->> 'id')::uuid;

    IF v_old_json ? 'company_id' AND v_old_json ->> 'company_id' IS NOT NULL THEN
      v_company_id := (v_old_json ->> 'company_id')::uuid;
    ELSIF TG_TABLE_NAME = 'companies' THEN
      v_company_id := v_record_id;
    ELSE
      v_company_id := public.get_current_company_id();
    END IF;

    INSERT INTO public.audit_log (
      table_name, record_id, action, user_id, company_id,
      old_values, new_values, request_id, ip_address, created_at
    ) VALUES (
      TG_TABLE_NAME, v_record_id, 'DELETE'::public.audit_action, v_user_id, v_company_id,
      v_old_json, NULL, v_request_id, v_ip_address, now()
    );

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.process_audit_log() IS 'Generic trigger function to populate audit_log with changes.';

-- ---------------------------------------------------------------------------
-- 3. Dynamic Helper to Attach Audit Trigger to Any Table
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_audit_trigger(target_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_audit_%1$I ON public.%1$I; ' ||
    'CREATE TRIGGER trg_audit_%1$I ' ||
    'AFTER INSERT OR UPDATE OR DELETE ON public.%1$I ' ||
    'FOR EACH ROW EXECUTE FUNCTION public.process_audit_log();',
    target_table_name
  );
END;
$$;

COMMENT ON FUNCTION public.attach_audit_trigger(text) IS 'Utility function to attach the standard audit trigger to any public table.';

-- ---------------------------------------------------------------------------
-- 4. Attach Audit Trigger to Initial Foundation Tables
-- ---------------------------------------------------------------------------
SELECT public.attach_audit_trigger('companies');
SELECT public.attach_audit_trigger('branches');
SELECT public.attach_audit_trigger('profiles');
SELECT public.attach_audit_trigger('user_roles');
SELECT public.attach_audit_trigger('employees');
SELECT public.attach_audit_trigger('teams');
SELECT public.attach_audit_trigger('team_members');

-- ---------------------------------------------------------------------------
-- 5. Row Level Security on audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

-- Select: Only owner_admin and accountant can view their company's audit log
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'accountant'::public.user_role])
  );

-- Immutability Protection: Disallow direct INSERT, UPDATE, DELETE from API clients
-- (All legitimate inserts are performed via SECURITY DEFINER process_audit_log trigger)
CREATE POLICY audit_log_deny_insert ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY audit_log_deny_update ON public.audit_log
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY audit_log_deny_delete ON public.audit_log
  FOR DELETE
  TO authenticated
  USING (false);
