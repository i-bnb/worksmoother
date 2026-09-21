-- =============================================================================
-- Migration 011: Event-Condition-Action Automation Foundation
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Schema foundation for declarative automation rules:
--   Pattern: EVENT -> CONDITION -> ACTION -> CHANNEL
-- Designed for future triggers:
--   - Work order assigned -> Notify technician
--   - Invoice overdue -> Dispatch customer reminder
--   - AMC service due in 7 days -> Generate preventive work order
--   - Critical equipment breakdown reported -> Escalate to supervisor

-- ---------------------------------------------------------------------------
-- 1. Table: automation_rules
-- ---------------------------------------------------------------------------
CREATE TABLE public.automation_rules (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text          NOT NULL,
  description     text,
  event_type      text          NOT NULL, -- e.g. 'work_order.assigned', 'invoice.overdue'
  conditions      jsonb         NOT NULL DEFAULT '[]'::jsonb,
  actions         jsonb         NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean       NOT NULL DEFAULT true,
  priority        integer       NOT NULL DEFAULT 10 CHECK (priority >= 1 AND priority <= 100),
  created_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_rules_lookup
  ON public.automation_rules (company_id, event_type, is_active, priority);

CREATE TRIGGER set_automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.automation_rules IS 'Configurable rules mapping business events to automated triggers, alerts, and state transitions.';

-- ---------------------------------------------------------------------------
-- 2. Table: automation_executions
-- ---------------------------------------------------------------------------
CREATE TABLE public.automation_executions (
  id                      uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id                 uuid                      NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  company_id              uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  trigger_event           text                      NOT NULL,
  trigger_table           text                      NOT NULL,
  trigger_record_id       uuid                      NOT NULL,
  status                  public.automation_status  NOT NULL DEFAULT 'pending',
  executed_actions        jsonb                     NOT NULL DEFAULT '[]'::jsonb,
  error_message           text,
  execution_duration_ms   integer,
  created_at              timestamptz               NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_executions_rule
  ON public.automation_executions (rule_id, status);

CREATE INDEX idx_automation_executions_company
  ON public.automation_executions (company_id, created_at DESC);

COMMENT ON TABLE public.automation_executions IS 'Execution history and debugging log for triggered automation rules.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('automation_rules');

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions FORCE ROW LEVEL SECURITY;

-- Rules Select: Company staff can view active rules
CREATE POLICY automation_rules_select ON public.automation_rules
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

-- Rules Manage: Only owner_admin and operations_manager
CREATE POLICY automation_rules_manage ON public.automation_rules
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

-- Executions Select: Only management
CREATE POLICY automation_executions_select ON public.automation_executions
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );
