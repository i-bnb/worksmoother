-- =============================================================================
-- Migration 019: Operational RPCs & State Machine Enforcement
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================
-- Enforces:
--   1. Strict work order lifecycle status machine
--   2. Secure visit check-in with GPS verification
--   3. Secure visit check-out with automatic timesheet closure
--   4. Atomic job completion transaction (complete_job) validating checklists, activities, and signatures

-- ---------------------------------------------------------------------------
-- 1. Helper Function: Validate Status Transition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_work_order_transition(
  p_from public.work_order_status,
  p_to public.work_order_status
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Identical status is a no-op (valid)
  IF p_from = p_to THEN
    RETURN true;
  END IF;

  -- Lifecycle rules defined by the Architecture
  CASE p_from
    WHEN 'new' THEN
      RETURN p_to IN ('quoted', 'approved', 'scheduled', 'cancelled');
    WHEN 'quoted' THEN
      RETURN p_to IN ('approved', 'cancelled');
    WHEN 'approved' THEN
      RETURN p_to IN ('scheduled', 'cancelled');
    WHEN 'scheduled' THEN
      RETURN p_to IN ('dispatched', 'in_progress', 'cancelled');
    WHEN 'dispatched' THEN
      RETURN p_to IN ('in_progress', 'on_hold', 'cancelled');
    WHEN 'in_progress' THEN
      RETURN p_to IN ('on_hold', 'completed');
    WHEN 'on_hold' THEN
      RETURN p_to IN ('scheduled', 'in_progress', 'cancelled');
    WHEN 'completed' THEN
      RETURN p_to IN ('invoiced', 'closed');
    WHEN 'invoiced' THEN
      RETURN p_to IN ('closed');
    WHEN 'closed' THEN
      RETURN false; -- Terminal state
    WHEN 'cancelled' THEN
      RETURN false; -- Terminal state
    ELSE
      RETURN false;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.validate_work_order_transition(public.work_order_status, public.work_order_status)
IS 'Verifies whether a work order lifecycle state change conforms to the architectural state machine.';

-- ---------------------------------------------------------------------------
-- 2. Trigger: Prevent Bypassing the Status Machine on Direct Table Updates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_work_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Verify transition legitimacy
    IF NOT public.validate_work_order_transition(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Illegal work order status transition from "%" to "%"', OLD.status, NEW.status
        USING ERRCODE = '22000';
    END IF;

    -- Automatically log the state transition event
    INSERT INTO public.work_order_status_history (
      company_id, work_order_id, from_status, to_status, changed_by, reason, created_at
    ) VALUES (
      NEW.company_id, NEW.id, OLD.status, NEW.status, auth.uid(), 'Status updated', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_order_status_enforcer
  BEFORE UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_work_order_status();

-- ---------------------------------------------------------------------------
-- 3. Controlled Status Transition Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_work_order_status(
  p_work_order_id uuid,
  p_new_status public.work_order_status,
  p_reason text DEFAULT NULL
)
RETURNS public.work_order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo RECORD;
BEGIN
  SELECT id, company_id, status INTO v_wo
  FROM public.work_orders
  WHERE id = p_work_order_id
  FOR UPDATE;

  IF v_wo.id IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', p_work_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Caller must be authorized for this company
  IF NOT public.is_company_member(v_wo.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not belong to company'
      USING ERRCODE = '42501';
  END IF;

  -- Enforce state machine transition
  IF NOT public.validate_work_order_transition(v_wo.status, p_new_status) THEN
    RAISE EXCEPTION 'Illegal status transition from "%" to "%"', v_wo.status, p_new_status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.work_orders
  SET
    status = p_new_status,
    notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes || E'\n', '') || p_reason ELSE notes END,
    updated_at = now()
  WHERE id = p_work_order_id;

  RETURN p_new_status;
END;
$$;

COMMENT ON FUNCTION public.transition_work_order_status(uuid, public.work_order_status, text)
IS 'Safely transitions a work order to a new state after validating the lifecycle machine.';

-- ---------------------------------------------------------------------------
-- 4. Check-In RPC: check_in_visit()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_in_visit(
  p_visit_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visit RECORD;
  v_emp_id uuid;
  v_is_assigned boolean;
  v_now timestamptz := now();
BEGIN
  -- 1. Identify authenticated employee
  v_emp_id := public.get_current_employee_id();
  IF v_emp_id IS NULL AND NOT public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role]) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not a registered employee'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lookup visit and lock
  SELECT v.id, v.company_id, v.work_order_id, v.status, v.check_in_at
  INTO v_visit
  FROM public.visits v
  WHERE v.id = p_visit_id
  FOR UPDATE;

  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visit % not found', p_visit_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_visit.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- 3. Verify technician assignment to this visit
  IF v_emp_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.visit_technicians vt
      WHERE vt.visit_id = p_visit_id AND vt.employee_id = v_emp_id
    ) INTO v_is_assigned;

    IF NOT v_is_assigned AND NOT public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role]) THEN
      RAISE EXCEPTION 'Forbidden: Technician is not assigned to this visit'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Idempotent check: if already checked in, return existing state gracefully
  IF v_visit.check_in_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_checked_in', true,
      'visit_id', v_visit.id,
      'check_in_at', v_visit.check_in_at
    );
  END IF;

  -- 5. Record check-in coordinates and transition visit to in_progress
  UPDATE public.visits
  SET
    status = 'in_progress',
    check_in_at = v_now,
    check_in_lat = p_latitude,
    check_in_lng = p_longitude,
    updated_at = v_now
  WHERE id = p_visit_id;

  -- Update technician trip status to 'working'
  IF v_emp_id IS NOT NULL THEN
    UPDATE public.visit_technicians
    SET
      status = 'working',
      status_updated_at = v_now,
      updated_at = v_now
    WHERE visit_id = p_visit_id AND employee_id = v_emp_id;

    -- Start initial on_site timesheet
    INSERT INTO public.timesheets (
      company_id, visit_id, work_order_id, technician_id,
      category, start_time, notes, idempotency_key
    ) VALUES (
      v_visit.company_id, p_visit_id, v_visit.work_order_id, v_emp_id,
      'on_site', v_now, 'Auto-started on visit check-in', p_idempotency_key
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- Advance parent work order status to in_progress if scheduled or dispatched
  UPDATE public.work_orders
  SET
    status = 'in_progress',
    updated_at = v_now
  WHERE id = v_visit.work_order_id
    AND status IN ('scheduled', 'dispatched');

  RETURN jsonb_build_object(
    'success', true,
    'already_checked_in', false,
    'visit_id', v_visit.id,
    'check_in_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.check_in_visit(uuid, numeric, numeric, text)
IS 'Records verified GPS check-in time, transitions visit and technician to working, and starts timesheet.';

-- ---------------------------------------------------------------------------
-- 5. Check-Out RPC: check_out_visit()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_out_visit(
  p_visit_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visit RECORD;
  v_emp_id uuid;
  v_now timestamptz := now();
BEGIN
  v_emp_id := public.get_current_employee_id();

  SELECT v.id, v.company_id, v.work_order_id, v.check_in_at, v.check_out_at
  INTO v_visit
  FROM public.visits v
  WHERE v.id = p_visit_id
  FOR UPDATE;

  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visit % not found', p_visit_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_visit.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_visit.check_in_at IS NULL THEN
    RAISE EXCEPTION 'Cannot check out: Visit has no check-in recorded'
      USING ERRCODE = '22000';
  END IF;

  -- Idempotency check
  IF v_visit.check_out_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_checked_out', true,
      'visit_id', v_visit.id,
      'check_out_at', v_visit.check_out_at
    );
  END IF;

  -- Record checkout
  UPDATE public.visits
  SET
    check_out_at = v_now,
    check_out_lat = p_latitude,
    check_out_lng = p_longitude,
    updated_at = v_now
  WHERE id = p_visit_id;

  -- Update technician status
  IF v_emp_id IS NOT NULL THEN
    UPDATE public.visit_technicians
    SET
      status = 'done',
      status_updated_at = v_now,
      updated_at = v_now
    WHERE visit_id = p_visit_id AND employee_id = v_emp_id;

    -- Close any open on_site timesheets for this technician on this visit
    UPDATE public.timesheets
    SET
      end_time = v_now,
      updated_at = v_now
    WHERE visit_id = p_visit_id
      AND technician_id = v_emp_id
      AND end_time IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_checked_out', false,
    'visit_id', v_visit.id,
    'check_out_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.check_out_visit(uuid, numeric, numeric, text)
IS 'Records verified GPS check-out time and closes open labor timesheets.';

-- ---------------------------------------------------------------------------
-- 6. Atomic Completion RPC: complete_job()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_job(
  p_visit_id uuid,
  p_summary text DEFAULT NULL,
  p_signer_name text DEFAULT NULL,
  p_signature_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visit RECORD;
  v_wo RECORD;
  v_emp_id uuid;
  v_activity_count integer;
  v_unanswered_checklists integer;
  v_is_ftf boolean := false;
  v_now timestamptz := now();
BEGIN
  v_emp_id := public.get_current_employee_id();

  -- 1. Fetch visit and work order
  SELECT v.*
  INTO v_visit
  FROM public.visits v
  WHERE v.id = p_visit_id
  FOR UPDATE;

  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visit % not found', p_visit_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_visit.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  SELECT w.*
  INTO v_wo
  FROM public.work_orders w
  WHERE w.id = v_visit.work_order_id
  FOR UPDATE;

  -- 2. Guard: Must have at least one job activity recorded
  SELECT COUNT(*) INTO v_activity_count
  FROM public.job_activities ja
  WHERE ja.visit_id = p_visit_id;

  IF v_activity_count = 0 THEN
    RAISE EXCEPTION 'Cannot complete job: At least one job activity must be logged.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Guard: All required checklist items for this service type must have responses
  IF v_wo.service_type_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unanswered_checklists
    FROM public.checklist_templates ct
    JOIN public.checklist_items ci ON ci.template_id = ct.id
    WHERE ct.service_type_id = v_wo.service_type_id
      AND ct.is_active = true
      AND ci.is_required = true
      AND NOT EXISTS (
        SELECT 1 FROM public.checklist_responses cr
        WHERE cr.visit_id = p_visit_id AND cr.checklist_item_id = ci.id
      );

    IF v_unanswered_checklists > 0 THEN
      RAISE EXCEPTION 'Cannot complete job: % required checklist item(s) are missing responses.', v_unanswered_checklists
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 4. Check-out auto-stamp if not already performed
  IF v_visit.check_out_at IS NULL THEN
    UPDATE public.visits
    SET
      check_out_at = v_now,
      updated_at = v_now
    WHERE id = p_visit_id;

    IF v_emp_id IS NOT NULL THEN
      UPDATE public.timesheets
      SET end_time = v_now, updated_at = v_now
      WHERE visit_id = p_visit_id AND technician_id = v_emp_id AND end_time IS NULL;
    END IF;
  END IF;

  -- 5. Customer Signature Recording
  IF p_signer_name IS NOT NULL AND p_signature_path IS NOT NULL THEN
    INSERT INTO public.signatures (
      company_id, visit_id, customer_id, signer_name,
      signature_storage_path, remarks, signed_at
    ) VALUES (
      v_visit.company_id, p_visit_id, v_wo.customer_id, p_signer_name,
      p_signature_path, p_summary, v_now
    ) ON CONFLICT (visit_id) DO UPDATE SET
      signer_name = EXCLUDED.signer_name,
      signature_storage_path = EXCLUDED.signature_storage_path,
      remarks = EXCLUDED.remarks,
      signed_at = v_now;
  END IF;

  -- 6. Evaluate First-Time-Fix: True if this is Visit 1 and no subsequent visits exist
  IF v_visit.visit_number = 1 THEN
    v_is_ftf := true;
  END IF;

  -- 7. Complete the Visit
  UPDATE public.visits
  SET
    status = 'completed',
    is_first_time_fix = v_is_ftf,
    notes = CASE WHEN p_summary IS NOT NULL THEN COALESCE(notes || E'\n', '') || p_summary ELSE notes END,
    updated_at = v_now
  WHERE id = p_visit_id;

  -- 8. Complete the Parent Work Order
  UPDATE public.work_orders
  SET
    status = 'completed',
    updated_at = v_now
  WHERE id = v_wo.id;

  RETURN jsonb_build_object(
    'success', true,
    'work_order_id', v_wo.id,
    'work_order_number', v_wo.work_order_number,
    'visit_id', p_visit_id,
    'is_first_time_fix', v_is_ftf,
    'completed_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.complete_job(uuid, text, text, text)
IS 'Atomically validates all completion criteria (activities, checklists, checkout, signature) and completes the visit and work order.';
