-- =============================================================================
-- Migration 036: Sales Orders & Commercial Fulfillment Lines
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Commercial sales orders originating from quotations, direct customer sales, or work orders
--   - Fulfillment tracking linking to inventory stock ledger issues
--   - Auto-numbering with 'SO' number series (SO-YYYY-XXXX)

-- ---------------------------------------------------------------------------
-- 1. Table: sales_orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.sales_orders (
  id                uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id         uuid                      REFERENCES public.branches(id) ON DELETE SET NULL,
  order_number      text                      NOT NULL,
  customer_id       uuid                      NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id           uuid                      REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  quotation_id      uuid                      REFERENCES public.quotations(id) ON DELETE SET NULL,
  work_order_id     uuid                      REFERENCES public.work_orders(id) ON DELETE SET NULL,
  order_date        date                      NOT NULL DEFAULT CURRENT_DATE,
  currency          text                      NOT NULL DEFAULT 'AED',
  subtotal          numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  discount_amount   numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  taxable_amount    numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount        numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total       numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  status            public.sales_order_status NOT NULL DEFAULT 'draft',
  confirmed_at      timestamptz,
  fulfilled_at      timestamptz,
  invoiced_at       timestamptz,
  notes             text,
  created_by        uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key   text,
  created_at        timestamptz               NOT NULL DEFAULT now(),
  updated_at        timestamptz               NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_sales_orders_company_number ON public.sales_orders (company_id, order_number);
CREATE INDEX idx_sales_orders_customer_status ON public.sales_orders (customer_id, status);
CREATE INDEX idx_sales_orders_quotation       ON public.sales_orders (quotation_id);
CREATE INDEX idx_sales_orders_work_order      ON public.sales_orders (work_order_id);
CREATE UNIQUE INDEX uq_sales_orders_idempotency
  ON public.sales_orders (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_sales_orders_updated_at
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Sales Order Number
CREATE OR REPLACE FUNCTION public.handle_sales_order_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.order_number IS NULL OR trim(NEW.order_number) = '' THEN
    NEW.order_number := public.generate_document_number(
      NEW.company_id,
      'SO'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sales_order_auto_fields
  BEFORE INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_sales_order_before_insert();

COMMENT ON TABLE public.sales_orders IS 'Commercial sales contracts and product/service fulfillment orders.';

-- ---------------------------------------------------------------------------
-- 2. Table: sales_order_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.sales_order_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id      uuid          NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  line_number         integer       NOT NULL DEFAULT 1 CHECK (line_number >= 1),
  item_id             uuid          REFERENCES public.items(id) ON DELETE RESTRICT,
  description         text          NOT NULL,
  quantity            numeric(12,4) NOT NULL CHECK (quantity > 0),
  fulfilled_quantity  numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (fulfilled_quantity >= 0),
  remaining_quantity  numeric(12,4) GENERATED ALWAYS AS (quantity - fulfilled_quantity) STORED,
  uom_id              uuid          REFERENCES public.uoms(id) ON DELETE RESTRICT,
  unit_price          numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  discount_amount     numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  tax_code_id         uuid          REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  taxable_amount      numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (taxable_amount >= 0),
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  line_total          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (line_total >= 0),
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_so_line_fulfilled CHECK (fulfilled_quantity <= quantity)
);

CREATE INDEX idx_so_lines_order ON public.sales_order_lines (sales_order_id, line_number);
CREATE INDEX idx_so_lines_item  ON public.sales_order_lines (item_id);

COMMENT ON TABLE public.sales_order_lines IS 'Individual items or services delivered on a confirmed sales order.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('sales_orders');
