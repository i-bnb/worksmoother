-- =============================================================================
-- Migration 014: Customers, Sites & Hierarchical Asset Register
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: customers
-- ---------------------------------------------------------------------------
CREATE TABLE public.customers (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id       uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  name            text                  NOT NULL,
  code            text                  NOT NULL,
  customer_type   public.customer_type  NOT NULL DEFAULT 'commercial',
  tax_id          text,
  email           text,
  phone           text,
  currency        text                  NOT NULL DEFAULT 'AED',
  notes           text,
  is_active       boolean               NOT NULL DEFAULT true,
  created_by      uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz           NOT NULL DEFAULT now(),
  updated_at      timestamptz           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_customers_company_code ON public.customers (company_id, code);
CREATE INDEX idx_customers_company_active ON public.customers (company_id, is_active);
CREATE INDEX idx_customers_branch ON public.customers (branch_id);

CREATE TRIGGER set_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.customers IS 'Primary client/account records for maintenance service contracts.';

-- ---------------------------------------------------------------------------
-- 2. Table: customer_contacts
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_contacts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  email         text,
  phone         text,
  designation   text,
  is_primary    boolean     NOT NULL DEFAULT false,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_contacts_customer ON public.customer_contacts (customer_id, is_active);
CREATE INDEX idx_customer_contacts_company  ON public.customer_contacts (company_id);

CREATE TRIGGER set_customer_contacts_updated_at
  BEFORE UPDATE ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.customer_contacts IS 'Contact personnel associated with a customer organization.';

-- ---------------------------------------------------------------------------
-- 3. Table: customer_sites
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_sites (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  customer_id         uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id           uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  name                text          NOT NULL,
  code                text,
  address             text          NOT NULL,
  city                text,
  state               text,
  country             text          NOT NULL DEFAULT 'AE',
  postal_code         text,
  latitude            numeric(10,7) CHECK (latitude >= -90 AND latitude <= 90),
  longitude           numeric(10,7) CHECK (longitude >= -180 AND longitude <= 180),
  contact_name        text,
  contact_phone       text,
  contact_email       text,
  preferred_language  text          NOT NULL DEFAULT 'en',
  notes               text,
  is_active           boolean       NOT NULL DEFAULT true,
  created_by          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_customer_sites_scope ON public.customer_sites (company_id, customer_id, name);
CREATE INDEX idx_customer_sites_customer ON public.customer_sites (customer_id, is_active);
CREATE INDEX idx_customer_sites_branch   ON public.customer_sites (branch_id);
CREATE INDEX idx_customer_sites_coords   ON public.customer_sites (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TRIGGER set_customer_sites_updated_at
  BEFORE UPDATE ON public.customer_sites
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.customer_sites IS 'Physical service locations / buildings where equipment is installed.';

-- ---------------------------------------------------------------------------
-- 4. Table: customer_assets (Equipment / Asset Register with Tree Hierarchy)
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_assets (
  id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id           uuid                REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id         uuid                NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id             uuid                NOT NULL REFERENCES public.customer_sites(id) ON DELETE RESTRICT,
  parent_asset_id     uuid                REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  name                text                NOT NULL,
  asset_code          text                NOT NULL,
  asset_type          text                NOT NULL,
  category            text,
  brand               text,
  model               text,
  serial_number       text,
  capacity            numeric(12,2),
  capacity_unit       text,
  refrigerant_type    text,
  installation_date   date,
  warranty_start_date date,
  warranty_end_date   date,
  status              public.asset_status NOT NULL DEFAULT 'active',
  qr_code             text,
  metadata            jsonb               NOT NULL DEFAULT '{}'::jsonb,
  created_by          uuid                REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz         NOT NULL DEFAULT now(),
  updated_at          timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT chk_asset_warranty_dates CHECK (
    warranty_end_date IS NULL OR warranty_start_date IS NULL OR warranty_end_date >= warranty_start_date
  )
);

CREATE UNIQUE INDEX uq_customer_assets_code ON public.customer_assets (company_id, asset_code);
CREATE UNIQUE INDEX uq_customer_assets_serial ON public.customer_assets (company_id, serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE INDEX idx_customer_assets_site ON public.customer_assets (site_id, status);
CREATE INDEX idx_customer_assets_customer ON public.customer_assets (customer_id);
CREATE INDEX idx_customer_assets_parent ON public.customer_assets (parent_asset_id);
CREATE INDEX idx_customer_assets_type ON public.customer_assets (company_id, asset_type);

CREATE TRIGGER set_customer_assets_updated_at
  BEFORE UPDATE ON public.customer_assets
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.customer_assets IS 'Equipment and asset register with hierarchical parent-child relationships.';

-- ---------------------------------------------------------------------------
-- 5. Extend profiles table with customer_id link
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
    CREATE INDEX idx_profiles_customer_id ON public.profiles (customer_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Helper Security Functions for Customer & Technician Resolution
-- ---------------------------------------------------------------------------
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

  -- Check JWT claim first
  v_jwt_cust := public.get_jwt_claim('customer_id');
  IF v_jwt_cust IS NOT NULL AND v_jwt_cust ~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN v_jwt_cust::uuid;
  END IF;

  SELECT p.customer_id INTO v_customer_id
  FROM public.profiles p
  WHERE p.id = v_uid AND p.is_active = true;

  RETURN v_customer_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_customer_id() IS 'Resolves customer_id for the authenticated customer portal user.';

CREATE OR REPLACE FUNCTION public.get_current_employee_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_emp_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e.id INTO v_emp_id
  FROM public.employees e
  WHERE e.profile_id = v_uid
    AND e.is_active = true
    AND e.company_id = public.get_current_company_id()
  LIMIT 1;

  RETURN v_emp_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_employee_id() IS 'Resolves employee_id for the authenticated technician/staff user in the current company.';

-- ---------------------------------------------------------------------------
-- 7. Attach Audit Triggers
-- ---------------------------------------------------------------------------
SELECT public.attach_audit_trigger('customers');
SELECT public.attach_audit_trigger('customer_contacts');
SELECT public.attach_audit_trigger('customer_sites');
SELECT public.attach_audit_trigger('customer_assets');
