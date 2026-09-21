-- =============================================================================
-- Migration 038: Credit Notes, Lines, Validation Guards & Status History
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Formal credit adjustment document referencing invoices, customers, and work orders
--   - Over-crediting validation guard preventing credits beyond invoice grand total
--   - Credit lines with tax breakdown
--   - Auto-numbering with 'CN' number series (CN-YYYY-XXXX)

-- ---------------------------------------------------------------------------
-- 1. Table: credit_notes
-- ---------------------------------------------------------------------------
CREATE TABLE public.credit_notes (
  id                    uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                      REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id           uuid                      NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id            uuid                      REFERENCES public.invoices(id) ON DELETE RESTRICT,
  work_order_id         uuid                      REFERENCES public.work_orders(id) ON DELETE SET NULL,
  credit_note_number    text                      NOT NULL,
  credit_note_date      date                      NOT NULL DEFAULT CURRENT_DATE,
  currency              text                      NOT NULL DEFAULT 'AED',
  subtotal              numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  taxable_amount        numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount            numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total           numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (grand_total > 0),
  amount_applied        numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (amount_applied >= 0),
  amount_remaining      numeric(14,3)             GENERATED ALWAYS AS (grand_total - amount_applied) STORED,
  reason                text                      NOT NULL,
  status                public.credit_note_status NOT NULL DEFAULT 'draft',
  created_by            uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by           uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  issued_at             timestamptz,
  is_posted_to_gl       boolean                   NOT NULL DEFAULT false,
  gl_posted_at          timestamptz,
  gl_journal_entry_id   uuid,
  idempotency_key       text,
  created_at            timestamptz               NOT NULL DEFAULT now(),
  updated_at            timestamptz               NOT NULL DEFAULT now(),

  CONSTRAINT chk_credit_applied_bounds CHECK (amount_applied <= grand_total)
);

CREATE UNIQUE INDEX uq_credit_notes_company_number ON public.credit_notes (company_id, credit_note_number);
CREATE INDEX idx_credit_notes_invoice   ON public.credit_notes (invoice_id);
CREATE INDEX idx_credit_notes_customer  ON public.credit_notes (customer_id, status);
CREATE UNIQUE INDEX uq_credit_notes_idempotency
  ON public.credit_notes (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_credit_notes_updated_at
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Credit Note Number
CREATE OR REPLACE FUNCTION public.handle_credit_note_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.credit_note_number IS NULL OR trim(NEW.credit_note_number) = '' THEN
    NEW.credit_note_number := public.generate_document_number(
      NEW.company_id,
      'CN'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_note_auto_fields
  BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_credit_note_before_insert();

-- Guard: Prevent Issuing Credits in Excess of Invoice Total
CREATE OR REPLACE FUNCTION public.trg_validate_credit_note_bounds()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_inv_total numeric(14,3);
  v_total_credited numeric(14,3);
BEGIN
  IF NEW.invoice_id IS NOT NULL AND NEW.status IN ('approved', 'issued', 'applied') THEN
    SELECT grand_total INTO v_inv_total
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    SELECT COALESCE(SUM(grand_total), 0.000) INTO v_total_credited
    FROM public.credit_notes
    WHERE invoice_id = NEW.invoice_id
      AND status IN ('approved', 'issued', 'applied')
      AND id <> NEW.id;

    IF (v_total_credited + NEW.grand_total) > v_inv_total THEN
      RAISE EXCEPTION 'Total credit notes (% + %) exceed invoice grand total (%)',
        v_total_credited, NEW.grand_total, v_inv_total
        USING ERRCODE = '22000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_note_bounds
  BEFORE INSERT OR UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_credit_note_bounds();

COMMENT ON TABLE public.credit_notes IS 'Formal credit adjustments for returned goods, service discounts, or billing corrections.';

-- ---------------------------------------------------------------------------
-- 2. Table: credit_note_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.credit_note_lines (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id  uuid          NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  line_number     integer       NOT NULL DEFAULT 1 CHECK (line_number >= 1),
  invoice_line_id uuid          REFERENCES public.invoice_lines(id) ON DELETE SET NULL,
  item_id         uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description     text          NOT NULL,
  quantity        numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price      numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  tax_code_id     uuid          REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  tax_rate        numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  taxable_amount  numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount      numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  line_total      numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (line_total >= 0),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_note_lines_note ON public.credit_note_lines (credit_note_id, line_number);

COMMENT ON TABLE public.credit_note_lines IS 'Line item details for credit adjustments.';

-- ---------------------------------------------------------------------------
-- 3. Table: credit_note_status_history
-- ---------------------------------------------------------------------------
CREATE TABLE public.credit_note_status_history (
  id              uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  credit_note_id  uuid                      NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  from_status     public.credit_note_status,
  to_status       public.credit_note_status NOT NULL,
  changed_by      uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  reason          text,
  created_at      timestamptz               NOT NULL DEFAULT now()
);

CREATE INDEX idx_cn_history_note ON public.credit_note_status_history (credit_note_id, created_at DESC);

COMMENT ON TABLE public.credit_note_status_history IS 'Audit tracking of credit note workflow progression.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('credit_notes');
