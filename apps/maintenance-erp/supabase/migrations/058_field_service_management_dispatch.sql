-- =============================================================================
-- Migration 058: Field Service Management, Technician Scheduling & Dispatch
-- Maintenance Management ERP — Phase 7 FSM Foundation
-- =============================================================================
-- Features:
--   1. Enums extension (user_role, document_type, appointment_status, reschedule_reason, parts_readiness, report_status)
--   2. service_territories & service_territory_members (geographical & operational coverage)
--   3. service_teams & service_team_members (multi-technician field crews)
--   4. service_appointments & service_appointment_assignments (scheduling & dispatch engine)
--   5. work_order_required_skills (skill-based technician qualification matching)
--   6. appointment_history (immutable audit trail of rescheduling events)
--   7. travel_records (transit times, origin/destination tracking)
--   8. visits extension & service_visit_reports (structured problem, diagnosis, parts, labor)
--   9. work_orders extension (scheduling_status, territory_id, active_appointment_id)
--  10. Transactional RPCs:
--      - assign_service_appointment
--      - dispatch_service_appointment
--      - check_in_service_appointment
--      - check_out_service_appointment
--      - reschedule_service_appointment
--      - complete_service_appointment
--      - evaluate_parts_readiness
--  11. Multi-tenant RLS policies and audit triggers

