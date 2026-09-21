-- =============================================================================
-- Migration 012: Asynchronous Work Queues Foundation
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Decouples long-running, external, or non-critical tasks from transactional database operations.
-- Architectural Mandate: Never make the main transaction wait for non-critical external services.
-- Supported Asynchronous Workloads:
--   - notifications       (In-app, push delivery dispatch)
--   - ai_processing       (Gemini diagnostics, asset OCR, preventative maintenance predictions)
--   - pdf_generation      (Customer invoices, work order summary sheets, compliance certificates)
--   - whatsapp_messages   (Meta Cloud API dispatch & media upload)
--   - email_delivery      (Transactional SMTP / Resend dispatch)
--   - amc_scheduler       (Nightly recurring PM job generation)
--   - retry_handler       (Exponential backoff handler for failed webhooks/jobs)

-- ---------------------------------------------------------------------------
-- 1. Table: queue_jobs
-- ---------------------------------------------------------------------------
-- Universal, transactional queue table providing FIFO/scheduled execution with retry semantics.
CREATE TABLE public.queue_jobs (
  id              uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                    REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_name      text                    NOT NULL,
  payload         jsonb                   NOT NULL,
  status          public.queue_job_status NOT NULL DEFAULT 'pending',
  attempts        integer                 NOT NULL DEFAULT 0,
  max_attempts    integer                 NOT NULL DEFAULT 5,
  backoff_seconds integer                 NOT NULL DEFAULT 30,
  scheduled_at    timestamptz             NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  failed_at       timestamptz,
  error_message   text,
  error_stack     text,
  created_at      timestamptz             NOT NULL DEFAULT now(),
  updated_at      timestamptz             NOT NULL DEFAULT now()
);

-- Indices for queue polling and worker consumption
CREATE INDEX idx_queue_jobs_poll
  ON public.queue_jobs (queue_name, status, scheduled_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX idx_queue_jobs_company
  ON public.queue_jobs (company_id, queue_name, status);

CREATE TRIGGER set_queue_jobs_updated_at
  BEFORE UPDATE ON public.queue_jobs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.queue_jobs IS 'Asynchronous background job queue for decoupled operations (notifications, AI, PDF, WhatsApp, AMC jobs).';

-- ---------------------------------------------------------------------------
-- 2. Transactional Enqueue Helper Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_queue_name text,
  p_payload jsonb,
  p_scheduled_at timestamptz DEFAULT now(),
  p_company_id uuid DEFAULT NULL,
  p_max_attempts integer DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
  v_company_id uuid;
BEGIN
  -- Resolve company_id from parameter or active session
  v_company_id := COALESCE(p_company_id, public.get_current_company_id());

  INSERT INTO public.queue_jobs (
    company_id,
    queue_name,
    payload,
    status,
    scheduled_at,
    max_attempts,
    created_at,
    updated_at
  ) VALUES (
    v_company_id,
    p_queue_name,
    p_payload,
    'pending'::public.queue_job_status,
    p_scheduled_at,
    p_max_attempts,
    now(),
    now()
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_job(text, jsonb, timestamptz, uuid, integer) IS 'Atomically enqueues a background job from any transactional procedure or trigger.';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security on queue_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_jobs FORCE ROW LEVEL SECURITY;

-- Select: Only owner_admin and operations_manager can inspect queue jobs for their company
CREATE POLICY queue_jobs_select ON public.queue_jobs
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Enqueue: Any authenticated company user can enqueue through enqueue_job function (which is SECURITY DEFINER)
-- Direct manual INSERT by clients is scoped to the user company:
CREATE POLICY queue_jobs_insert ON public.queue_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
  );
