-- =============================================================================
-- Migration 002: Organization Structure
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Creates the multi-tenant foundation:
--   companies → branches
-- Every downstream business table carries company_id (and branch_id where relevant).
-- RLS in migration 005 uses company_id to enforce strict tenant isolation.

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
CREATE TABLE public.companies (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  slug              text        NOT NULL,           -- URL-safe unique identifier
  legal_name        text,                           -- formal registered name
  registration_no   text,                           -- company registration number
  tax_id            text,                           -- VAT / TRN / GST number
  country           text        NOT NULL DEFAULT 'AE',
  timezone          text        NOT NULL DEFAULT 'Asia/Dubai',
  default_currency  text        NOT NULL DEFAULT 'AED',
  logo_url          text,
  phone             text,
  email             text,
  address           text,
  city              text,
  state             text,
  postal_code       text,
  website           text,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness on slug (used in URLs / subdomains)
CREATE UNIQUE INDEX uq_companies_slug ON public.companies (slug);

-- Partial unique index on tax_id per country (non-null only)
CREATE UNIQUE INDEX uq_companies_tax_id ON public.companies (tax_id) WHERE tax_id IS NOT NULL;

-- Lookup index
CREATE INDEX idx_companies_is_active ON public.companies (is_active);

-- Auto-update updated_at
CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.companies IS 'Top-level tenant entity. Every business record belongs to exactly one company.';
COMMENT ON COLUMN public.companies.slug IS 'URL-safe unique identifier used in subdomains and API routes. Immutable after creation.';

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
CREATE TABLE public.branches (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name          text        NOT NULL,
  code          text        NOT NULL,   -- short code, e.g. "DXB", "AUH"
  address       text,
  city          text,
  country       text,
  phone         text,
  email         text,
  is_main       boolean     NOT NULL DEFAULT false,  -- designates headquarters
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Branch code must be unique within a company
CREATE UNIQUE INDEX uq_branches_company_code ON public.branches (company_id, code);

-- Only one branch per company may be marked as main/HQ
CREATE UNIQUE INDEX uq_branches_main ON public.branches (company_id) WHERE is_main = true;

-- Tenant lookup
CREATE INDEX idx_branches_company_id ON public.branches (company_id);
CREATE INDEX idx_branches_is_active  ON public.branches (company_id, is_active);

-- Auto-update updated_at
CREATE TRIGGER set_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.branches IS 'Physical or operational branches within a company. Users and records are scoped to branches where required.';
COMMENT ON COLUMN public.branches.is_main IS 'True for the headquarters / primary branch. Enforced unique per company.';
