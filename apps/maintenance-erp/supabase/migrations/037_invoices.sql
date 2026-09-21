-- =============================================================================
-- Migration 037: Commercial Invoices, Lines, Immutability & Status History
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Authoritative commercial invoice header with numeric(14,3) money precision
--   - Work order, quotation, and sales order linkage
--   - Strict database immutability trigger protecting issued invoices from edits
--   - Invoice lines linking to billable work order items and parts
--   - Auto-numbering with 'INV' number series (INV-YYYY-XXXX)

-- ---------------------------------------------------------------------------
-- 1. Table: invoices
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoices (
  id                    uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id           uuid                  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id               uuid                  REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  work_order_id         uuid                  REFERENCES public.work_orders(id) ON DELETE SET NULL,
  quotation_id          uuid                  REFERENCES public.quotations(id) ON DELETE SET NULL,
  sales_order_id        uuid                  REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  invoice_number        text                  NOT NULL,
  invoice_date          date                  NOT NULL DEFAULT CURRENT_DATE,
  due_date              date                  NOT NULL,
  currency              text                  NOT NULL DEFAULT 'AED',
  subtotal              numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  discount_amount       numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  taxable_amount        numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount            numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  rounding_adjustment   numeric(14,3)         NOT NULL DEFAULT 0.000,
  grand_total           numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  amount_paid           numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (amount_paid >= 0),
  amount_credited       numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (amount_credited >= 0),
  amount_due            numeric(14,3)         GENERATED ALWAYS AS (grand_total - amount_paid - amount_credited) STORED,
  notes                 text,
  terms_and_conditions  text,
  status                public.invoice_status NOT NULL DEFAULT 'draft',
  created_by            uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_by             uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at             timestamptz,
  cancelled_by          uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  is_posted_to_gl       boolean               NOT NULL DEFAULT false,
  gl_posted_at          timestamptz,
  gl_journal_entry_id   uuid,
  idempotency_key       text,
  created_at            timestamptz           NOT NULL DEFAULT now(),
  updated_at            timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT chk_invoice_due_date CHECK (due_date >= invoice_date),
  CONSTRAINT chk_invoice_paid_bounds CHECK (amount_paid + amount_credited <= grand_total)
);

CREATE UNIQUE INDEX uq_invoices_company_number ON public.invoices (company_id, invoice_number);
CREATE INDEX idx_invoices_customer_status ON public.invoices (customer_id, status);
CREATE INDEX idx_invoices_due_date        ON public.invoices (company_id, due_date, status);
CREATE INDEX idx_invoices_work_order      ON public.invoices (work_order_id);
CREATE INDEX idx_invoices_quotation       ON public.invoices (quotation_id);
CREATE UNIQUE INDEX uq_invoices_idempotency
  ON public.invoices (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Invoice Number
CREATE OR REPLACE FUNCTION public.handle_invoice_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR trim(NEW.invoice_number) = '' THEN
    NEW.invoice_number := public.generate_document_number(
      NEW.company_id,
      'INV'::public.document_type,
      NEW.branch_id
    );
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := NEW.invoice_date + INTERVAL '30 days';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_auto_fields
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.handle_invoice_before_insert();

-- Strict Immutability Trigger for Issued Invoices
CREATE OR REPLACE FUNCTION public.trg_enforce_invoice_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Cannot delete non-draft invoice %. Issued invoices must be cancelled or credited.', OLD.invoice_number
        USING ERRCODE = '22000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- If already issued, protect core financial content from modification
    IF OLD.status IN ('issued', 'partially_paid', 'paid', 'overdue') THEN
      IF (NEW.invoice_number <> OLD.invoice_number OR
          NEW.invoice_date   <> OLD.invoice_date OR
          NEW.customer_id    <> OLD.customer_id OR
          NEW.subtotal       <> OLD.subtotal OR
          NEW.taxable_amount <> OLD.taxable_amount OR
          NEW.tax_amount     <> OLD.tax_amount OR
          NEW.grand_total    <> OLD.grand_total) THEN
        RAISE EXCEPTION 'Invoice % is issued and immutable. Financial values and client details cannot be modified.', OLD.invoice_number
          USING ERRCODE = '22000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_immutability
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_invoice_immutability();

COMMENT ON TABLE public.invoices IS 'Commercial VAT-compliant invoices with strict state-driven immutability controls.';

-- ---------------------------------------------------------------------------
-- 2. Table: invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoice_lines (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                uuid          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  line_number               integer       NOT NULL DEFAULT 1 CHECK (line_number >= 1),
  line_type                 text          NOT NULL DEFAULT 'service',
  item_id                   uuid          REFERENCES public.items(id) ON DELETE RESTRICT,
  description               text          NOT NULL,
  quantity                  numeric(12,4) NOT NULL CHECK (quantity > 0),
  uom_id                    uuid          REFERENCES public.uoms(id) ON DELETE RESTRICT,
  unit_price                numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  discount_amount           numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  tax_code_id               uuid          REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  tax_rate                  numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  taxable_amount            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount                numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  line_total                numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (line_total >= 0),
  work_order_id             uuid          REFERENCES public.work_orders(id) ON DELETE SET NULL,
  work_order_line_id        uuid          REFERENCES public.work_order_lines(id) ON DELETE SET NULL,
  job_material_movement_id  uuid          REFERENCES public.job_material_movements(id) ON DELETE SET NULL,
  created_at                timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_lines_invoice ON public.invoice_lines (invoice_id, line_number);
CREATE INDEX idx_invoice_lines_wo_line ON public.invoice_lines (work_order_line_id) WHERE work_order_line_id IS NOT NULL;
CREATE INDEX idx_invoice_lines_job_mat ON public.invoice_lines (job_material_movement_id) WHERE job_material_movement_id IS NOT NULL;

-- Enforce Immutability on Invoice Lines
CREATE OR REPLACE FUNCTION public.trg_enforce_invoice_lines_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.invoice_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.invoices WHERE id = OLD.invoice_id;
  ELSE
    SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  IF v_status IN ('issued', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice is issued and immutable. Lines cannot be inserted, modified, or deleted.'
      USING ERRCODE = '22000';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_invoice_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_invoice_lines_immutability();

COMMENT ON TABLE public.invoice_lines IS 'Individual billed line items representing services rendered, labor hours, or parts supplied.';

-- ---------------------------------------------------------------------------
-- 3. Table: invoice_status_history
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoice_status_history (
  id            uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id    uuid                  NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  from_status   public.invoice_status,
  to_status     public.invoice_status NOT NULL,
  changed_by    uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  reason        text,
  created_at    timestamptz           NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_history_invoice ON public.invoice_status_history (invoice_id, created_at DESC);

COMMENT ON TABLE public.invoice_status_history IS 'Audit log of invoice lifecycle status transitions.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('invoices');
