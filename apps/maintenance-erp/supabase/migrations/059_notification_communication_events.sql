-- =============================================================================
-- Migration 059: Notifications, Communication, Reminders & Event-Driven Messaging
-- Maintenance Management ERP — Phase 8 Foundation
-- =============================================================================
-- Extends notifications architecture with:
--   1. Transactional Domain Event Outbox (domain_events)
--   2. User Notification Preferences (notification_preferences)
--   3. Tenant Communication Settings & Provider Config (communication_settings)
--   4. Configurable Event-Driven Notification Rules (notification_rules)
--   5. Reusable Reminder Rules & Tracking Schedules (reminder_rules, reminder_schedules)
--   6. Extended notifications & message_templates metadata
--   7. Stored procedures for atomic event publishing, bulk read, unread count, and outbox polling

-- ---------------------------------------------------------------------------
-- 1. Enum Extensions
-- ---------------------------------------------------------------------------
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'read';
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ---------------------------------------------------------------------------
-- 2. Table: domain_events (Transactional Outbox)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.domain_events (
  id              uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type      text                    NOT NULL,
  entity_type     text                    NOT NULL,
  entity_id       uuid                    NOT NULL,
  actor_id        uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  payload         jsonb                   NOT NULL DEFAULT '{}'::jsonb,
  status          text                    NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'processed', 'failed'
  retry_count     integer                 NOT NULL DEFAULT 0,
  max_retries     integer                 NOT NULL DEFAULT 5,
  error_message   text,
  processed_at    timestamptz,
  created_at      timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_poll
  ON public.domain_events (company_id, status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_domain_events_entity
  ON public.domain_events (company_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_domain_events_type
  ON public.domain_events (company_id, event_type);

COMMENT ON TABLE public.domain_events IS 'Central domain event outbox for transactional decoupling of ERP business operations from external communications.';

-- ---------------------------------------------------------------------------
-- 3. Extend public.notifications
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_type text DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency
  ON public.notifications (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Table: notification_preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id              uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id         uuid                        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type      text                        NOT NULL,
  channel         public.notification_channel NOT NULL,
  is_enabled      boolean                     NOT NULL DEFAULT true,
  created_at      timestamptz                 NOT NULL DEFAULT now(),
  updated_at      timestamptz                 NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_notification_pref UNIQUE (company_id, user_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notif_pref_lookup
  ON public.notification_preferences (company_id, user_id, event_type);

CREATE TRIGGER set_notif_pref_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.notification_preferences IS 'Per-user notification channel preferences by event type.';

-- ---------------------------------------------------------------------------
-- 5. Table: communication_settings (Tenant-Level Settings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_settings (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  in_app_enabled          boolean       NOT NULL DEFAULT true,
  email_enabled           boolean       NOT NULL DEFAULT true,
  sms_enabled             boolean       NOT NULL DEFAULT false,
  whatsapp_enabled        boolean       NOT NULL DEFAULT false,
  email_provider          text          NOT NULL DEFAULT 'mock',
  sms_provider            text          NOT NULL DEFAULT 'mock',
  whatsapp_provider       text          NOT NULL DEFAULT 'mock',
  email_from_address      text,
  email_from_name         text,
  sms_sender_id           text,
  whatsapp_phone_number_id text,
  provider_config         jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE TRIGGER set_comm_settings_updated_at
  BEFORE UPDATE ON public.communication_settings
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.communication_settings IS 'Company-level multi-channel communication toggles and secure provider configuration.';

-- ---------------------------------------------------------------------------
-- 6. Extend public.message_templates
-- ---------------------------------------------------------------------------
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_msg_templates_event
  ON public.message_templates (company_id, event_type, is_active);

-- ---------------------------------------------------------------------------
-- 7. Table: notification_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id              uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text                        NOT NULL,
  description     text,
  event_type      text                        NOT NULL,
  recipient_type  text                        NOT NULL, -- 'technician', 'customer', 'account_manager', 'service_manager', 'user', 'role'
  recipient_role  text,                       -- e.g. 'operations_manager', 'supervisor'
  channel         public.notification_channel NOT NULL,
  template_id     uuid                        REFERENCES public.message_templates(id) ON DELETE SET NULL,
  conditions      jsonb                       NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean                     NOT NULL DEFAULT true,
  priority        integer                     NOT NULL DEFAULT 10,
  created_at      timestamptz                 NOT NULL DEFAULT now(),
  updated_at      timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_rules_lookup
  ON public.notification_rules (company_id, event_type, is_active, priority);

CREATE TRIGGER set_notif_rules_updated_at
  BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.notification_rules IS 'Declarative rules mapping domain events to notification templates and target recipient roles.';

-- ---------------------------------------------------------------------------
-- 8. Table: reminder_rules & reminder_schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_rules (
  id              uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text                        NOT NULL,
  entity_type     text                        NOT NULL, -- 'service_appointment', 'amc_contract', 'invoice', 'rental_contract'
  offset_minutes  integer                     NOT NULL, -- e.g. -1440 (24h before), -120 (2h before)
  channel         public.notification_channel NOT NULL,
  template_id     uuid                        REFERENCES public.message_templates(id) ON DELETE SET NULL,
  is_active       boolean                     NOT NULL DEFAULT true,
  created_at      timestamptz                 NOT NULL DEFAULT now(),
  updated_at      timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_rules_lookup
  ON public.reminder_rules (company_id, entity_type, is_active);

CREATE TRIGGER set_reminder_rules_updated_at
  BEFORE UPDATE ON public.reminder_rules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.reminder_schedules (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reminder_rule_id  uuid          NOT NULL REFERENCES public.reminder_rules(id) ON DELETE CASCADE,
  entity_type       text          NOT NULL,
  entity_id         uuid          NOT NULL,
  scheduled_for     timestamptz   NOT NULL,
  status            text          NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'sent', 'cancelled'
  sent_at           timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_reminder_schedule UNIQUE (reminder_rule_id, entity_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_reminder_schedules_poll
  ON public.reminder_schedules (company_id, status, scheduled_for)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- 9. Stored Procedures & RPCs
-- ---------------------------------------------------------------------------

-- Atomic domain event publication
CREATE OR REPLACE FUNCTION public.publish_domain_event(
  p_company_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.domain_events (
    company_id,
    event_type,
    entity_type,
    entity_id,
    actor_id,
    payload,
    status,
    created_at
  ) VALUES (
    p_company_id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    COALESCE(p_actor_id, auth.uid()),
    p_payload,
    'pending',
    now()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.publish_domain_event IS 'Transactionally writes a domain event to the outbox table.';

-- Mark all notifications as read for current user
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_company_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user uuid;
  v_updated_count integer;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());

  UPDATE public.notifications
  SET
    read_at = now(),
    status = 'read'::public.notification_status,
    updated_at = now()
  WHERE company_id = p_company_id
    AND user_id = v_target_user
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.mark_all_notifications_read IS 'Marks all unread in-app notifications as read for the authenticated recipient.';

-- High performance unread count query
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count(
  p_company_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user uuid;
  v_count integer;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());

  SELECT COUNT(*)::integer INTO v_count
  FROM public.notifications
  WHERE company_id = p_company_id
    AND user_id = v_target_user
    AND channel = 'in_app'
    AND read_at IS NULL
    AND status NOT IN ('cancelled', 'failed');

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.get_unread_notifications_count IS 'Returns unread in-app notification count for badge rendering.';

-- Atomic outbox batch claim
CREATE OR REPLACE FUNCTION public.process_outbox_batch(
  p_company_id uuid,
  p_batch_size integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  event_type text,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.domain_events de
  SET
    status = 'processing'
  WHERE de.id IN (
    SELECT sub.id
    FROM public.domain_events sub
    WHERE sub.company_id = p_company_id
      AND sub.status = 'pending'
    ORDER BY sub.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    de.id,
    de.company_id,
    de.event_type,
    de.entity_type,
    de.entity_id,
    de.payload,
    de.retry_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Attach Audit Triggers
-- ---------------------------------------------------------------------------
SELECT public.attach_audit_trigger('domain_events');
SELECT public.attach_audit_trigger('notification_preferences');
SELECT public.attach_audit_trigger('communication_settings');
SELECT public.attach_audit_trigger('notification_rules');
SELECT public.attach_audit_trigger('reminder_rules');

-- ---------------------------------------------------------------------------
-- 11. Row Level Security Policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.communication_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_schedules FORCE ROW LEVEL SECURITY;

-- Domain Events: Managers can view
CREATE POLICY domain_events_select ON public.domain_events
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Notification Preferences: Users can manage their own; admin can manage all in company
CREATE POLICY notif_pref_select ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (user_id = auth.uid() OR public.has_role('owner_admin'::public.user_role))
  );

CREATE POLICY notif_pref_insert ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (user_id = auth.uid() OR public.has_role('owner_admin'::public.user_role))
  );

CREATE POLICY notif_pref_update ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (user_id = auth.uid() OR public.has_role('owner_admin'::public.user_role))
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND (user_id = auth.uid() OR public.has_role('owner_admin'::public.user_role))
  );

-- Communication Settings: Only owner_admin can view and manage
CREATE POLICY comm_settings_select ON public.communication_settings
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

CREATE POLICY comm_settings_manage ON public.communication_settings
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  );

-- Notification Rules: View for authenticated company users, manage for management
CREATE POLICY notif_rules_select ON public.notification_rules
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

CREATE POLICY notif_rules_manage ON public.notification_rules
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

-- Reminder Rules: View for authenticated company users, manage for management
CREATE POLICY reminder_rules_select ON public.reminder_rules
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

CREATE POLICY reminder_rules_manage ON public.reminder_rules
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

-- Reminder Schedules: Management access
CREATE POLICY reminder_schedules_select ON public.reminder_schedules
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );
