-- =============================================================================
-- Migration 026: Append-Only Stock Ledger, Materialized Balances & Serials
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- Core Invariants:
--   1. stock_ledger is strictly append-only. UPDATE and DELETE are blocked by triggers.
--   2. stock_balances is maintained transactionally alongside ledger movements.
--   3. Weighted average cost is updated on every positive incoming stock transaction.
--   4. Negative stock is rejected by default unless enabled in company settings.
--   5. Serial numbers are uniquely tracked across inventory locations and customer assets.

-- ---------------------------------------------------------------------------
-- 1. Extend Settings with allow_negative_stock
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'allow_negative_stock'
  ) THEN
    ALTER TABLE public.settings
      ADD COLUMN allow_negative_stock boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_negative_stock_allowed(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT allow_negative_stock FROM public.settings WHERE company_id = p_company_id),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Table: stock_ledger (Authoritative Append-Only Movement History)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_ledger (
  id                  uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                            NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id           uuid                            REFERENCES public.branches(id) ON DELETE SET NULL,
  item_id             uuid                            NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  location_id         uuid                            NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  movement_type       public.stock_movement_type      NOT NULL,
  movement_direction  public.stock_movement_direction NOT NULL,
  quantity            numeric(12,4)                   NOT NULL CHECK (quantity > 0),
  unit_cost           numeric(12,4)                   NOT NULL DEFAULT 0.0000 CHECK (unit_cost >= 0),
  total_cost          numeric(14,4)                   NOT NULL DEFAULT 0.0000 CHECK (total_cost >= 0),
  reference_type      text                            NOT NULL, -- 'goods_receipt', 'stock_transfer', 'work_order', 'adjustment'
  reference_id        uuid                            NOT NULL,
  serial_number       text,
  batch_number        text,
  notes               text,
  idempotency_key     text,
  created_by          uuid                            REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz                     NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_ledger_item_loc  ON public.stock_ledger (company_id, item_id, location_id, created_at DESC);
CREATE INDEX idx_stock_ledger_reference ON public.stock_ledger (reference_type, reference_id);
CREATE INDEX idx_stock_ledger_serial    ON public.stock_ledger (item_id, serial_number) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX uq_stock_ledger_idempotency
  ON public.stock_ledger (company_id, reference_type, reference_id, movement_type, item_id, location_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Strict Immutability Trigger: Reject any UPDATE or DELETE on stock_ledger
CREATE OR REPLACE FUNCTION public.trg_enforce_stock_ledger_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Fatal: stock_ledger is append-only. UPDATE and DELETE operations are strictly prohibited.'
    USING ERRCODE = '22000';
END;
$$;

CREATE TRIGGER trg_stock_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_stock_ledger_immutability();

COMMENT ON TABLE public.stock_ledger IS 'Immutable, append-only authoritative financial and quantity inventory ledger.';

-- ---------------------------------------------------------------------------
-- 3. Table: stock_balances (Materialized Inventory Balances)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_balances (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id             uuid          NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  location_id         uuid          NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  quantity            numeric(12,4) NOT NULL DEFAULT 0.0000,
  reserved_quantity   numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (reserved_quantity >= 0),
  available_quantity  numeric(12,4) GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
  average_cost        numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (average_cost >= 0),
  stock_value         numeric(14,4) GENERATED ALWAYS AS (quantity * average_cost) STORED,
  last_movement_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_stock_balances_item_loc ON public.stock_balances (company_id, item_id, location_id);
CREATE INDEX idx_stock_balances_lookup ON public.stock_balances (location_id, quantity);

CREATE TRIGGER set_stock_balances_updated_at
  BEFORE UPDATE ON public.stock_balances
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.stock_balances IS 'Materialized stock quantity, available inventory, and weighted average cost per item and location.';

-- ---------------------------------------------------------------------------
-- 4. Table: serial_numbers (Serialized Component Identity & Lifecycle)
-- ---------------------------------------------------------------------------
CREATE TABLE public.serial_numbers (
  id                          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid                NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id                     uuid                NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  serial_number               text                NOT NULL,
  current_location_id         uuid                REFERENCES public.locations(id) ON DELETE SET NULL,
  status                      public.serial_status NOT NULL DEFAULT 'in_stock',
  installed_customer_asset_id uuid                REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  installed_work_order_id     uuid                REFERENCES public.work_orders(id) ON DELETE SET NULL,
  batch_number                text,
  created_at                  timestamptz         NOT NULL DEFAULT now(),
  updated_at                  timestamptz         NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_serial_numbers_scope ON public.serial_numbers (company_id, item_id, serial_number);
CREATE INDEX idx_serial_numbers_location ON public.serial_numbers (current_location_id, status);
CREATE INDEX idx_serial_numbers_asset    ON public.serial_numbers (installed_customer_asset_id) WHERE installed_customer_asset_id IS NOT NULL;

CREATE TRIGGER set_serial_numbers_updated_at
  BEFORE UPDATE ON public.serial_numbers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.serial_numbers IS 'Unique serialized equipment parts tracked across warehouse, mobile vans, and customer assets.';

-- ---------------------------------------------------------------------------
-- 5. Core Transactional Engine: public.record_stock_movement()
-- ---------------------------------------------------------------------------
-- Centralized atomic procedure that inserts into the stock ledger and recalculates
-- stock_balances and serial_numbers within the calling transaction.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_company_id uuid,
  p_branch_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_movement_type public.stock_movement_type,
  p_movement_direction public.stock_movement_direction,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_serial_number text DEFAULT NULL,
  p_batch_number text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ledger_id uuid;
  v_balance RECORD;
  v_new_qty numeric(12,4);
  v_new_avg_cost numeric(12,4);
  v_total_cost numeric(14,4);
  v_allow_negative boolean;
  v_track_serial boolean;
  v_now timestamptz := now();
BEGIN
  -- 1. Validate UOM decimal constraint
  PERFORM public.validate_item_quantity(p_item_id, p_quantity);

  -- 2. Lookup item tracking properties
  SELECT track_serial INTO v_track_serial
  FROM public.items
  WHERE id = p_item_id;

  IF v_track_serial IS TRUE AND p_serial_number IS NULL THEN
    RAISE EXCEPTION 'Item % requires a serial number for stock movements', p_item_id
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock or initialize stock_balance row FOR UPDATE
  SELECT * INTO v_balance
  FROM public.stock_balances
  WHERE company_id = p_company_id
    AND item_id = p_item_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF v_balance.id IS NULL THEN
    -- Initialize zero row
    INSERT INTO public.stock_balances (
      company_id, item_id, location_id, quantity, reserved_quantity,
      average_cost, last_movement_at, updated_at
    ) VALUES (
      p_company_id, p_item_id, p_location_id, 0.0000, 0.0000,
      p_unit_cost, v_now, v_now
    )
    RETURNING * INTO v_balance;

    -- Re-select FOR UPDATE
    SELECT * INTO v_balance
    FROM public.stock_balances
    WHERE id = v_balance.id
    FOR UPDATE;
  END IF;

  -- 4. Calculate new quantity and weighted average cost
  IF p_movement_direction = 'in' THEN
    v_new_qty := v_balance.quantity + p_quantity;

    -- Calculate weighted average cost on incoming receipts
    IF v_new_qty > 0 AND p_unit_cost > 0 THEN
      v_new_avg_cost := (
        (v_balance.quantity * v_balance.average_cost) + (p_quantity * p_unit_cost)
      ) / v_new_qty;
    ELSE
      v_new_avg_cost := COALESCE(NULLIF(p_unit_cost, 0), v_balance.average_cost);
    END IF;

    v_total_cost := ROUND(p_quantity * p_unit_cost, 4);

  ELSIF p_movement_direction = 'out' THEN
    v_new_qty := v_balance.quantity - p_quantity;
    v_new_avg_cost := v_balance.average_cost;
    -- Outgoing costs are valued at current weighted average cost
    v_total_cost := ROUND(p_quantity * v_balance.average_cost, 4);

    -- 5. Negative stock guard
    IF v_new_qty < 0 THEN
      v_allow_negative := public.is_negative_stock_allowed(p_company_id);
      IF NOT v_allow_negative THEN
        RAISE EXCEPTION 'Insufficient stock: Available % in location %, requested %',
          v_balance.quantity, p_location_id, p_quantity
          USING ERRCODE = '22000';
      END IF;
    END IF;
  END IF;

  -- 6. Insert append-only stock ledger record
  INSERT INTO public.stock_ledger (
    company_id, branch_id, item_id, location_id,
    movement_type, movement_direction, quantity, unit_cost, total_cost,
    reference_type, reference_id, serial_number, batch_number, notes,
    idempotency_key, created_by, created_at
  ) VALUES (
    p_company_id, p_branch_id, p_item_id, p_location_id,
    p_movement_type, p_movement_direction, p_quantity,
    CASE WHEN p_movement_direction = 'out' THEN v_balance.average_cost ELSE p_unit_cost END,
    v_total_cost, p_reference_type, p_reference_id, p_serial_number, p_batch_number,
    p_notes, p_idempotency_key, auth.uid(), v_now
  )
  RETURNING id INTO v_ledger_id;

  -- 7. Update materialized stock balance
  UPDATE public.stock_balances
  SET
    quantity = v_new_qty,
    average_cost = v_new_avg_cost,
    last_movement_at = v_now,
    updated_at = v_now
  WHERE id = v_balance.id;

  -- 8. Synchronize Serial Number Status if tracking applies
  IF p_serial_number IS NOT NULL THEN
    IF p_movement_direction = 'in' THEN
      INSERT INTO public.serial_numbers (
        company_id, item_id, serial_number, current_location_id, status, batch_number, updated_at
      ) VALUES (
        p_company_id, p_item_id, p_serial_number, p_location_id, 'in_stock', p_batch_number, v_now
      )
      ON CONFLICT (company_id, item_id, serial_number) DO UPDATE SET
        current_location_id = p_location_id,
        status = 'in_stock',
        installed_customer_asset_id = NULL,
        installed_work_order_id = NULL,
        updated_at = v_now;

    ELSIF p_movement_direction = 'out' THEN
      UPDATE public.serial_numbers
      SET
        current_location_id = NULL,
        status = CASE
          WHEN p_movement_type = 'job_issue' THEN 'installed'
          WHEN p_movement_type = 'scrap' THEN 'scrapped'
          WHEN p_movement_type = 'write_off' THEN 'written_off'
          ELSE 'in_transit'
        END,
        updated_at = v_now
      WHERE company_id = p_company_id
        AND item_id = p_item_id
        AND serial_number = p_serial_number;
    END IF;
  END IF;

  RETURN v_ledger_id;
END;
$$;

COMMENT ON FUNCTION public.record_stock_movement(uuid, uuid, uuid, uuid, public.stock_movement_type, public.stock_movement_direction, numeric, numeric, text, uuid, text, text, text, text)
IS 'Atomically records an append-only stock movement, updates materialized stock balances with weighted average costing, and updates serial tracking.';
