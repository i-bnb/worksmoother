-- =============================================================================
-- Migration 027: Stock Transfers & Multi-Location Replenishment
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- Workflows supported:
--   Warehouse -> Technician Van
--   Technician Van -> Warehouse (Returns)
--   Warehouse -> Warehouse
--   Van -> Van
-- Lifecycle: Draft -> Requested -> Approved -> In Transit -> Received -> Cancelled

-- ---------------------------------------------------------------------------
-- 1. Table: stock_transfers
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_transfers (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transfer_number   text                    NOT NULL,
  from_location_id  uuid                    NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  to_location_id    uuid                    NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  status            public.transfer_status  NOT NULL DEFAULT 'draft',
  requested_by      uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatched_at     timestamptz,
  received_at       timestamptz,
  notes             text,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  updated_at        timestamptz             NOT NULL DEFAULT now(),

  CONSTRAINT chk_different_locations CHECK (from_location_id <> to_location_id)
);

CREATE UNIQUE INDEX uq_stock_transfers_number ON public.stock_transfers (company_id, transfer_number);
CREATE INDEX idx_stock_transfers_locations ON public.stock_transfers (from_location_id, to_location_id, status);

CREATE TRIGGER set_stock_transfers_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.stock_transfers IS 'Inter-location material transfers between warehouses and mobile technician vans.';

-- ---------------------------------------------------------------------------
-- 2. Trigger Function: Auto-populate Transfer Number
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_stock_transfer_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.transfer_number IS NULL OR trim(NEW.transfer_number) = '' THEN
    NEW.transfer_number := public.generate_document_number(
      NEW.company_id,
      'TRN'::public.document_type
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_transfer_auto_number
  BEFORE INSERT ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_stock_transfer_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Table: stock_transfer_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_transfer_lines (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id       uuid          NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id           uuid          NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  quantity          numeric(12,4) NOT NULL CHECK (quantity > 0),
  received_quantity numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (received_quantity >= 0),
  serial_number     text,
  batch_number      text,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfer_lines_item ON public.stock_transfer_lines (transfer_id, item_id);

COMMENT ON TABLE public.stock_transfer_lines IS 'Individual inventory items and serial numbers scheduled for transfer.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('stock_transfers');
