-- =============================================================================
-- Migration 015: Service Types & SLA Policies
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: service_types
-- ---------------------------------------------------------------------------
CREATE TABLE public.service_types (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  code                  text        NOT NULL,
  multilingual_name     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  description           text,
  default_sla_policy_id uuid,       -- FK added after sla_policies table creation
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_service_types_company_code ON public.service_types (company_id, code);
CREATE INDEX idx_service_types_company_active ON public.service_types (company_id, is_active);

CREATE TRIGGER set_service_types_updated_at
  BEFORE UPDATE ON public.service_types
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.service_types IS 'Master catalogue of maintenance service disciplines with multilingual naming.';

-- ---------------------------------------------------------------------------
-- 2. Table: sla_policies
-- ---------------------------------------------------------------------------
CREATE TABLE public.sla_policies (
  id                    uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_type_id       uuid                        REFERENCES public.service_types(id) ON DELETE CASCADE,
  priority              public.work_order_priority  NOT NULL,
  name                  text                        NOT NULL,
  response_time_hours   numeric(6,2)                NOT NULL DEFAULT 4.00 CHECK (response_time_hours > 0),
  resolution_time_hours numeric(6,2)                NOT NULL DEFAULT 24.00 CHECK (resolution_time_hours > 0),
  escalation_rules      jsonb                       NOT NULL DEFAULT '[]'::jsonb,
  is_active             boolean                     NOT NULL DEFAULT true,
  created_at            timestamptz                 NOT NULL DEFAULT now(),
  updated_at            timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_sla_times CHECK (resolution_time_hours >= response_time_hours)
);

-- Unique SLA rule per company, service_type, and priority
CREATE UNIQUE INDEX uq_sla_policies_scope
  ON public.sla_policies (company_id, COALESCE(service_type_id, '00000000-0000-0000-0000-000000000000'::uuid), priority);

CREATE INDEX idx_sla_policies_lookup ON public.sla_policies (company_id, priority, is_active);

CREATE TRIGGER set_sla_policies_updated_at
  BEFORE UPDATE ON public.sla_policies
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.sla_policies IS 'Service Level Agreement targets defining max response and resolution hours by priority.';

-- Add Foreign Key from service_types to sla_policies
ALTER TABLE public.service_types
  ADD CONSTRAINT fk_service_types_default_sla
  FOREIGN KEY (default_sla_policy_id) REFERENCES public.sla_policies(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Function: Calculate SLA Due Timestamps
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_sla_due_dates(
  p_sla_policy_id uuid,
  p_start_time timestamptz DEFAULT now()
)
RETURNS TABLE (
  response_due_at timestamptz,
  resolution_due_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resp_hours numeric(6,2);
  v_resol_hours numeric(6,2);
BEGIN
  SELECT response_time_hours, resolution_time_hours
  INTO v_resp_hours, v_resol_hours
  FROM public.sla_policies
  WHERE id = p_sla_policy_id;

  IF v_resp_hours IS NULL THEN
    -- Fallback default: 4 hours response, 24 hours resolution
    v_resp_hours := 4.0;
    v_resol_hours := 24.0;
  END IF;

  RETURN QUERY SELECT
    (p_start_time + (v_resp_hours || ' hours')::interval),
    (p_start_time + (v_resol_hours || ' hours')::interval);
END;
$$;

COMMENT ON FUNCTION public.calculate_sla_due_dates(uuid, timestamptz) IS 'Calculates deadline timestamps for SLA response and resolution.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('service_types');
SELECT public.attach_audit_trigger('sla_policies');
