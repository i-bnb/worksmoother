-- =============================================================================
-- Migration 010: Notification & Messaging Foundation
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Multi-channel notification architecture supporting:
--   Channels: in_app, push, whatsapp, email, sms
--   Statuses: pending, queued, sent, delivered, failed, retrying
-- Tables:
--   1. message_templates - Reusable parameterized templates per company
--   2. notifications     - Notification records (both internal and external)
--   3. message_log       - Detailed outbound delivery audit and vendor responses

-- ---------------------------------------------------------------------------
-- 1. Table: message_templates
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_templates (
  id            uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text                        NOT NULL,
  channel       public.notification_channel NOT NULL,
  subject       text,
  body          text                        NOT NULL,
  variables     jsonb                       NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean                     NOT NULL DEFAULT true,
  created_at    timestamptz                 NOT NULL DEFAULT now(),
  updated_at    timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_message_templates_scope
  ON public.message_templates (company_id, name, channel);

CREATE TRIGGER set_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.message_templates IS 'Parameterized messaging templates for transactional alerts and customer notifications.';

-- ---------------------------------------------------------------------------
-- 2. Table: notifications
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id             uuid                        REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_contact   text,
  channel             public.notification_channel NOT NULL,
  title               text                        NOT NULL,
  body                text                        NOT NULL,
  status              public.notification_status  NOT NULL DEFAULT 'pending',
  metadata            jsonb                       NOT NULL DEFAULT '{}'::jsonb,
  reference_table     text,
  reference_id        uuid,
  scheduled_at        timestamptz                 NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  read_at             timestamptz,
  retry_count         integer                     NOT NULL DEFAULT 0,
  max_retries         integer                     NOT NULL DEFAULT 3,
  error_message       text,
  created_at          timestamptz                 NOT NULL DEFAULT now(),
  updated_at          timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON public.notifications (user_id, status, scheduled_at);
CREATE INDEX idx_notifications_company   ON public.notifications (company_id, channel, status);
CREATE INDEX idx_notifications_reference ON public.notifications (reference_table, reference_id);

CREATE TRIGGER set_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.notifications IS 'Core notification queue records for in-app feeds, push alerts, WhatsApp, and email.';

-- ---------------------------------------------------------------------------
-- 3. Table: message_log
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_log (
  id                    uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  notification_id       uuid                        REFERENCES public.notifications(id) ON DELETE SET NULL,
  channel               public.notification_channel NOT NULL,
  recipient             text                        NOT NULL,
  payload               jsonb                       NOT NULL,
  status                public.notification_status  NOT NULL,
  provider              text,
  provider_message_id   text,
  provider_response     jsonb,
  delivered_at          timestamptz,
  error_message         text,
  created_at            timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_log_company ON public.message_log (company_id, created_at DESC);
CREATE INDEX idx_message_log_notif   ON public.message_log (notification_id);

COMMENT ON TABLE public.message_log IS 'Delivery audit log tracking vendor HTTP responses, message IDs, and delivery timestamps.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('message_templates');
SELECT public.attach_audit_trigger('notifications');

-- ---------------------------------------------------------------------------
-- 4. Helper Function: Mark In-App Notification As Read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.notifications
  SET
    read_at = now(),
    updated_at = now()
  WHERE id = p_notification_id
    AND user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.mark_notification_read(uuid) IS 'Marks an in-app notification as read for the authenticated recipient.';

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_log FORCE ROW LEVEL SECURITY;

-- Templates: Company staff can read, management can write
CREATE POLICY message_templates_select ON public.message_templates
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

CREATE POLICY message_templates_manage ON public.message_templates
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

-- Notifications: Users can view their own; managers can view all in company
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'supervisor'::public.user_role])
    )
  );

-- Notifications Update: Users can update their own read_at status
CREATE POLICY notifications_update_read ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      company_id = public.get_current_company_id()
      AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
    )
  );

-- Message Log: Operations managers and admins can inspect delivery logs
CREATE POLICY message_log_select ON public.message_log
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );
