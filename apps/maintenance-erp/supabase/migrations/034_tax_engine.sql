-- =============================================================================
-- Migration 034: Reusable Tax Engine Foundation & Settings Thresholds
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Tax code configuration with effective dates and inclusive/exclusive flags
--   - Settings extensions for quotation value and discount approval thresholds
--   - Server-side tax calculation helper (numeric(14,3) precision)
--   - Extensible for Phase 3 double-entry tax posting

-- ---------------------------------------------------------------------------
-- 1. Extend Settings with Sales & Quotation Approval Thresholds
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'quotation_approval_threshold'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN quotation_approval_threshold numeric(14,3) NOT NULL DEFAULT 5000.000;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'discount_approval_threshold'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN discount_approval_threshold numeric(5,2) NOT NULL DEFAULT 15.00;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Table: tax_codes (Reusable Commercial & Legal Tax Rates)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tax_codes (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code          text          NOT NULL, -- 'VAT-5', 'ZERO-0', 'EXEMPT', 'GST-18'
  name          text          NOT NULL,
  rate          numeric(5,2)  NOT NULL DEFAULT 5.00 CHECK (rate >= 0 AND rate <= 100),
  is_inclusive  boolean       NOT NULL DEFAULT false,
  is_active     boolean       NOT NULL DEFAULT true,
  valid_from    date          NOT NULL DEFAULT CURRENT_DATE,
  valid_to      date,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_tax_codes_date_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX uq_tax_codes_company_code ON public.tax_codes (company_id, code);
CREATE INDEX idx_tax_codes_lookup ON public.tax_codes (company_id, is_active);

CREATE TRIGGER set_tax_codes_updated_at
  BEFORE UPDATE ON public.tax_codes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.tax_codes IS 'Tax jurisdiction definitions, percentages, and validity ranges.';

-- ---------------------------------------------------------------------------
-- 3. Function: calculate_tax_breakdown
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_tax_breakdown(
  p_company_id uuid,
  p_amount numeric,
  p_tax_code_id uuid DEFAULT NULL,
  p_is_inclusive boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rate numeric(5,2);
  v_inclusive boolean;
  v_taxable numeric(14,3);
  v_tax numeric(14,3);
  v_gross numeric(14,3);
  v_amt numeric(14,3) := round(COALESCE(p_amount, 0), 3);
BEGIN
  IF p_tax_code_id IS NOT NULL THEN
    SELECT rate, is_inclusive INTO v_rate, v_inclusive
    FROM public.tax_codes
    WHERE id = p_tax_code_id AND company_id = p_company_id;
  END IF;

  IF v_rate IS NULL THEN
    SELECT tax_rate, tax_inclusive INTO v_rate, v_inclusive
    FROM public.settings
    WHERE company_id = p_company_id;
  END IF;

  v_rate := COALESCE(v_rate, 5.00);
  IF p_is_inclusive IS NOT NULL THEN
    v_inclusive := p_is_inclusive;
  ELSE
    v_inclusive := COALESCE(v_inclusive, false);
  END IF;

  IF v_inclusive THEN
    -- Amount includes tax: Taxable = Amount / (1 + Rate / 100)
    v_taxable := round(v_amt / (1.00 + (v_rate / 100.00)), 3);
    v_tax := round(v_amt - v_taxable, 3);
    v_gross := v_amt;
  ELSE
    -- Amount excludes tax: Tax = Amount * (Rate / 100)
    v_taxable := v_amt;
    v_tax := round(v_amt * (v_rate / 100.00), 3);
    v_gross := round(v_taxable + v_tax, 3);
  END IF;

  RETURN jsonb_build_object(
    'amount', v_amt,
    'rate', v_rate,
    'is_inclusive', v_inclusive,
    'taxable_amount', v_taxable,
    'tax_amount', v_tax,
    'gross_amount', v_gross
  );
END;
$$;

COMMENT ON FUNCTION public.calculate_tax_breakdown(uuid, numeric, uuid, boolean)
IS 'Server-side tax engine performing precise numeric(14,3) tax-inclusive/exclusive breakdown calculations.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('tax_codes');
