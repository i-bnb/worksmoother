-- =============================================================================
-- Migration 018: Technician Field Operations & Data Capture
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================
-- Comprehensive field data collection for technicians:
--   - job_activities: Discrete work events (inspected, repaired, gas-charged, etc.)
--   - timesheets: Travel, on-site, and paused time with server-calculated durations
--   - checklist_templates / checklist_items / checklist_responses: Dynamic service checks
--   - asset_readings: Pressures, voltages, temperatures (before & after indicators)
--   - refrigerant_logs: Gas type, cylinder tracking, charged/recovered quantities
--   - job_material_movements: Installed & removed parts foundation
--   - job_attachments: Photos & documents linked to Supabase storage
--   - signatures: Customer sign-offs attached to visits

-- ---------------------------------------------------------------------------
-- 1. Table: job_activities
-- ---------------------------------------------------------------------------
CREATE TABLE public.job_activities (
  id                uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id     uuid                  NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id          uuid                  NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  technician_id     uuid                  NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  linked_asset_id   uuid                  REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  activity_type     public.activity_type  NOT NULL,
  description       text                  NOT NULL,
  start_time        timestamptz,
  end_time          timestamptz,
  idempotency_key   text,
  metadata          jsonb                 NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz           NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_activities_visit ON public.job_activities (visit_id, created_at);
CREATE INDEX idx_job_activities_wo    ON public.job_activities (work_order_id);
CREATE INDEX idx_job_activities_asset ON public.job_activities (linked_asset_id) WHERE linked_asset_id IS NOT NULL;
CREATE UNIQUE INDEX uq_job_activities_idempotency
  ON public.job_activities (visit_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.job_activities IS 'Immutable log of distinct actions performed by technicians during a visit.';

-- ---------------------------------------------------------------------------
-- 2. Table: timesheets (Technician Labor Duration Tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE public.timesheets (
  id                uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  visit_id          uuid                      NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  work_order_id     uuid                      NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  technician_id     uuid                      NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category          public.timesheet_category NOT NULL DEFAULT 'on_site',
  start_time        timestamptz               NOT NULL,
  end_time          timestamptz,
  duration_minutes  integer,
  notes             text,
  idempotency_key   text,
  created_at        timestamptz               NOT NULL DEFAULT now(),
  updated_at        timestamptz               NOT NULL DEFAULT now(),

  CONSTRAINT chk_timesheet_bounds CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE INDEX idx_timesheets_technician ON public.timesheets (technician_id, start_time);
CREATE INDEX idx_timesheets_visit      ON public.timesheets (visit_id);
CREATE UNIQUE INDEX uq_timesheets_idempotency
  ON public.timesheets (visit_id, technician_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Trigger: Server-side duration calculation to prevent client tampering
CREATE OR REPLACE FUNCTION public.calculate_timesheet_duration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.end_time IS NOT NULL AND NEW.start_time IS NOT NULL THEN
    NEW.duration_minutes := ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60);
  ELSE
    NEW.duration_minutes := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_timesheets_duration
  BEFORE INSERT OR UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.calculate_timesheet_duration();

CREATE TRIGGER set_timesheets_updated_at
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.timesheets IS 'Individual crew member labor and travel time per visit with verified server duration.';

-- ---------------------------------------------------------------------------
-- 3. Dynamic Checklist Foundation
-- ---------------------------------------------------------------------------
CREATE TABLE public.checklist_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_type_id uuid        REFERENCES public.service_types(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  description     text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_templates_st ON public.checklist_templates (service_type_id, is_active);

CREATE TRIGGER set_checklist_templates_updated_at
  BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE public.checklist_items (
  id              uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid                          NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  company_id      uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sequence        integer                       NOT NULL DEFAULT 1,
  title           text                          NOT NULL,
  description     text,
  response_type   public.checklist_response_type NOT NULL DEFAULT 'pass_fail',
  is_required     boolean                       NOT NULL DEFAULT true,
  unit            text,
  min_value       numeric(10,2),
  max_value       numeric(10,2),
  created_at      timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_items_template ON public.checklist_items (template_id, sequence);

CREATE TABLE public.checklist_responses (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  visit_id          uuid          NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  checklist_item_id uuid          NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  technician_id     uuid          NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  response_value    text,
  is_passed         boolean,
  numeric_value     numeric(12,4),
  notes             text,
  idempotency_key   text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_checklist_responses_item ON public.checklist_responses (visit_id, checklist_item_id);
CREATE INDEX idx_checklist_responses_visit ON public.checklist_responses (visit_id);

CREATE TRIGGER set_checklist_responses_updated_at
  BEFORE UPDATE ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 4. Table: asset_readings (Quantitative Engineering Measurements)
-- ---------------------------------------------------------------------------
CREATE TABLE public.asset_readings (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id uuid                NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id      uuid                NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  asset_id      uuid                NOT NULL REFERENCES public.customer_assets(id) ON DELETE CASCADE,
  technician_id uuid                NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  reading_type  public.reading_type NOT NULL,
  value         numeric(12,4)       NOT NULL,
  unit          text                NOT NULL,
  is_before     boolean             NOT NULL DEFAULT false,
  notes         text,
  recorded_at   timestamptz         NOT NULL DEFAULT now(),
  created_at    timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_readings_asset ON public.asset_readings (asset_id, recorded_at);
CREATE INDEX idx_asset_readings_visit ON public.asset_readings (visit_id);

COMMENT ON TABLE public.asset_readings IS 'Structured instrumentation readings (pressure, current, voltage, temperature) taken during visits.';

-- ---------------------------------------------------------------------------
-- 5. Table: refrigerant_logs (Environmental Gas Tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE public.refrigerant_logs (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id         uuid          NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id              uuid          NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  asset_id              uuid          REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  technician_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  refrigerant_type      text          NOT NULL,
  cylinder_id           text,
  quantity_charged_kg   numeric(8,3)  NOT NULL DEFAULT 0.000 CHECK (quantity_charged_kg >= 0),
  quantity_recovered_kg numeric(8,3)  NOT NULL DEFAULT 0.000 CHECK (quantity_recovered_kg >= 0),
  notes                 text,
  recorded_at           timestamptz   NOT NULL DEFAULT now(),
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_refrigerant_logs_asset ON public.refrigerant_logs (asset_id);
CREATE INDEX idx_refrigerant_logs_visit ON public.refrigerant_logs (visit_id);

COMMENT ON TABLE public.refrigerant_logs IS 'Accurate environmental record of HVAC gas charging and recovery operations.';

-- ---------------------------------------------------------------------------
-- 6. Table: job_material_movements (Parts Movement Foundation)
-- ---------------------------------------------------------------------------
CREATE TABLE public.job_material_movements (
  id                uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id     uuid                          NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id          uuid                          NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  technician_id     uuid                          NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  movement_type     public.material_movement_type NOT NULL,
  item_code         text                          NOT NULL,
  item_name         text                          NOT NULL,
  quantity          numeric(10,2)                 NOT NULL DEFAULT 1.00 CHECK (quantity > 0),
  serial_number     text,
  source_location   text,
  coverage          public.material_coverage      NOT NULL DEFAULT 'chargeable',
  is_billable       boolean                       NOT NULL DEFAULT true,
  condition         text,
  disposition       public.material_disposition,
  reason            text,
  created_at        timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX idx_material_movements_visit ON public.job_material_movements (visit_id);
CREATE INDEX idx_material_movements_item  ON public.job_material_movements (item_code);

COMMENT ON TABLE public.job_material_movements IS 'Records component installations and removals on site for future inventory integration.';

-- ---------------------------------------------------------------------------
-- 7. Table: job_attachments (Storage Metadata Linkage)
-- ---------------------------------------------------------------------------
CREATE TABLE public.job_attachments (
  id                  uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id       uuid                      REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id            uuid                      REFERENCES public.visits(id) ON DELETE CASCADE,
  activity_id         uuid                      REFERENCES public.job_activities(id) ON DELETE SET NULL,
  asset_id            uuid                      REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  service_request_id  uuid                      REFERENCES public.service_requests(id) ON DELETE SET NULL,
  category            public.attachment_category NOT NULL DEFAULT 'before',
  file_name           text                      NOT NULL,
  storage_bucket      text                      NOT NULL,
  storage_path        text                      NOT NULL,
  file_size           integer,
  mime_type           text,
  uploaded_by         uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz               NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_attachments_visit ON public.job_attachments (visit_id);
CREATE INDEX idx_job_attachments_wo    ON public.job_attachments (work_order_id);
CREATE INDEX idx_job_attachments_asset ON public.job_attachments (asset_id) WHERE asset_id IS NOT NULL;

COMMENT ON TABLE public.job_attachments IS 'Metadata registry linking files in Supabase Storage to specific operational records.';

-- ---------------------------------------------------------------------------
-- 8. Table: signatures (Customer Sign-Off Records)
-- ---------------------------------------------------------------------------
CREATE TABLE public.signatures (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  visit_id                uuid        NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  customer_id             uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  signer_name             text        NOT NULL,
  signer_designation      text,
  signer_phone            text,
  signature_storage_path  text        NOT NULL,
  remarks                 text,
  signed_at               timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_signatures_visit ON public.signatures (visit_id);

COMMENT ON TABLE public.signatures IS 'Customer electronic verification signature and confirmation captured upon visit completion.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('job_activities');
SELECT public.attach_audit_trigger('timesheets');
SELECT public.attach_audit_trigger('checklist_templates');
SELECT public.attach_audit_trigger('checklist_items');
SELECT public.attach_audit_trigger('checklist_responses');
SELECT public.attach_audit_trigger('asset_readings');
SELECT public.attach_audit_trigger('refrigerant_logs');
SELECT public.attach_audit_trigger('job_material_movements');
SELECT public.attach_audit_trigger('job_attachments');
SELECT public.attach_audit_trigger('signatures');
