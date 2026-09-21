-- =============================================================================
-- Migration 030: Transactional Inventory RPCs & Operational Workflows
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- Atomic, concurrency-safe, idempotent operations for:
--   1. receive_goods_receipt(): Partial & full PO receiving into stock ledger
--   2. transfer_stock(): Multi-legged inventory transfers (Warehouse <-> Van)
--   3. issue_stock_to_job(): Part consumption from van to work order
--   4. return_stock_from_job(): Removed part disposition (Quarantine, Scrap, Customer)
--   5. adjust_stock(): Controlled variance adjustments
--   6. post_stocktake(): Physical count variance reconciliation

-- ---------------------------------------------------------------------------
-- 1. RPC: receive_goods_receipt()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_goods_receipt(
  p_po_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_vendor_delivery_note text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_po RECORD;
  v_receipt_id uuid;
  v_receipt_number text;
  v_line RECORD;
  v_po_line RECORD;
  v_qty numeric(12,4);
  v_cost numeric(12,4);
  v_item_id uuid;
  v_po_line_id uuid;
  v_serial text;
  v_batch text;
  v_unreceived_count integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Verify PO existence and lock
  SELECT id, company_id, branch_id, po_number, status
  INTO v_po
  FROM public.purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'Purchase Order % not found', p_po_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_po.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Cannot receive goods: PO is in "%" status (must be approved or ordered)', v_po.status
      USING ERRCODE = '22000';
  END IF;

  -- 2. Create Goods Receipt Note (GRN)
  INSERT INTO public.goods_receipts (
    company_id, branch_id, po_id, location_id, received_by,
    receipt_date, vendor_delivery_note, notes, created_at
  ) VALUES (
    v_po.company_id, v_po.branch_id, p_po_id, p_location_id, auth.uid(),
    v_now, p_vendor_delivery_note, p_notes, v_now
  )
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;

  -- 3. Process each incoming line
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    po_line_id uuid,
    item_id uuid,
    quantity numeric,
    unit_cost numeric,
    serial_number text,
    batch_number text
  )
  LOOP
    v_po_line_id := v_line.po_line_id;
    v_item_id := v_line.item_id;
    v_qty := v_line.quantity;
    v_cost := v_line.unit_cost;
    v_serial := v_line.serial_number;
    v_batch := v_line.batch_number;

    -- Validate line against PO
    SELECT id, quantity, received_quantity, remaining_quantity
    INTO v_po_line
    FROM public.purchase_order_lines
    WHERE id = v_po_line_id AND po_id = p_po_id
    FOR UPDATE;

    IF v_po_line.id IS NULL THEN
      RAISE EXCEPTION 'PO Line % does not belong to PO %', v_po_line_id, p_po_id
        USING ERRCODE = '22000';
    END IF;

    IF v_qty > v_po_line.remaining_quantity THEN
      RAISE EXCEPTION 'Cannot receive %: Outstanding quantity for item is %', v_qty, v_po_line.remaining_quantity
        USING ERRCODE = '22000';
    END IF;

    -- Insert GRN line
    INSERT INTO public.goods_receipt_lines (
      receipt_id, po_line_id, item_id, quantity_received, unit_cost, serial_number, batch_number, created_at
    ) VALUES (
      v_receipt_id, v_po_line_id, v_item_id, v_qty, v_cost, v_serial, v_batch, v_now
    );

    -- Update received quantity on PO line
    UPDATE public.purchase_order_lines
    SET received_quantity = received_quantity + v_qty
    WHERE id = v_po_line_id;

    -- Record inventory movement in stock ledger and balances
    PERFORM public.record_stock_movement(
      v_po.company_id,
      v_po.branch_id,
      v_item_id,
      p_location_id,
      'purchase_receipt'::public.stock_movement_type,
      'in'::public.stock_movement_direction,
      v_qty,
      v_cost,
      'goods_receipt',
      v_receipt_id,
      v_serial,
      v_batch,
      'Received via GRN ' || v_receipt_number,
      p_idempotency_key
    );
  END LOOP;

  -- 4. Check if PO is completely fulfilled
  SELECT COUNT(*) INTO v_unreceived_count
  FROM public.purchase_order_lines
  WHERE po_id = p_po_id AND remaining_quantity > 0;

  IF v_unreceived_count = 0 THEN
    UPDATE public.purchase_orders
    SET status = 'fully_received', updated_at = v_now
    WHERE id = p_po_id;
  ELSE
    UPDATE public.purchase_orders
    SET status = 'partially_received', updated_at = v_now
    WHERE id = p_po_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'po_status', CASE WHEN v_unreceived_count = 0 THEN 'fully_received' ELSE 'partially_received' END
  );
END;
$$;

COMMENT ON FUNCTION public.receive_goods_receipt(uuid, uuid, jsonb, text, text, text)
IS 'Atomically registers goods receipts (GRN), updates PO fulfilled quantities, and logs inventory movements with weighted average costing.';

-- ---------------------------------------------------------------------------
-- 2. RPC: transfer_stock()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_loc RECORD;
  v_to_loc RECORD;
  v_transfer_id uuid;
  v_transfer_number text;
  v_line RECORD;
  v_qty numeric(12,4);
  v_item_id uuid;
  v_serial text;
  v_batch text;
  v_now timestamptz := now();
BEGIN
  -- Verify source and destination
  SELECT id, company_id, branch_id, name INTO v_from_loc
  FROM public.locations WHERE id = p_from_location_id;

  SELECT id, company_id, branch_id, name INTO v_to_loc
  FROM public.locations WHERE id = p_to_location_id;

  IF v_from_loc.id IS NULL OR v_to_loc.id IS NULL THEN
    RAISE EXCEPTION 'Source or destination location not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_from_loc.company_id <> v_to_loc.company_id THEN
    RAISE EXCEPTION 'Cannot transfer inventory across companies' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_company_member(v_from_loc.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- Create Transfer Record
  INSERT INTO public.stock_transfers (
    company_id, from_location_id, to_location_id, status,
    requested_by, approved_by, dispatched_at, received_at, notes, created_at, updated_at
  ) VALUES (
    v_from_loc.company_id, p_from_location_id, p_to_location_id, 'received',
    auth.uid(), auth.uid(), v_now, v_now, p_notes, v_now, v_now
  )
  RETURNING id, transfer_number INTO v_transfer_id, v_transfer_number;

  -- Process transfer lines atomically
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    item_id uuid,
    quantity numeric,
    serial_number text,
    batch_number text
  )
  LOOP
    v_item_id := v_line.item_id;
    v_qty := v_line.quantity;
    v_serial := v_line.serial_number;
    v_batch := v_line.batch_number;

    -- Record transfer line
    INSERT INTO public.stock_transfer_lines (
      transfer_id, item_id, quantity, received_quantity, serial_number, batch_number, created_at
    ) VALUES (
      v_transfer_id, v_item_id, v_qty, v_qty, v_serial, v_batch, v_now
    );

    -- Leg 1: Deduct from source location (transfer_out)
    PERFORM public.record_stock_movement(
      v_from_loc.company_id,
      v_from_loc.branch_id,
      v_item_id,
      p_from_location_id,
      'transfer_out'::public.stock_movement_type,
      'out'::public.stock_movement_direction,
      v_qty,
      0, -- unit cost automatically resolved from weighted average
      'stock_transfer',
      v_transfer_id,
      v_serial,
      v_batch,
      'Transfer out to ' || v_to_loc.name,
      p_idempotency_key
    );

    -- Leg 2: Add to destination location (transfer_in)
    PERFORM public.record_stock_movement(
      v_to_loc.company_id,
      v_to_loc.branch_id,
      v_item_id,
      p_to_location_id,
      'transfer_in'::public.stock_movement_type,
      'in'::public.stock_movement_direction,
      v_qty,
      (SELECT average_cost FROM public.stock_balances WHERE company_id = v_from_loc.company_id AND item_id = v_item_id AND location_id = p_from_location_id),
      'stock_transfer',
      v_transfer_id,
      v_serial,
      v_batch,
      'Transfer in from ' || v_from_loc.name,
      p_idempotency_key
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number
  );
END;
$$;

COMMENT ON FUNCTION public.transfer_stock(uuid, uuid, jsonb, text, text)
IS 'Atomically transfers stock between two locations (Warehouse -> Van, Van -> Warehouse, etc.).';

-- ---------------------------------------------------------------------------
-- 3. RPC: issue_stock_to_job()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_stock_to_job(
  p_work_order_id uuid,
  p_visit_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_location_id uuid DEFAULT NULL,
  p_serial_number text DEFAULT NULL,
  p_coverage public.material_coverage DEFAULT 'chargeable',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo RECORD;
  v_item RECORD;
  v_emp_id uuid;
  v_loc_id uuid;
  v_movement_id uuid;
  v_now timestamptz := now();
BEGIN
  v_emp_id := public.get_current_employee_id();

  -- Verify work order
  SELECT id, company_id, branch_id, asset_id INTO v_wo
  FROM public.work_orders WHERE id = p_work_order_id;

  IF v_wo.id IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', p_work_order_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve source location (default to technician van)
  IF p_location_id IS NOT NULL THEN
    v_loc_id := p_location_id;
  ELSE
    v_loc_id := public.get_technician_van_location_id(v_emp_id);
    IF v_loc_id IS NULL THEN
      RAISE EXCEPTION 'Technician has no active assigned van location' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Verify item
  SELECT id, sku, name, track_serial INTO v_item
  FROM public.items WHERE id = p_item_id;

  -- 1. Deduct from stock location
  v_movement_id := public.record_stock_movement(
    v_wo.company_id,
    v_wo.branch_id,
    p_item_id,
    v_loc_id,
    'job_issue'::public.stock_movement_type,
    'out'::public.stock_movement_direction,
    p_quantity,
    0,
    'work_order',
    p_work_order_id,
    p_serial_number,
    NULL,
    'Job consumption on WO ' || p_work_order_id,
    p_idempotency_key
  );

  -- 2. Link with Phase 1 job_material_movements
  INSERT INTO public.job_material_movements (
    company_id, work_order_id, visit_id, technician_id,
    movement_type, item_code, item_name, quantity, serial_number,
    source_location, coverage, is_billable, reason, created_at
  ) VALUES (
    v_wo.company_id, p_work_order_id, p_visit_id, COALESCE(v_emp_id, (SELECT id FROM public.employees WHERE company_id = v_wo.company_id LIMIT 1)),
    'installed'::public.material_movement_type, v_item.sku, v_item.name, p_quantity, p_serial_number,
    (SELECT name FROM public.locations WHERE id = v_loc_id), p_coverage,
    CASE WHEN p_coverage = 'chargeable' THEN true ELSE false END,
    p_notes, v_now
  );

  -- 3. If serialized part, attach to customer asset
  IF p_serial_number IS NOT NULL AND v_wo.asset_id IS NOT NULL THEN
    UPDATE public.serial_numbers
    SET
      installed_customer_asset_id = v_wo.asset_id,
      installed_work_order_id = v_wo.id,
      status = 'installed',
      updated_at = v_now
    WHERE company_id = v_wo.company_id
      AND item_id = p_item_id
      AND serial_number = p_serial_number;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ledger_movement_id', v_movement_id,
    'item_sku', v_item.sku,
    'quantity_issued', p_quantity
  );
END;
$$;

COMMENT ON FUNCTION public.issue_stock_to_job(uuid, uuid, uuid, numeric, uuid, text, public.material_coverage, text, text)
IS 'Deducts spare parts from technician van or warehouse, logs job_material_movements, and assigns serial numbers to customer assets.';

-- ---------------------------------------------------------------------------
-- 4. RPC: return_stock_from_job()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_stock_from_job(
  p_work_order_id uuid,
  p_visit_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_disposition public.material_disposition,
  p_serial_number text DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo RECORD;
  v_item RECORD;
  v_emp_id uuid;
  v_dest_loc_id uuid;
  v_movement_type public.stock_movement_type;
  v_now timestamptz := now();
BEGIN
  v_emp_id := public.get_current_employee_id();

  SELECT id, company_id, branch_id INTO v_wo
  FROM public.work_orders WHERE id = p_work_order_id;

  SELECT id, sku, name INTO v_item
  FROM public.items WHERE id = p_item_id;

  -- 1. If left with customer, record movement only (no stock return)
  IF p_disposition = 'left_with_customer' THEN
    INSERT INTO public.job_material_movements (
      company_id, work_order_id, visit_id, technician_id,
      movement_type, item_code, item_name, quantity, serial_number,
      coverage, is_billable, condition, disposition, reason, created_at
    ) VALUES (
      v_wo.company_id, p_work_order_id, p_visit_id, COALESCE(v_emp_id, (SELECT id FROM public.employees WHERE company_id = v_wo.company_id LIMIT 1)),
      'removed'::public.material_movement_type, v_item.sku, v_item.name, p_quantity, p_serial_number,
      'chargeable', false, 'decommissioned', p_disposition, p_reason, v_now
    );

    RETURN jsonb_build_object('success', true, 'action', 'left_with_customer');
  END IF;

  -- 2. Resolve destination location based on disposition
  IF p_destination_location_id IS NOT NULL THEN
    v_dest_loc_id := p_destination_location_id;
  ELSE
    -- Resolve default quarantine / scrap / returns location
    SELECT id INTO v_dest_loc_id
    FROM public.locations
    WHERE company_id = v_wo.company_id
      AND location_type = CASE
        WHEN p_disposition = 'scrap' THEN 'scrap'::public.location_type
        WHEN p_disposition = 'supplier_warranty_return' THEN 'quarantine'::public.location_type
        ELSE 'returns'::public.location_type
      END
      AND is_active = true
    LIMIT 1;

    IF v_dest_loc_id IS NULL THEN
      -- Fallback to first warehouse
      SELECT id INTO v_dest_loc_id
      FROM public.locations
      WHERE company_id = v_wo.company_id AND location_type = 'warehouse' AND is_active = true
      LIMIT 1;
    END IF;
  END IF;

  -- 3. Ingest returned component into quarantine / scrap / returns location
  v_movement_type := CASE
    WHEN p_disposition = 'scrap' THEN 'scrap'::public.stock_movement_type
    ELSE 'job_return'::public.stock_movement_type
  END;

  PERFORM public.record_stock_movement(
    v_wo.company_id,
    v_wo.branch_id,
    p_item_id,
    v_dest_loc_id,
    v_movement_type,
    'in'::public.stock_movement_direction,
    p_quantity,
    0, -- Scrap/return value can be adjusted or zeroed
    'work_order',
    p_work_order_id,
    p_serial_number,
    NULL,
    'Defective part removed: ' || COALESCE(p_reason, 'No reason specified'),
    p_idempotency_key
  );

  -- 4. Record job material movement
  INSERT INTO public.job_material_movements (
    company_id, work_order_id, visit_id, technician_id,
    movement_type, item_code, item_name, quantity, serial_number,
    coverage, is_billable, condition, disposition, reason, created_at
  ) VALUES (
    v_wo.company_id, p_work_order_id, p_visit_id, COALESCE(v_emp_id, (SELECT id FROM public.employees WHERE company_id = v_wo.company_id LIMIT 1)),
    'removed'::public.material_movement_type, v_item.sku, v_item.name, p_quantity, p_serial_number,
    'chargeable', false, 'defective', p_disposition, p_reason, v_now
  );

  -- 5. Update Serial Status if applicable
  IF p_serial_number IS NOT NULL THEN
    UPDATE public.serial_numbers
    SET
      status = CASE
        WHEN p_disposition = 'scrap' THEN 'scrapped'::public.serial_status
        ELSE 'returned'::public.serial_status
      END,
      current_location_id = v_dest_loc_id,
      installed_customer_asset_id = NULL,
      updated_at = v_now
    WHERE company_id = v_wo.company_id
      AND item_id = p_item_id
      AND serial_number = p_serial_number;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'destination_location_id', v_dest_loc_id,
    'disposition', p_disposition
  );
END;
$$;

COMMENT ON FUNCTION public.return_stock_from_job(uuid, uuid, uuid, numeric, public.material_disposition, text, uuid, text, text)
IS 'Ingests decommissioned parts removed from jobs into returns/quarantine/scrap locations.';

-- ---------------------------------------------------------------------------
-- 5. RPC: adjust_stock()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_location_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_unit_cost numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loc RECORD;
  v_movement_id uuid;
  v_direction public.stock_movement_direction;
BEGIN
  SELECT id, company_id, branch_id INTO v_loc
  FROM public.locations WHERE id = p_location_id;

  IF v_loc.id IS NULL THEN
    RAISE EXCEPTION 'Location % not found', p_location_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_loc.company_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_direction := CASE WHEN p_quantity >= 0 THEN 'in'::public.stock_movement_direction ELSE 'out'::public.stock_movement_direction END;

  v_movement_id := public.record_stock_movement(
    v_loc.company_id,
    v_loc.branch_id,
    p_item_id,
    p_location_id,
    'adjustment'::public.stock_movement_type,
    v_direction,
    ABS(p_quantity),
    p_unit_cost,
    'adjustment',
    gen_random_uuid(),
    NULL,
    NULL,
    p_reason,
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'success', true,
    'ledger_movement_id', v_movement_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: post_stocktake()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_stocktake(
  p_stocktake_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_st RECORD;
  v_line RECORD;
  v_now timestamptz := now();
  v_diff numeric(12,4);
BEGIN
  SELECT id, company_id, branch_id, location_id, status
  INTO v_st
  FROM public.stocktakes
  WHERE id = p_stocktake_id
  FOR UPDATE;

  IF v_st.id IS NULL THEN
    RAISE EXCEPTION 'Stocktake % not found', p_stocktake_id USING ERRCODE = 'P0002';
  END IF;

  IF v_st.status = 'posted' THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true);
  END IF;

  -- Reconcile each line with non-zero discrepancy
  FOR v_line IN
    SELECT item_id, discrepancy_quantity
    FROM public.stocktake_lines
    WHERE stocktake_id = p_stocktake_id AND discrepancy_quantity <> 0
  LOOP
    v_diff := v_line.discrepancy_quantity;

    PERFORM public.record_stock_movement(
      v_st.company_id,
      v_st.branch_id,
      v_line.item_id,
      v_st.location_id,
      'adjustment'::public.stock_movement_type,
      CASE WHEN v_diff > 0 THEN 'in'::public.stock_movement_direction ELSE 'out'::public.stock_movement_direction END,
      ABS(v_diff),
      0,
      'stocktake',
      p_stocktake_id,
      NULL,
      NULL,
      'Physical stocktake reconciliation variance',
      p_idempotency_key
    );
  END LOOP;

  UPDATE public.stocktakes
  SET
    status = 'posted',
    posted_at = v_now,
    posted_by = auth.uid(),
    updated_at = v_now
  WHERE id = p_stocktake_id;

  RETURN jsonb_build_object('success', true, 'stocktake_id', p_stocktake_id);
END;
$$;
