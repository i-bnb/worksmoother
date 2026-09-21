-- =============================================================================
-- Migration 060: Customer Portal, Self-Service, Service History & Customer Access
-- Maintenance Management ERP — Phase 9 Foundation
-- =============================================================================
-- Features:
--   1. Customer Portal Identity & Roles (customer_portal_users)
--   2. Appointment Rescheduling & Change Requests (appointment_change_requests)
--   3. Customer Online Payment Initiation & Intents (payment_intents)
--   4. Customer Post-Service Feedback & Ratings (service_feedback)
--   5. Enhancements to quotations for customer approval signoffs
--   6. Helper functions: get_portal_user_customer_id, has_portal_role, get_portal_user_role
--   7. Atomic RPCs: approve_portal_quotation, reject_portal_quotation
--   8. Strict multi-tenant & customer-isolated RLS policies
--   9. Automated audit logging triggers

-- ---------------------------------------------------------------------------
-- 1. Table: customer_portal_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_portal_users (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id             uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_id              uuid          REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  user_id                 uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portal_role             text          NOT NULL DEFAULT 'CUSTOMER_VIEWER'
                                        CHECK (portal_role IN ('CUSTOMER_ADMIN', 'CUSTOMER_SERVICE', 'CUSTOMER_ACCOUNTS', 'CUSTOMER_VIEWER')),
  is_active               boolean       NOT NULL DEFAULT true,
  invitation_token        text,
  invitation_accepted_at  timestamptz,
  last_login_at           timestamptz,
  created_by              uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_portal_users_company_user UNIQUE (company_id, user_id),
  CONSTRAINT uq_portal_users_customer_user UNIQUE (customer_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_users_customer ON public.customer_portal_users (customer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_portal_users_user     ON public.customer_portal_users (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_portal_users_role     ON public.customer_portal_users (portal_role);

CREATE TRIGGER set_customer_portal_users_updated_at
  BEFORE UPDATE ON public.customer_portal_users
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.customer_portal_users IS 'Customer portal authorized identities, contacts, and role-based permissions.';

-- ---------------------------------------------------------------------------
-- 2. Table: appointment_change_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointment_change_requests (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id           uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id        uuid          NOT NULL REFERENCES public.service_appointments(id) ON DELETE CASCADE,
  work_order_id         uuid          REFERENCES public.work_orders(id) ON DELETE SET NULL,
  requested_date        timestamptz   NOT NULL,
  preferred_time_slot   text          DEFAULT 'anytime'
                                      CHECK (preferred_time_slot IN ('morning', 'afternoon', 'evening', 'anytime')),
  reason                text          NOT NULL,
  status                text          NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by           uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  resolution_notes      text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_cust ON public.appointment_change_requests (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_change_requests_appt ON public.appointment_change_requests (appointment_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_stat ON public.appointment_change_requests (company_id, status);

CREATE TRIGGER set_appointment_change_requests_updated_at
  BEFORE UPDATE ON public.appointment_change_requests
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.appointment_change_requests IS 'Customer-initiated rescheduling and change requests for service appointments.';

-- ---------------------------------------------------------------------------
-- 3. Table: payment_intents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id             uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  invoice_id              uuid          NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount                  numeric(14,3) NOT NULL CHECK (amount > 0),
  currency                text          NOT NULL DEFAULT 'AED',
  provider                text          NOT NULL DEFAULT 'mock'
                                        CHECK (provider IN ('stripe', 'razorpay', 'mock', 'bank_transfer')),
  provider_intent_id      text,
  provider_client_secret  text,
  status                  text          NOT NULL DEFAULT 'created'
                                        CHECK (status IN ('created', 'processing', 'succeeded', 'failed', 'cancelled')),
  payment_method          text          DEFAULT 'card',
  metadata                jsonb         NOT NULL DEFAULT '{}'::jsonb,
  expires_at              timestamptz,
  created_by              uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_cust    ON public.payment_intents (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice ON public.payment_intents (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_ext     ON public.payment_intents (company_id, provider_intent_id);

CREATE TRIGGER set_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.payment_intents IS 'Customer online payment checkout sessions and payment intents for invoices.';

-- ---------------------------------------------------------------------------
-- 4. Table: service_feedback
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_feedback (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id         uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  work_order_id       uuid          NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  service_report_id   uuid          REFERENCES public.service_visit_reports(id) ON DELETE SET NULL,
  rating              integer       NOT NULL CHECK (rating BETWEEN 1 AND 5),
  timeliness_rating   integer       CHECK (timeliness_rating BETWEEN 1 AND 5),
  technician_rating   integer       CHECK (technician_rating BETWEEN 1 AND 5),
  quality_rating      integer       CHECK (quality_rating BETWEEN 1 AND 5),
  comments            text,
  customer_contact_id uuid          REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  submitted_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  is_published        boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_service_feedback_wo_customer UNIQUE (work_order_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_service_feedback_cust   ON public.service_feedback (customer_id);
CREATE INDEX IF NOT EXISTS idx_service_feedback_rating ON public.service_feedback (company_id, rating);
CREATE INDEX IF NOT EXISTS idx_service_feedback_wo     ON public.service_feedback (work_order_id);

CREATE TRIGGER set_service_feedback_updated_at
  BEFORE UPDATE ON public.service_feedback
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.service_feedback IS 'Post-service customer feedback, satisfaction scores, and technician ratings.';

-- ---------------------------------------------------------------------------
-- 5. Extend quotations table for Customer Signatory & Approval Notes
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS customer_signatory_name text,
  ADD COLUMN IF NOT EXISTS customer_approval_notes text;

-- ---------------------------------------------------------------------------
-- 6. Helper Security Functions for Customer Portal
-- ---------------------------------------------------------------------------

-- Enhanced get_current_customer_id supporting customer_portal_users
CREATE OR REPLACE FUNCTION public.get_current_customer_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_customer_id uuid;
  v_jwt_cust text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. Check JWT claim first
  v_jwt_cust := public.get_jwt_claim('customer_id');
  IF v_jwt_cust IS NOT NULL AND v_jwt_cust ~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN v_jwt_cust::uuid;
  END IF;

  -- 2. Check customer_portal_users table (verifying active user & active customer)
  SELECT cpu.customer_id INTO v_customer_id
  FROM public.customer_portal_users cpu
  JOIN public.customers c ON c.id = cpu.customer_id
  WHERE cpu.user_id = v_uid
    AND cpu.is_active = true
    AND c.is_active = true
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    RETURN v_customer_id;
  END IF;

  -- 3. Fallback to profiles table
  SELECT p.customer_id INTO v_customer_id
  FROM public.profiles p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE p.id = v_uid
    AND p.is_active = true
    AND c.is_active = true
  LIMIT 1;

  RETURN v_customer_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_customer_id() IS 'Resolves customer_id for the authenticated customer portal user or legacy profile.';

-- Stored function to resolve customer_id directly from user_id
CREATE OR REPLACE FUNCTION public.get_portal_user_customer_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cpu.customer_id INTO v_customer_id
  FROM public.customer_portal_users cpu
  JOIN public.customers c ON c.id = cpu.customer_id
  WHERE cpu.user_id = p_user_id
    AND cpu.is_active = true
    AND c.is_active = true
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    RETURN v_customer_id;
  END IF;

  -- Fallback to profiles
  SELECT p.customer_id INTO v_customer_id
  FROM public.profiles p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE p.id = p_user_id
    AND p.is_active = true
    AND c.is_active = true
  LIMIT 1;

  RETURN v_customer_id;
END;
$$;

COMMENT ON FUNCTION public.get_portal_user_customer_id(uuid) IS 'Resolves active customer_id for a given portal user ID.';

-- Stored function to check portal role
CREATE OR REPLACE FUNCTION public.has_portal_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portal_role text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT cpu.portal_role INTO v_portal_role
  FROM public.customer_portal_users cpu
  JOIN public.customers c ON c.id = cpu.customer_id
  WHERE cpu.user_id = p_user_id
    AND cpu.is_active = true
    AND c.is_active = true
  LIMIT 1;

  IF v_portal_role IS NULL THEN
    RETURN false;
  END IF;

  -- CUSTOMER_ADMIN has all customer privileges
  IF v_portal_role = 'CUSTOMER_ADMIN' THEN
    RETURN true;
  END IF;

  RETURN v_portal_role = p_role;
END;
$$;

COMMENT ON FUNCTION public.has_portal_role(uuid, text) IS 'Checks if portal user has a specific portal role or CUSTOMER_ADMIN privileges.';

-- Stored function to fetch current portal role
CREATE OR REPLACE FUNCTION public.get_portal_user_role(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cpu.portal_role INTO v_role
  FROM public.customer_portal_users cpu
  JOIN public.customers c ON c.id = cpu.customer_id
  WHERE cpu.user_id = p_user_id
    AND cpu.is_active = true
    AND c.is_active = true
  LIMIT 1;

  RETURN v_role;
END;
$$;

COMMENT ON FUNCTION public.get_portal_user_role(uuid) IS 'Returns the active portal role for a customer user.';

-- ---------------------------------------------------------------------------
-- 7. Atomic Transactional RPCs for Customer Quotation Lifecycle
-- ---------------------------------------------------------------------------

-- Approve Quotation
CREATE OR REPLACE FUNCTION public.approve_portal_quotation(
  p_company_id uuid,
  p_customer_id uuid,
  p_quote_id uuid,
  p_user_id uuid,
  p_signatory_name text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote RECORD;
  v_now timestamptz := now();
BEGIN
  -- Verify quotation exists and belongs to company & customer
  SELECT * INTO v_quote
  FROM public.quotations
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found or does not belong to your account'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_quote.status NOT IN ('sent', 'approved') THEN
    RAISE EXCEPTION 'Quotation cannot be approved in its current status: %', v_quote.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_quote.valid_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'Quotation has expired on %', v_quote.valid_until
      USING ERRCODE = 'P0001';
  END IF;

  -- Update quotation status to accepted
  UPDATE public.quotations
  SET status = 'accepted'::public.quotation_status,
      accepted_at = v_now,
      customer_signatory_name = p_signatory_name,
      customer_approval_notes = p_notes,
      updated_at = v_now
  WHERE id = p_quote_id;

  -- Record audit log if procedure exists
  BEGIN
    PERFORM public.record_audit_log(
      p_company_id,
      p_user_id,
      'APPROVE_PORTAL_QUOTATION',
      'quotations',
      p_quote_id,
      jsonb_build_object('status', v_quote.status),
      jsonb_build_object('status', 'accepted', 'signatory_name', p_signatory_name)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit logging failure should not break transaction if table does not support direct call
    NULL;
  END;

  -- Publish domain event if domain_events table exists
  BEGIN
    INSERT INTO public.domain_events (
      company_id,
      event_type,
      entity_type,
      entity_id,
      actor_id,
      payload
    ) VALUES (
      p_company_id,
      'PORTAL_QUOTATION_APPROVED',
      'quotation',
      p_quote_id,
      p_user_id,
      jsonb_build_object(
        'quotation_number', v_quote.quotation_number,
        'customer_id', p_customer_id,
        'signatory_name', p_signatory_name,
        'accepted_at', v_now
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'quotation_id', p_quote_id,
    'quotation_number', v_quote.quotation_number,
    'status', 'accepted',
    'accepted_at', v_now,
    'signatory_name', p_signatory_name
  );
END;
$$;

COMMENT ON FUNCTION public.approve_portal_quotation IS 'Customer self-service atomic approval for sent quotations.';

-- Reject Quotation
CREATE OR REPLACE FUNCTION public.reject_portal_quotation(
  p_company_id uuid,
  p_customer_id uuid,
  p_quote_id uuid,
  p_user_id uuid,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote RECORD;
  v_now timestamptz := now();
BEGIN
  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'A valid rejection reason must be provided'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotations
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found or does not belong to your account'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_quote.status NOT IN ('sent', 'approved') THEN
    RAISE EXCEPTION 'Quotation cannot be rejected in its current status: %', v_quote.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.quotations
  SET status = 'rejected'::public.quotation_status,
      rejected_at = v_now,
      rejection_reason = p_rejection_reason,
      updated_at = v_now
  WHERE id = p_quote_id;

  -- Domain event
  BEGIN
    INSERT INTO public.domain_events (
      company_id,
      event_type,
      entity_type,
      entity_id,
      actor_id,
      payload
    ) VALUES (
      p_company_id,
      'PORTAL_QUOTATION_REJECTED',
      'quotation',
      p_quote_id,
      p_user_id,
      jsonb_build_object(
        'quotation_number', v_quote.quotation_number,
        'customer_id', p_customer_id,
        'rejection_reason', p_rejection_reason,
        'rejected_at', v_now
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'quotation_id', p_quote_id,
    'quotation_number', v_quote.quotation_number,
    'status', 'rejected',
    'rejected_at', v_now,
    'rejection_reason', p_rejection_reason
  );
END;
$$;

COMMENT ON FUNCTION public.reject_portal_quotation IS 'Customer self-service atomic rejection for sent quotations.';

-- ---------------------------------------------------------------------------
-- 8. Row-Level Security (RLS) Policies
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_feedback ENABLE ROW LEVEL SECURITY;

-- customer_portal_users policies
CREATE POLICY portal_users_admin_manage ON public.customer_portal_users
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

CREATE POLICY portal_users_customer_view ON public.customer_portal_users
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_current_customer_id()
  );

CREATE POLICY portal_users_customer_admin_manage ON public.customer_portal_users
  FOR ALL
  TO authenticated
  USING (
    customer_id = public.get_current_customer_id()
    AND public.has_portal_role(auth.uid(), 'CUSTOMER_ADMIN')
  )
  WITH CHECK (
    customer_id = public.get_current_customer_id()
    AND public.has_portal_role(auth.uid(), 'CUSTOMER_ADMIN')
  );

-- appointment_change_requests policies
CREATE POLICY change_requests_staff_manage ON public.appointment_change_requests
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY change_requests_customer_select ON public.appointment_change_requests
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_current_customer_id()
  );

CREATE POLICY change_requests_customer_insert ON public.appointment_change_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_current_customer_id()
    AND (
      public.has_portal_role(auth.uid(), 'CUSTOMER_ADMIN')
      OR public.has_portal_role(auth.uid(), 'CUSTOMER_SERVICE')
      OR public.has_role('customer'::public.user_role)
    )
  );

-- payment_intents policies
CREATE POLICY payment_intents_staff_all ON public.payment_intents
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY payment_intents_customer_select ON public.payment_intents
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_current_customer_id()
  );

CREATE POLICY payment_intents_customer_insert ON public.payment_intents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_current_customer_id()
    AND (
      public.has_portal_role(auth.uid(), 'CUSTOMER_ADMIN')
      OR public.has_portal_role(auth.uid(), 'CUSTOMER_ACCOUNTS')
      OR public.has_role('customer'::public.user_role)
    )
  );

-- service_feedback policies
CREATE POLICY service_feedback_staff_all ON public.service_feedback
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY service_feedback_customer_select ON public.service_feedback
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_current_customer_id()
  );

CREATE POLICY service_feedback_customer_insert ON public.service_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_current_customer_id()
  );

-- ---------------------------------------------------------------------------
-- 9. Attach Audit Triggers
-- ---------------------------------------------------------------------------
SELECT public.attach_audit_trigger('customer_portal_users');
SELECT public.attach_audit_trigger('appointment_change_requests');
SELECT public.attach_audit_trigger('payment_intents');
SELECT public.attach_audit_trigger('service_feedback');
