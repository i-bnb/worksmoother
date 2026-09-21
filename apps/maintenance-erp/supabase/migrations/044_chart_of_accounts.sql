-- =============================================================================
-- Migration 044: Chart of Accounts, Groups, Periods, Cost Centers & Treasury
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: account_groups (Hierarchical Taxonomy for Balance Sheet & P&L)
-- ---------------------------------------------------------------------------
CREATE TABLE public.account_groups (
  id                uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code              text                NOT NULL, -- 'CURRENT_ASSETS', 'FIXED_ASSETS', etc.
  name              text                NOT NULL,
  account_type      public.account_type NOT NULL,
  parent_group_id   uuid                REFERENCES public.account_groups(id) ON DELETE SET NULL,
  sequence_order    integer             NOT NULL DEFAULT 10,
  created_at        timestamptz         NOT NULL DEFAULT now(),
  updated_at        timestamptz         NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_account_groups_company_code ON public.account_groups (company_id, code);
CREATE INDEX idx_account_groups_type ON public.account_groups (company_id, account_type);

CREATE TRIGGER set_account_groups_updated_at
  BEFORE UPDATE ON public.account_groups
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.account_groups IS 'Standard financial taxonomy groups for Financial Statements (Balance Sheet, P&L).';

-- ---------------------------------------------------------------------------
-- 2. Table: chart_of_accounts (General Ledger Accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE public.chart_of_accounts (
  id                      uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               uuid                REFERENCES public.branches(id) ON DELETE SET NULL,
  account_code            text                NOT NULL, -- '1010', '1200', '2010', '4010', etc.
  account_name            text                NOT NULL,
  account_type            public.account_type NOT NULL,
  account_group_id        uuid                REFERENCES public.account_groups(id) ON DELETE SET NULL,
  parent_account_id       uuid                REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  currency                text                NOT NULL DEFAULT 'AED',
  is_control_account      boolean             NOT NULL DEFAULT false,
  is_active               boolean             NOT NULL DEFAULT true,
  opening_balance_debit   numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (opening_balance_debit >= 0),
  opening_balance_credit  numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (opening_balance_credit >= 0),
  notes                   text,
  created_at              timestamptz         NOT NULL DEFAULT now(),
  updated_at              timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT chk_account_opening_balance CHECK (NOT (opening_balance_debit > 0 AND opening_balance_credit > 0))
);

CREATE UNIQUE INDEX uq_chart_of_accounts_code ON public.chart_of_accounts (company_id, account_code);
CREATE INDEX idx_chart_of_accounts_lookup ON public.chart_of_accounts (company_id, account_type, is_active);
CREATE INDEX idx_chart_of_accounts_parent ON public.chart_of_accounts (parent_account_id);

CREATE TRIGGER set_chart_of_accounts_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.chart_of_accounts IS 'Authoritative chart of accounts for double-entry general ledger posting.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('chart_of_accounts');

-- ---------------------------------------------------------------------------
-- 3. Table: accounting_periods (Fiscal Period Control)
-- ---------------------------------------------------------------------------
CREATE TABLE public.accounting_periods (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year     integer               NOT NULL CHECK (fiscal_year >= 2000 AND fiscal_year <= 2100),
  period_number   integer               NOT NULL CHECK (period_number >= 1 AND period_number <= 12),
  period_name     text                  NOT NULL, -- 'January 2026'
  start_date      date                  NOT NULL,
  end_date        date                  NOT NULL,
  status          public.period_status  NOT NULL DEFAULT 'open',
  locked_at       timestamptz,
  locked_by       uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  closed_by       uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz           NOT NULL DEFAULT now(),
  updated_at      timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT chk_period_dates CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX uq_accounting_periods_scope ON public.accounting_periods (company_id, fiscal_year, period_number);
CREATE INDEX idx_accounting_periods_lookup ON public.accounting_periods (company_id, start_date, end_date, status);

CREATE TRIGGER set_accounting_periods_updated_at
  BEFORE UPDATE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.accounting_periods IS 'Financial accounting control periods guarding against posting into locked/closed months.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('accounting_periods');

-- ---------------------------------------------------------------------------
-- 4. Table: cost_centers (Operational Profitability & Cost Allocation)
-- ---------------------------------------------------------------------------
CREATE TABLE public.cost_centers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id   uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  code        text        NOT NULL, -- 'CC-HVAC', 'CC-ELEC', 'CC-PLUMB', 'CC-MGMT'
  name        text        NOT NULL,
  department  text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_cost_centers_company_code ON public.cost_centers (company_id, code);

CREATE TRIGGER set_cost_centers_updated_at
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.cost_centers IS 'Cost centers for multidimensional profitability and expense tracking.';

-- ---------------------------------------------------------------------------
-- 5. Table: bank_accounts (Treasury & Cash Accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_accounts (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  account_name          text          NOT NULL,
  account_number_last4  text          NOT NULL,
  bank_name             text          NOT NULL,
  currency              text          NOT NULL DEFAULT 'AED',
  gl_account_id         uuid          REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  opening_balance       numeric(14,3) NOT NULL DEFAULT 0.000,
  current_balance       numeric(14,3) NOT NULL DEFAULT 0.000,
  is_active             boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_bank_accounts_company_name ON public.bank_accounts (company_id, account_name);
CREATE INDEX idx_bank_accounts_gl ON public.bank_accounts (gl_account_id);

CREATE TRIGGER set_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.bank_accounts IS 'Treasury bank accounts mapped to General Ledger asset accounts.';

-- ---------------------------------------------------------------------------
-- 6. Schema Extensions for Existing Modules
-- ---------------------------------------------------------------------------

-- A. Map tax_codes to GL Output Tax (Liability) and Input Tax (Asset)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tax_codes' AND column_name = 'gl_output_tax_account_id'
  ) THEN
    ALTER TABLE public.tax_codes
      ADD COLUMN gl_output_tax_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
      ADD COLUMN gl_input_tax_account_id  uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- B. Map payment_methods to General Ledger Asset Account (Bank/Cash/Clearing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_methods' AND column_name = 'gl_account_id'
  ) THEN
    ALTER TABLE public.payment_methods
      ADD COLUMN gl_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- C. Add hourly_cost_rate to employees for labor cost accounting
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'hourly_cost_rate'
  ) THEN
    ALTER TABLE public.employees
      ADD COLUMN hourly_cost_rate numeric(14,3) NOT NULL DEFAULT 50.000 CHECK (hourly_cost_rate >= 0);
  END IF;
END $$;

-- D. Add default_labor_cost_rate to company settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'default_labor_cost_rate'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN default_labor_cost_rate numeric(14,3) NOT NULL DEFAULT 50.000 CHECK (default_labor_cost_rate >= 0);
  END IF;
END $$;
