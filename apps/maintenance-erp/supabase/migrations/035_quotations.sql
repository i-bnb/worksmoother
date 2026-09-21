-- =============================================================================
-- Migration 035: Commercial Quotations, Lines, Revisions & Status History
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Structured quotation headers and lines with numeric(14,3) financial precision
--   - Revisions & versioning (v1, v2, v3) preserving historic proposals
--   - Work order and customer asset integration
--   - Strict immutability protection once a proposal is accepted
--   - Automated status transition audit trail

-- ---------------------------------------------------------------------------
-- 1. Table: quotations
-- ---------------------------------------------------------------------------
CREATE TABLE public.quotations (
  id                      uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               uuid                    REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id             uuid                    NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id                 uuid                    REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  work_order_id           uuid                    REFERENCES public.work_orders(id) ON DELETE SET NULL,
  quotation_number        text                    NOT NULL,
  version                 integer                 NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_latest_version       boolean                 NOT NULL DEFAULT true,
  parent_quotation_id     uuid                    REFERENCES public.quotations(id) ON DELETE SET NULL,
  quotation_date          date                    NOT NULL DEFAULT CURRENT_DATE,
  valid_until             date                    NOT NULL,
  currency                text                    NOT NULL DEFAULT 'AED',
  subtotal                numeric(14,3)           NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  discount_percent        numeric(5,2)            NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount         numeric(14,3)           NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  taxable_amount          numeric(14,3)           NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount              numeric(14,3)           NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total             numeric(14,3)           NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  notes                   text,
  terms_and_conditions    text,
  status                  public.quotation_status NOT NULL DEFAULT 'draft',
  created_by              uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by            uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at            timestamptz,
  approved_by             uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  sent_at                 timestamptz,
  accepted_at             timestamptz,
  rejected_at             timestamptz,
  rejection_reason        text,
  idempotency_key         text,
  created_at              timestamptz             NOT NULL DEFAULT now(),
  updated_at              timestamptz             NOT NULL DEFAULT now(),

  CONSTRAINT chk_quotation_validity CHECK (valid_until >= quotation_date)
);

CREATE UNIQUE INDEX uq_quotations_company_number_ver
  ON public.quotations (company_id, quotation_number, version);

CREATE INDEX idx_quotations_customer_status ON public.quotations (customer_id, status);
CREATE INDEX idx_quotations_work_order      ON public.quotations (work_order_id);
CREATE INDEX idx_quotations_dates           ON public.quotations (company_id, quotation_date, valid_until);
CREATE UNIQUE INDEX uq_quotations_idempotency
  ON public.quotations (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_quotations_updated_at
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Quotation Number if omitted
CREATE OR REPLACE FUNCTION public.handle_quotation_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.quotation_number IS NULL OR trim(NEW.quotation_number) = '' THEN
    NEW.quotation_number := public.generate_document_number(
      NEW.company_id,
      'QUO'::public.document_type,
      NEW.branch_id
    );
  END IF;

  -- Default valid_until to 30 days ahead if not specified
  IF NEW.valid_until IS NULL THEN
    NEW.valid_until := NEW.quotation_date + INTERVAL '30 days';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quotation_auto_fields
  BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.handle_quotation_before_insert();

COMMENT ON TABLE public.quotations IS 'Commercial quotations and estimates with multi-version revision control.';

-- ---------------------------------------------------------------------------
-- 2. Table: quotation_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.quotation_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id        uuid          NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  line_number         integer       NOT NULL DEFAULT 1 CHECK (line_number >= 1),
  line_type           text          NOT NULL DEFAULT 'service', -- 'service', 'part', 'material', 'labour'
  item_id             uuid          REFERENCES public.items(id) ON DELETE RESTRICT,
  description         text          NOT NULL,
  quantity            numeric(12,4) NOT NULL CHECK (quantity > 0),
  uom_id              uuid          REFERENCES public.uoms(id) ON DELETE RESTRICT,
  unit_price          numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  discount_percent    numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount     numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  tax_code_id         uuid          REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  taxable_amount      numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  line_total          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (line_total >= 0),
  work_order_line_id  uuid          REFERENCES public.work_order_lines(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotation_lines_quotation ON public.quotation_lines (quotation_id, line_number);
CREATE INDEX idx_quotation_lines_item      ON public.quotation_lines (item_id);

-- Enforce Immutability on Accepted Quotations
CREATE OR REPLACE FUNCTION public.trg_enforce_quotation_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.quotation_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.quotations WHERE id = OLD.quotation_id;
  ELSE
    SELECT status INTO v_status FROM public.quotations WHERE id = NEW.quotation_id;
  END IF;

  IF v_status = 'accepted' THEN
    RAISE EXCEPTION 'Quotation is accepted and immutable. Lines cannot be modified or deleted. Create a new revision version.'
      USING ERRCODE = '22000';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_quotation_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_quotation_immutability();

COMMENT ON TABLE public.quotation_lines IS 'Individual labor, parts, or consumable lines associated with a quotation proposal.';

-- ---------------------------------------------------------------------------
-- 3. Table: quotation_status_history
-- ---------------------------------------------------------------------------
CREATE TABLE public.quotation_status_history (
  id            uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  quotation_id  uuid                    NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  from_status   public.quotation_status,
  to_status     public.quotation_status NOT NULL,
  changed_by    uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  reason        text,
  created_at    timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotation_history_quote ON public.quotation_status_history (quotation_id, created_at DESC);

COMMENT ON TABLE public.quotation_status_history IS 'Immutable transition audit trail across the complete quotation lifecycle.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('quotations');
