-- =============================================================================
-- Migration 022: Supabase Realtime Broadcast & Event Notifications
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================
-- Configures selective Realtime change data capture (CDC) and broadcast channels for:
--   - work_orders (status changes, re-assignments, SLA updates)
--   - visits (dispatch events, check-ins, check-outs)
--   - visit_technicians (live en route / working presence updates)
-- Avoids uncontrolled global realtime listening; scopes broadcasts efficiently.

-- ---------------------------------------------------------------------------
-- 1. Add Core Operational Tables to supabase_realtime Publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Add selected tables to publication if not already present
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_orders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.work_orders;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'visits'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.visits;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'visit_technicians'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.visit_technicians;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Dispatch Broadcast Notification Trigger Function
-- ---------------------------------------------------------------------------
-- Sends a lightweight JSON payload on channel 'dispatch_events' via pg_notify
-- for server-sent events or Edge Function websocket bridges.
CREATE OR REPLACE FUNCTION public.broadcast_dispatch_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload jsonb;
  v_channel text := 'dispatch_events';
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    -- Only notify if status or schedule actually changed
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start THEN
      RETURN NEW;
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'action', TG_OP,
    'record_id', NEW.id,
    'company_id', NEW.company_id,
    'status', NEW.status,
    'timestamp', now()
  );

  PERFORM pg_notify(v_channel, v_payload::text);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.broadcast_dispatch_event() IS 'Emits targeted JSON event via pg_notify for live dispatch board synchronization.';

-- Attach triggers to work_orders and visits
CREATE OR REPLACE TRIGGER trg_broadcast_work_orders
  AFTER INSERT OR UPDATE OF status, scheduled_start ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_dispatch_event();

CREATE OR REPLACE TRIGGER trg_broadcast_visits
  AFTER INSERT OR UPDATE OF status, check_in_at, check_out_at ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_dispatch_event();
