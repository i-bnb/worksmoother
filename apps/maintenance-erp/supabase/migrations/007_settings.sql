-- =============================================================================
-- Migration 007: Centralized Company Settings
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Centralized configuration for company-level settings:
--   - Currency, timezone, language, country
--   - Tax configuration (VAT/TRN rate, name, inclusive/exclusive)
--   - Enabled ERP feature modules
--   - Dynamic AI model IDs (Gemini models configurable per company; no hardcoded models)
--   - Notification channels configuration
--   - Numbering reset policies
--   - Custom branding and system preferences

-- ---------------------------------------------------------------------------
-- 1. Table: settings
-- ---------------------------------------------------------------------------
CREATE TABLE public.settings (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  currency              text          NOT NULL DEFAULT 'AED',
  timezone              text          NOT NULL DEFAULT 'Asia/Dubai',
  language              text          NOT NULL DEFAULT 'en',
  country               text          NOT NULL DEFAULT 'AE',
  tax_rate              numeric(5,2)  NOT NULL DEFAULT 5.00 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_name              text          NOT NULL DEFAULT 'VAT',
  tax_inclusive         boolean       NOT NULL DEFAULT false,
  enabled_modules       jsonb         NOT NULL DEFAULT '[
    "work_orders",
    "assets",
    "preventive_maintenance",
    "inventory",
    "invoicing",
    "customer_portal",
    "technician_pwa"
  ]'::jsonb,
  ai_model_ids          jsonb         NOT NULL DEFAULT '{
    "default_chat": "gemini-1.5-flash",
    "vision_diagnostics": "gemini-1.5-pro",
    "report_summary": "gemini-1.5-flash",
    "ocr_parts_catalog": "gemini-1.5-pro",
    "embedding": "text-embedding-004"
  }'::jsonb,
  notification_config   jsonb         NOT NULL DEFAULT '{
    "in_app_enabled": true,
    "push_enabled": true,
    "email_enabled": true,
    "whatsapp_enabled": false,
    "sms_enabled": false
  }'::jsonb,
  numbering_config      jsonb         NOT NULL DEFAULT '{
    "yearly_reset": true,
    "include_branch_code": false,
    "delimiter": "-"
  }'::jsonb,
  custom_preferences    jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Exactly one settings row per company
CREATE UNIQUE INDEX uq_settings_company_id ON public.settings (company_id);

CREATE TRIGGER set_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.settings IS 'Centralized company-level configuration, tax rules, module flags, and dynamic AI model IDs.';
COMMENT ON COLUMN public.settings.ai_model_ids IS 'Dynamic mapping of AI feature keys to specific LLM model versions. No AI models may be hardcoded.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('settings');

-- ---------------------------------------------------------------------------
-- 2. Helper: Dynamic AI Model Resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ai_model_id(model_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_model_id text;
BEGIN
  v_company_id := public.get_current_company_id();
  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.ai_model_ids ->> model_key INTO v_model_id
  FROM public.settings s
  WHERE s.company_id = v_company_id;

  RETURN COALESCE(v_model_id, 'gemini-1.5-flash');
END;
$$;

COMMENT ON FUNCTION public.get_ai_model_id(text) IS 'Resolves configured AI model ID for a given task (e.g. vision_diagnostics) for the calling user company.';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security on settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings FORCE ROW LEVEL SECURITY;

-- Select: Any authenticated member of the company can read company settings
CREATE POLICY settings_select_company ON public.settings
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

-- Update: Only owner_admin and operations_manager can update settings
CREATE POLICY settings_update_admin ON public.settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- Insert: Only owner_admin
CREATE POLICY settings_insert_admin ON public.settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_role('owner_admin'::public.user_role)
  );

-- Delete: Prohibited (settings row is permanent per company)
CREATE POLICY settings_deny_delete ON public.settings
  FOR DELETE
  TO authenticated
  USING (false);