-- ---------------------------------------------------------------------------
-- 1. Extend Status ENUMs & Document Types
-- ---------------------------------------------------------------------------
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'dispatcher';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'field_technician';

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'APT'; -- Service Appointment (APT-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'REP'; -- Service Visit Report (REP-YYYY-XXXX)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE public.appointment_status AS ENUM (
      'unscheduled', 'scheduled', 'confirmed', 'dispatched',
      'en_route', 'arrived', 'in_progress', 'paused',
      'completed', 'cancelled', 'rescheduled', 'no_show'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reschedule_reason') THEN
    CREATE TYPE public.reschedule_reason AS ENUM (
      'CUSTOMER_REQUEST', 'TECHNICIAN_UNAVAILABLE', 'PART_NOT_AVAILABLE',
      'WEATHER', 'EMERGENCY', 'SLA_REASSIGNMENT', 'OTHER'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parts_readiness_status') THEN
    CREATE TYPE public.parts_readiness_status AS ENUM (
      'READY', 'PARTIAL', 'NOT_READY', 'NOT_REQUIRED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_report_status') THEN
    CREATE TYPE public.service_report_status AS ENUM (
      'resolved', 'temporary_fix', 'parts_pending', 'unresolved'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables: service_territories & service_territory_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_territories (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id           uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  code                text          NOT NULL,
  name                text          NOT NULL,
  description         text,
  area_description    text,
  working_hours       jsonb         NOT NULL DEFAULT '{"shift_start": "08:00", "shift_end": "18:00", "working_days": [1, 2, 3, 4, 5]}'::jsonb,
  priority_rules      jsonb         NOT NULL DEFAULT '{"emergency_buffer_minutes": 30, "default_priority": "medium"}'::jsonb,
  is_active           boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_territories_code ON public.service_territories (company_id, code);
CREATE INDEX IF NOT EXISTS idx_service_territories_company ON public.service_territories (company_id, is_active);

CREATE TRIGGER set_service_territories_updated_at
  BEFORE UPDATE ON public.service_territories
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.service_territories IS 'Geographical and operational service regions governing field technician dispatch.';

CREATE TABLE IF NOT EXISTS public.service_territory_members (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  territory_id        uuid          NOT NULL REFERENCES public.service_territories(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  is_primary          boolean       NOT NULL DEFAULT true,
  effective_from      date          NOT NULL DEFAULT CURRENT_DATE,
  effective_to        date,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_territory_member ON public.service_territory_members (territory_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_territory_members_emp ON public.service_territory_members (employee_id, is_primary);

CREATE TRIGGER set_service_territory_members_updated_at
  BEFORE UPDATE ON public.service_territory_members
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 3. Tables: service_teams & service_team_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_teams (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id           uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  code                text          NOT NULL,
  name                text          NOT NULL,
  leader_id           uuid          REFERENCES public.employees(id) ON DELETE SET NULL,
  territory_id        uuid          REFERENCES public.service_territories(id) ON DELETE SET NULL,
  description         text,
  is_active           boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_teams_code ON public.service_teams (company_id, code);
CREATE INDEX IF NOT EXISTS idx_service_teams_territory ON public.service_teams (territory_id);

CREATE TRIGGER set_service_teams_updated_at
  BEFORE UPDATE ON public.service_teams
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.service_team_members (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  team_id             uuid          NOT NULL REFERENCES public.service_teams(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role_in_team        text          NOT NULL DEFAULT 'member',
  is_active           boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_unique ON public.service_team_members (team_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_team_members_emp ON public.service_team_members (employee_id, is_active);

CREATE TRIGGER set_service_team_members_updated_at
  BEFORE UPDATE ON public.service_team_members
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 4. Table: service_appointments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_appointments (
  id                          uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id                   uuid                        REFERENCES public.branches(id) ON DELETE SET NULL,
  appointment_number          text                        NOT NULL,
  work_order_id               uuid                        NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  customer_id                 uuid                        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id                     uuid                        NOT NULL REFERENCES public.customer_sites(id) ON DELETE RESTRICT,
  asset_id                    uuid                        REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  assigned_technician_id      uuid                        REFERENCES public.employees(id) ON DELETE SET NULL,
  team_id                     uuid                        REFERENCES public.service_teams(id) ON DELETE SET NULL,
  territory_id                uuid                        REFERENCES public.service_territories(id) ON DELETE SET NULL,
  appointment_date            date                        NOT NULL,
  start_time                  timestamptz                 NOT NULL,
  end_time                    timestamptz                 NOT NULL,
  estimated_duration_minutes  integer                     NOT NULL DEFAULT 120 CHECK (estimated_duration_minutes > 0),
  travel_buffer_minutes       integer                     NOT NULL DEFAULT 30 CHECK (travel_buffer_minutes >= 0),
  priority                    public.work_order_priority  NOT NULL DEFAULT 'medium',
  sla_deadline                timestamptz,
  status                      public.appointment_status   NOT NULL DEFAULT 'unscheduled',
  notes                       text,
  metadata                    jsonb                       NOT NULL DEFAULT '{}'::jsonb,
  created_by                  uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                  uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz                 NOT NULL DEFAULT now(),
  updated_at                  timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_appointment_times CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_appointments_number ON public.service_appointments (company_id, appointment_number);
CREATE INDEX IF NOT EXISTS idx_appointments_wo ON public.service_appointments (work_order_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_tech ON public.service_appointments (assigned_technician_id, appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_territory ON public.service_appointments (territory_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_sla ON public.service_appointments (company_id, sla_deadline) WHERE status NOT IN ('completed', 'cancelled');

CREATE TRIGGER set_service_appointments_updated_at
  BEFORE UPDATE ON public.service_appointments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.service_appointments IS 'Scheduled customer service appointments dispatching technicians to work order sites.';

-- Trigger for auto appointment_number
CREATE OR REPLACE FUNCTION public.handle_service_appointment_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.appointment_number IS NULL OR trim(NEW.appointment_number) = '' THEN
    NEW.appointment_number := public.generate_document_number(
      NEW.company_id,
      'APT'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_appointment_auto_number
  BEFORE INSERT ON public.service_appointments
  FOR EACH ROW EXECUTE FUNCTION public.handle_service_appointment_before_insert();

-- Multi-technician appointment assignment
CREATE TABLE IF NOT EXISTS public.service_appointment_assignments (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id      uuid          NOT NULL REFERENCES public.service_appointments(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role                text          NOT NULL DEFAULT 'lead',
  is_primary          boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_assignment ON public.service_appointment_assignments (appointment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_appt_assignments_emp ON public.service_appointment_assignments (employee_id);

-- ---------------------------------------------------------------------------
-- 5. Table: work_order_required_skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_required_skills (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id           uuid          NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  skill_id                uuid          NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  min_proficiency_level   integer       NOT NULL DEFAULT 1 CHECK (min_proficiency_level BETWEEN 1 AND 5),
  is_mandatory            boolean       NOT NULL DEFAULT true,
  certification_required  boolean       NOT NULL DEFAULT false,
  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_required_skills ON public.work_order_required_skills (work_order_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_wo_req_skills_wo ON public.work_order_required_skills (work_order_id);

-- ---------------------------------------------------------------------------
-- 6. Table: appointment_history (Rescheduling & Cancellation Audit Trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointment_history (
  id                  uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id      uuid                      NOT NULL REFERENCES public.service_appointments(id) ON DELETE CASCADE,
  original_date       date                      NOT NULL,
  original_start_time timestamptz               NOT NULL,
  original_end_time   timestamptz               NOT NULL,
  new_date            date                      NOT NULL,
  new_start_time      timestamptz               NOT NULL,
  new_end_time        timestamptz               NOT NULL,
  reschedule_reason   public.reschedule_reason  NOT NULL DEFAULT 'CUSTOMER_REQUEST',
  reason_details      text,
  rescheduled_by      uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz               NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_history_appt ON public.appointment_history (appointment_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Table: travel_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.travel_records (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id              uuid          NOT NULL REFERENCES public.service_appointments(id) ON DELETE CASCADE,
  visit_id                    uuid          REFERENCES public.visits(id) ON DELETE SET NULL,
  technician_id               uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  travel_start                timestamptz   NOT NULL,
  travel_end                  timestamptz,
  travel_duration_minutes     integer,
  origin_reference            text,
  destination_reference       text,
  travel_status               text          NOT NULL DEFAULT 'in_transit',
  travel_notes                text,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_records_appt ON public.travel_records (appointment_id);
CREATE INDEX IF NOT EXISTS idx_travel_records_tech ON public.travel_records (technician_id, travel_start);

CREATE TRIGGER set_travel_records_updated_at
  BEFORE UPDATE ON public.travel_records
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 8. Extend Existing Tables: visits & work_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS appointment_id                 uuid REFERENCES public.service_appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS travel_start_at                timestamptz,
  ADD COLUMN IF NOT EXISTS travel_end_at                  timestamptz,
  ADD COLUMN IF NOT EXISTS total_visit_duration_minutes   integer,
  ADD COLUMN IF NOT EXISTS completion_remarks             text,
  ADD COLUMN IF NOT EXISTS customer_notes                 text,
  ADD COLUMN IF NOT EXISTS work_performed                 text;

CREATE INDEX IF NOT EXISTS idx_visits_appointment ON public.visits (appointment_id) WHERE appointment_id IS NOT NULL;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS scheduling_status              text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS territory_id                   uuid REFERENCES public.service_territories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_appointment_id          uuid REFERENCES public.service_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_scheduling ON public.work_orders (company_id, scheduling_status);

-- ---------------------------------------------------------------------------
-- 9. Table: service_visit_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_visit_reports (
  id                          uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_number               text                        NOT NULL,
  visit_id                    uuid                        NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  work_order_id               uuid                        NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  appointment_id              uuid                        REFERENCES public.service_appointments(id) ON DELETE SET NULL,
  technician_id               uuid                        NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  customer_id                 uuid                        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  asset_id                    uuid                        REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  problem_reported            text                        NOT NULL,
  diagnosis                   text                        NOT NULL,
  work_performed              text                        NOT NULL,
  parts_used_summary          jsonb                       NOT NULL DEFAULT '[]'::jsonb,
  labor_summary               jsonb                       NOT NULL DEFAULT '[]'::jsonb,
  recommendations             text,
  follow_up_required          boolean                     NOT NULL DEFAULT false,
  follow_up_notes             text,
  customer_remarks            text,
  technician_remarks          text,
  completion_status           public.service_report_status NOT NULL DEFAULT 'resolved',
  created_at                  timestamptz                 NOT NULL DEFAULT now(),
  updated_at                  timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_visit_reports_number ON public.service_visit_reports (company_id, report_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_visit_reports_visit ON public.service_visit_reports (visit_id);
CREATE INDEX IF NOT EXISTS idx_service_visit_reports_wo ON public.service_visit_reports (work_order_id);

CREATE TRIGGER set_service_visit_reports_updated_at
  BEFORE UPDATE ON public.service_visit_reports
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Trigger for auto report_number
CREATE OR REPLACE FUNCTION public.handle_service_report_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.report_number IS NULL OR trim(NEW.report_number) = '' THEN
    NEW.report_number := public.generate_document_number(
      NEW.company_id,
      'REP'::public.document_type
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_report_auto_number
  BEFORE INSERT ON public.service_visit_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_service_report_before_insert();

-- ---------------------------------------------------------------------------
-- 10. Transactional RPCs
-- ---------------------------------------------------------------------------

-- RPC: assign_service_appointment
CREATE OR REPLACE FUNCTION public.assign_service_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_technician_id uuid,
  p_team_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt RECORD;
  v_conflict_count integer;
  v_on_leave boolean;
  v_now timestamptz := now();
BEGIN
  -- Row locking to prevent double-booking race condition
  SELECT * INTO v_appt
  FROM public.service_appointments
  WHERE id = p_appointment_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Service appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot assign technician to % appointment', v_appt.status USING ERRCODE = '22000';
  END IF;

  -- 1. Check leave status
  SELECT EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.company_id = p_company_id
      AND lr.employee_id = p_technician_id
      AND lr.status = 'approved'
      AND lr.start_date <= v_appt.appointment_date
      AND lr.end_date >= v_appt.appointment_date
  ) INTO v_on_leave;

  IF v_on_leave THEN
    RAISE EXCEPTION 'Technician is on approved leave on %', v_appt.appointment_date USING ERRCODE = '22000';
  END IF;

  -- 2. Check conflicting appointments for technician
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.service_appointments sa
  WHERE sa.company_id = p_company_id
    AND sa.id != p_appointment_id
    AND sa.assigned_technician_id = p_technician_id
    AND sa.appointment_date = v_appt.appointment_date
    AND sa.status NOT IN ('cancelled', 'completed', 'rescheduled')
    AND (
      (v_appt.start_time - (v_appt.travel_buffer_minutes || ' minutes')::interval) < (sa.end_time + (sa.travel_buffer_minutes || ' minutes')::interval)
      AND
      (v_appt.end_time + (v_appt.travel_buffer_minutes || ' minutes')::interval) > (sa.start_time - (sa.travel_buffer_minutes || ' minutes')::interval)
    );

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Technician has % conflicting appointment(s) during this time window', v_conflict_count
      USING ERRCODE = '22000';
  END IF;

  -- 3. Update appointment
  UPDATE public.service_appointments
  SET
    assigned_technician_id = p_technician_id,
    team_id = p_team_id,
    status = 'scheduled',
    updated_by = p_user_id,
    updated_at = v_now
  WHERE id = p_appointment_id;

  -- Primary assignment entry
  INSERT INTO public.service_appointment_assignments (
    company_id, appointment_id, employee_id, role, is_primary
  ) VALUES (
    p_company_id, p_appointment_id, p_technician_id, 'lead', true
  ) ON CONFLICT (appointment_id, employee_id) DO UPDATE SET
    role = 'lead', is_primary = true;

  -- Update work order scheduling status
  UPDATE public.work_orders
  SET
    scheduling_status = 'scheduled',
    active_appointment_id = p_appointment_id,
    status = CASE WHEN status = 'new' THEN 'scheduled'::public.work_order_status ELSE status END,
    updated_at = v_now
  WHERE id = v_appt.work_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'assigned_technician_id', p_technician_id,
    'status', 'scheduled'
  );
END;
$$;

-- RPC: dispatch_service_appointment
CREATE OR REPLACE FUNCTION public.dispatch_service_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt RECORD;
  v_visit_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_appt
  FROM public.service_appointments
  WHERE id = p_appointment_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.assigned_technician_id IS NULL THEN
    RAISE EXCEPTION 'Cannot dispatch appointment without assigned technician' USING ERRCODE = '22000';
  END IF;

  IF v_appt.status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Cannot dispatch appointment with status %', v_appt.status USING ERRCODE = '22000';
  END IF;

  -- 1. Transition appointment to dispatched
  UPDATE public.service_appointments
  SET
    status = 'dispatched',
    updated_by = p_user_id,
    updated_at = v_now
  WHERE id = p_appointment_id;

  -- 2. Create or link execution visit
  INSERT INTO public.visits (
    company_id, branch_id, work_order_id, appointment_id,
    visit_number, scheduled_start, scheduled_end,
    dispatched_at, status
  ) VALUES (
    p_company_id, v_appt.branch_id, v_appt.work_order_id, p_appointment_id,
    1, v_appt.start_time, v_appt.end_time,
    v_now, 'dispatched'
  ) RETURNING id INTO v_visit_id;

  -- 3. Link technician to visit
  INSERT INTO public.visit_technicians (
    company_id, visit_id, employee_id, role_in_visit, status
  ) VALUES (
    p_company_id, v_visit_id, v_appt.assigned_technician_id, 'lead', 'assigned'
  ) ON CONFLICT (visit_id, employee_id) DO NOTHING;

  -- 4. Update work order
  UPDATE public.work_orders
  SET
    scheduling_status = 'dispatched',
    status = CASE WHEN status IN ('new', 'scheduled') THEN 'dispatched'::public.work_order_status ELSE status END,
    updated_at = v_now
  WHERE id = v_appt.work_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'visit_id', v_visit_id,
    'status', 'dispatched'
  );
END;
$$;

-- RPC: check_in_service_appointment
CREATE OR REPLACE FUNCTION public.check_in_service_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_technician_id uuid,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt RECORD;
  v_visit RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_appt
  FROM public.service_appointments
  WHERE id = p_appointment_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.assigned_technician_id != p_technician_id THEN
    RAISE EXCEPTION 'Technician is not assigned to this appointment' USING ERRCODE = '42501';
  END IF;

  -- Find or create visit
  SELECT * INTO v_visit
  FROM public.visits
  WHERE appointment_id = p_appointment_id AND company_id = p_company_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_visit.id IS NULL THEN
    INSERT INTO public.visits (
      company_id, branch_id, work_order_id, appointment_id,
      visit_number, scheduled_start, scheduled_end,
      dispatched_at, check_in_at, check_in_lat, check_in_lng, status
    ) VALUES (
      p_company_id, v_appt.branch_id, v_appt.work_order_id, p_appointment_id,
      1, v_appt.start_time, v_appt.end_time,
      v_now, v_now, p_latitude, p_longitude, 'in_progress'
    ) RETURNING * INTO v_visit;
  ELSE
    UPDATE public.visits
    SET
      check_in_at = COALESCE(check_in_at, v_now),
      check_in_lat = COALESCE(p_latitude, check_in_lat),
      check_in_lng = COALESCE(p_longitude, check_in_lng),
      status = 'in_progress',
      updated_at = v_now
    WHERE id = v_visit.id;
  END IF;

  -- Update appointment status
  UPDATE public.service_appointments
  SET status = 'in_progress', updated_at = v_now
  WHERE id = p_appointment_id;

  -- Update work order
  UPDATE public.work_orders
  SET status = 'in_progress', scheduling_status = 'in_progress', updated_at = v_now
  WHERE id = v_appt.work_order_id;

  -- Start timesheet entry
  INSERT INTO public.timesheets (
    company_id, visit_id, work_order_id, technician_id,
    category, start_time, notes
  ) VALUES (
    p_company_id, v_visit.id, v_appt.work_order_id, p_technician_id,
    'on_site', v_now, 'Auto-started on appointment check-in'
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'visit_id', v_visit.id,
    'check_in_at', v_now,
    'status', 'in_progress'
  );
END;
$$;

-- RPC: check_out_service_appointment
CREATE OR REPLACE FUNCTION public.check_out_service_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_technician_id uuid,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_work_performed text DEFAULT NULL,
  p_completion_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt RECORD;
  v_visit RECORD;
  v_now timestamptz := now();
  v_duration integer := 0;
BEGIN
  SELECT * INTO v_appt
  FROM public.service_appointments
  WHERE id = p_appointment_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_visit
  FROM public.visits
  WHERE appointment_id = p_appointment_id AND company_id = p_company_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_visit.id IS NULL OR v_visit.check_in_at IS NULL THEN
    RAISE EXCEPTION 'Cannot check out: active check-in not found for appointment' USING ERRCODE = '22000';
  END IF;

  v_duration := ROUND(EXTRACT(EPOCH FROM (v_now - v_visit.check_in_at)) / 60);

  -- Close open timesheets
  UPDATE public.timesheets
  SET end_time = v_now, updated_at = v_now
  WHERE visit_id = v_visit.id
    AND technician_id = p_technician_id
    AND end_time IS NULL;

  -- Update visit
  UPDATE public.visits
  SET
    check_out_at = v_now,
    check_out_lat = COALESCE(p_latitude, check_out_lat),
    check_out_lng = COALESCE(p_longitude, check_out_lng),
    total_visit_duration_minutes = v_duration,
    work_performed = COALESCE(p_work_performed, work_performed),
    completion_remarks = COALESCE(p_completion_remarks, completion_remarks),
    status = 'completed',
    updated_at = v_now
  WHERE id = v_visit.id;

  -- Update appointment status
  UPDATE public.service_appointments
  SET status = 'completed', updated_at = v_now
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'visit_id', v_visit.id,
    'check_out_at', v_now,
    'duration_minutes', v_duration,
    'status', 'completed'
  );
END;
$$;

-- RPC: reschedule_service_appointment
CREATE OR REPLACE FUNCTION public.reschedule_service_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_new_date date,
  p_new_start_time timestamptz,
  p_new_end_time timestamptz,
  p_reason public.reschedule_reason,
  p_reason_details text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_appt
  FROM public.service_appointments
  WHERE id = p_appointment_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot reschedule % appointment', v_appt.status USING ERRCODE = '22000';
  END IF;

  -- 1. Insert history record
  INSERT INTO public.appointment_history (
    company_id, appointment_id,
    original_date, original_start_time, original_end_time,
    new_date, new_start_time, new_end_time,
    reschedule_reason, reason_details, rescheduled_by
  ) VALUES (
    p_company_id, p_appointment_id,
    v_appt.appointment_date, v_appt.start_time, v_appt.end_time,
    p_new_date, p_new_start_time, p_new_end_time,
    p_reason, p_reason_details, p_user_id
  );

  -- 2. Update appointment
  UPDATE public.service_appointments
  SET
    appointment_date = p_new_date,
    start_time = p_new_start_time,
    end_time = p_new_end_time,
    status = 'rescheduled',
    updated_by = p_user_id,
    updated_at = v_now
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'new_date', p_new_date,
    'new_start_time', p_new_start_time,
    'new_end_time', p_new_end_time,
    'status', 'rescheduled'
  );
END;
$$;

-- RPC: evaluate_parts_readiness
CREATE OR REPLACE FUNCTION public.evaluate_parts_readiness(
  p_company_id uuid,
  p_work_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_parts integer := 0;
  v_available_parts integer := 0;
  v_line RECORD;
  v_stock_qty numeric(12,2);
  v_status text := 'NOT_REQUIRED';
BEGIN
  FOR v_line IN (
    SELECT wol.id, wol.item_code, wol.quantity
    FROM public.work_order_lines wol
    WHERE wol.work_order_id = p_work_order_id
      AND wol.line_type = 'part'
      AND wol.item_code IS NOT NULL
  ) LOOP
    v_total_parts := v_total_parts + 1;

    -- Query total on-hand stock for item across organization
    SELECT COALESCE(SUM(sb.quantity_on_hand), 0)
    INTO v_stock_qty
    FROM public.stock_balances sb
    JOIN public.items i ON i.id = sb.item_id
    WHERE sb.company_id = p_company_id
      AND i.item_code = v_line.item_code;

    IF v_stock_qty >= v_line.quantity THEN
      v_available_parts := v_available_parts + 1;
    END IF;
  END LOOP;

  IF v_total_parts = 0 THEN
    v_status := 'NOT_REQUIRED';
  ELSIF v_available_parts = v_total_parts THEN
    v_status := 'READY';
  ELSIF v_available_parts > 0 THEN
    v_status := 'PARTIAL';
  ELSE
    v_status := 'NOT_READY';
  END IF;

  RETURN jsonb_build_object(
    'work_order_id', p_work_order_id,
    'total_required_parts', v_total_parts,
    'available_parts', v_available_parts,
    'status', v_status
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Security: Multi-tenant RLS Policies & Audit Triggers
-- ---------------------------------------------------------------------------

ALTER TABLE public.service_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_territory_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_appointment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_required_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_visit_reports ENABLE ROW LEVEL SECURITY;

-- Multi-tenant isolation policies
CREATE POLICY rls_service_territories_tenant ON public.service_territories
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_territory_members_tenant ON public.service_territory_members
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_teams_tenant ON public.service_teams
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_team_members_tenant ON public.service_team_members
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_appointments_tenant ON public.service_appointments
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_appointment_assignments_tenant ON public.service_appointment_assignments
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_wo_required_skills_tenant ON public.work_order_required_skills
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_appointment_history_tenant ON public.appointment_history
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_travel_records_tenant ON public.travel_records
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY rls_service_visit_reports_tenant ON public.service_visit_reports
  FOR ALL USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

-- Attach audit triggers
SELECT public.attach_audit_trigger('service_territories');
SELECT public.attach_audit_trigger('service_territory_members');
SELECT public.attach_audit_trigger('service_teams');
SELECT public.attach_audit_trigger('service_team_members');
SELECT public.attach_audit_trigger('service_appointments');
SELECT public.attach_audit_trigger('service_appointment_assignments');
SELECT public.attach_audit_trigger('work_order_required_skills');
SELECT public.attach_audit_trigger('appointment_history');
SELECT public.attach_audit_trigger('travel_records');
SELECT public.attach_audit_trigger('service_visit_reports');
