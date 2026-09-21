-- =============================================================================
-- Migration 016: Service Requests Intake & SLA Tracking
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: service_requests
-- ---------------------------------------------------------------------------
CREATE TABLE public.service_requests (
  id                        uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id                 uuid                          REFERENCES public.branches(id) ON DELETE SET NULL,
  request_number            text                          NOT NULL,
  customer_id               uuid                          NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id                   uuid                          NOT NULL REFERENCES public.customer_sites(id) ON DELETE RESTRICT,
  asset_id                  uuid                          REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  service_type_id           uuid                          REFERENCES public.service_types(id) ON DELETE SET NULL,
  priority                  public.work_order_priority    NOT NULL DEFAULT 'medium',
  source                    public.service_request_source NOT NULL DEFAULT 'phone',
  description               text                          NOT NULL,
  requested_date            date                          NOT NULL DEFAULT CURRENT_DATE,
  language                  text                          NOT NULL DEFAULT 'en',
  status                    public.service_request_status NOT NULL DEFAULT 'new',
  sla_policy_id             uuid                          REFERENCES public.sla_policies(id) ON DELETE SET NULL,
  response_due_at           timestamptz,
  resolution_due_at         timestamptz,
  converted_work_order_id   uuid,                         -- FK reference added in migration 017
  created_by                uuid                          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz                   NOT NULL DEFAULT now(),
  updated_at                timestamptz                   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_service_requests_number ON public.service_requests (company_id, request_number);
CREATE INDEX idx_service_requests_customer ON public.service_requests (customer_id, status);
CREATE INDEX idx_service_requests_site     ON public.service_requests (site_id);
CREATE INDEX idx_service_requests_asset    ON public.service_requests (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_service_requests_sla      ON public.service_requests (company_id, status, resolution_due_at);

CREATE TRIGGER set_service_requests_updated_at
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.service_requests IS 'Customer service requests, complaint intake tickets, and conversion records.';

-- ---------------------------------------------------------------------------
-- 2. Trigger Function: Auto-populate Document Number & SLA Deadlines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_service_request_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sla_dates RECORD;
BEGIN
  -- 1. Auto-generate sequential Request Number if not provided
  IF NEW.request_number IS NULL OR trim(NEW.request_number) = '' THEN
    NEW.request_number := public.generate_document_number(
      NEW.company_id,
      'SR'::public.document_type,
      NEW.branch_id
    );
  END IF;

  -- 2. If SLA policy is attached, compute response and resolution deadlines
  IF NEW.sla_policy_id IS NOT NULL THEN
    SELECT * INTO v_sla_dates
    FROM public.calculate_sla_due_dates(NEW.sla_policy_id, NEW.created_at);

    IF v_sla_dates IS NOT NULL THEN
      NEW.response_due_at := COALESCE(NEW.response_due_at, v_sla_dates.response_due_at);
      NEW.resolution_due_at := COALESCE(NEW.resolution_due_at, v_sla_dates.resolution_due_at);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_request_auto_fields
  BEFORE INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_service_request_before_insert();

-- Attach audit trigger
SELECT public.attach_audit_trigger('service_requests');
