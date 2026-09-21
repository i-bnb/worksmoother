-- =============================================================================
-- Migration 028: Suppliers, Procurement & Partial Goods Receipt (GRN)
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend Settings with Purchase Order Approval Threshold
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'po_approval_threshold'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN po_approval_threshold numeric(12,2) NOT NULL DEFAULT 10000.00;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Table: suppliers (Vendor Master)
-- ---------------------------------------------------------------------------
CREATE TABLE public.suppliers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code                text        NOT NULL,
  name                text        NOT NULL,
  contact_name        text,
  email               text,
  phone               text,
  tax_id              text,
  currency            text        NOT NULL DEFAULT 'AED',
  payment_terms_days  integer     NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  address             text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_suppliers_company_code ON public.suppliers (company_id, code);

CREATE TRIGGER set_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.suppliers IS 'Commercial vendors supplying equipment, spare parts, and raw materials.';

-- ---------------------------------------------------------------------------
-- 3. Table: purchase_requests (Internal Requisitions)
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_requests (
  id              uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  request_number  text                          NOT NULL,
  requested_by    uuid                          REFERENCES auth.users(id) ON DELETE SET NULL,
  status          public.purchase_request_status NOT NULL DEFAULT 'draft',
  required_date   date,
  notes           text,
  created_at      timestamptz                   NOT NULL DEFAULT now(),
  updated_at      timestamptz                   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_purchase_requests_number ON public.purchase_requests (company_id, request_number);

CREATE TRIGGER set_purchase_requests_updated_at
  BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 4. Table: purchase_orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_orders (
  id              uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id       uuid                        REFERENCES public.branches(id) ON DELETE SET NULL,
  po_number       text                        NOT NULL,
  supplier_id     uuid                        NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  status          public.purchase_order_status NOT NULL DEFAULT 'draft',
  order_date      date                        NOT NULL DEFAULT CURRENT_DATE,
  expected_date   date,
  currency        text                        NOT NULL DEFAULT 'AED',
  subtotal        numeric(14,2)               NOT NULL DEFAULT 0.00,
  tax_amount      numeric(14,2)               NOT NULL DEFAULT 0.00,
  total_amount    numeric(14,2)               NOT NULL DEFAULT 0.00,
  created_by      uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by     uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz                 NOT NULL DEFAULT now(),
  updated_at      timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_purchase_orders_number ON public.purchase_orders (company_id, po_number);
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders (supplier_id, status);

CREATE TRIGGER set_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.purchase_orders IS 'Commercial Purchase Orders placed with suppliers.';

-- Auto-generate PO document number
CREATE OR REPLACE FUNCTION public.handle_purchase_order_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.po_number IS NULL OR trim(NEW.po_number) = '' THEN
    NEW.po_number := public.generate_document_number(
      NEW.company_id,
      'PO'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_purchase_order_auto_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_purchase_order_before_insert();

-- ---------------------------------------------------------------------------
-- 5. Table: purchase_order_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               uuid          NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id             uuid          NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  quantity            numeric(12,4) NOT NULL CHECK (quantity > 0),
  received_quantity   numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (received_quantity >= 0),
  remaining_quantity  numeric(12,4) GENERATED ALWAYS AS (quantity - received_quantity) STORED,
  unit_price          numeric(12,4) NOT NULL CHECK (unit_price >= 0),
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 5.00,
  discount_percent    numeric(5,2)  NOT NULL DEFAULT 0.00,
  line_total          numeric(14,4) NOT NULL DEFAULT 0.0000,
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_po_received_bounds CHECK (received_quantity <= quantity)
);

CREATE INDEX idx_po_lines_po ON public.purchase_order_lines (po_id);

-- ---------------------------------------------------------------------------
-- 6. Table: goods_receipts (GRN: Goods Receipt Note)
-- ---------------------------------------------------------------------------
CREATE TABLE public.goods_receipts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  receipt_number        text        NOT NULL,
  po_id                 uuid        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  location_id           uuid        NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  received_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  receipt_date          timestamptz NOT NULL DEFAULT now(),
  vendor_delivery_note  text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_goods_receipts_number ON public.goods_receipts (company_id, receipt_number);
CREATE INDEX idx_goods_receipts_po ON public.goods_receipts (po_id);

COMMENT ON TABLE public.goods_receipts IS 'Goods Receipt Notes (GRN) acknowledging physical delivery of items into warehouses.';

-- Auto-generate GRN document number
CREATE OR REPLACE FUNCTION public.handle_goods_receipt_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.receipt_number IS NULL OR trim(NEW.receipt_number) = '' THEN
    NEW.receipt_number := public.generate_document_number(
      NEW.company_id,
      'GRN'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_goods_receipt_auto_number
  BEFORE INSERT ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.handle_goods_receipt_before_insert();

-- ---------------------------------------------------------------------------
-- 7. Table: goods_receipt_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.goods_receipt_lines (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id        uuid          NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_line_id        uuid          NOT NULL REFERENCES public.purchase_order_lines(id) ON DELETE RESTRICT,
  item_id           uuid          NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  quantity_received numeric(12,4) NOT NULL CHECK (quantity_received > 0),
  unit_cost         numeric(12,4) NOT NULL CHECK (unit_cost >= 0),
  serial_number     text,
  batch_number      text,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_grn_lines_receipt ON public.goods_receipt_lines (receipt_id);

-- Attach audit triggers
SELECT public.attach_audit_trigger('suppliers');
SELECT public.attach_audit_trigger('purchase_orders');
SELECT public.attach_audit_trigger('goods_receipts');
