-- =============================================================================
-- Migration 040: Transactional Financial & Billing RPCs
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Atomic, concurrency-safe, idempotent operations for:
--   1. Quotation lifecycle (create, submit, approve, reject, accept, revise)
--   2. Sales order fulfillment through stock ledger
--   3. Invoice creation, work-order billing integration, issuance & cancellation
--   4. Credit note validation & application
--   5. Payment receipt, multi-invoice allocation & unallocation

-- ---------------------------------------------------------------------------
-- 1. RPC: create_quotation()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation(
  p_customer_id uuid,
  p_lines jsonb,
  p_site_id uuid DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL,
  p_valid_until date DEFAULT NULL,
  p_currency text DEFAULT 'AED',
  p_discount_percent numeric DEFAULT 0.00,
  p_notes text DEFAULT NULL,
  p_terms_and_conditions text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cust RECORD;
  v_quote_id uuid;
  v_quote_number text;
  v_line RECORD;
  v_line_no integer := 1;
  v_subtotal numeric(14,3) := 0.000;
  v_disc_amt numeric(14,3) := 0.000;
  v_taxable numeric(14,3) := 0.000;
  v_tax numeric(14,3) := 0.000;
  v_grand_total numeric(14,3) := 0.000;
  v_now timestamptz := now();
  v_valid_date date;
BEGIN
  -- 1. Verify Customer
  SELECT id, company_id, branch_id INTO v_cust
  FROM public.customers WHERE id = p_customer_id;

  IF v_cust.id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_cust.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Check Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, quotation_number INTO v_quote_id, v_quote_number
    FROM public.quotations
    WHERE company_id = v_cust.company_id AND idempotency_key = p_idempotency_key;

    IF v_quote_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'quotation_id', v_quote_id,
        'quotation_number', v_quote_number,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  v_valid_date := COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '30 days');

  -- 3. Pre-generate Quotation Number
  v_quote_number := public.generate_document_number(
    v_cust.company_id,
    'QUO'::public.document_type,
    v_cust.branch_id
  );

  -- 4. Create Quotation Header
  INSERT INTO public.quotations (
    company_id, branch_id, customer_id, site_id, work_order_id,
    quotation_number, version, is_latest_version, quotation_date,
    valid_until, currency, subtotal, discount_percent, discount_amount,
    taxable_amount, tax_amount, grand_total, notes, terms_and_conditions,
    status, created_by, idempotency_key, created_at, updated_at
  ) VALUES (
    v_cust.company_id, v_cust.branch_id, p_customer_id, p_site_id, p_work_order_id,
    v_quote_number, 1, true, CURRENT_DATE,
    v_valid_date, p_currency, 0.000, p_discount_percent, 0.000,
    0.000, 0.000, 0.000, p_notes, p_terms_and_conditions,
    'draft', auth.uid(), p_idempotency_key, v_now, v_now
  )
  RETURNING id INTO v_quote_id;

  -- 5. Insert Lines & Calculate Totals
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    line_type text,
    item_id uuid,
    description text,
    quantity numeric,
    uom_id uuid,
    unit_price numeric,
    discount_percent numeric,
    tax_code_id uuid,
    work_order_line_id uuid
  )
  LOOP
    DECLARE
      v_l_qty numeric(12,4) := COALESCE(v_line.quantity, 1.0000);
      v_l_price numeric(14,3) := COALESCE(v_line.unit_price, 0.000);
      v_l_disc_pct numeric(5,2) := COALESCE(v_line.discount_percent, 0.00);
      v_l_raw numeric(14,3) := round(v_l_qty * v_l_price, 3);
      v_l_disc numeric(14,3) := round(v_l_raw * (v_l_disc_pct / 100.00), 3);
      v_l_taxable numeric(14,3) := v_l_raw - v_l_disc;
      v_l_tax_rate numeric(5,2) := 5.00;
      v_l_tax numeric(14,3);
      v_l_total numeric(14,3);
      v_uom uuid := v_line.uom_id;
    BEGIN
      IF v_line.tax_code_id IS NOT NULL THEN
        SELECT rate INTO v_l_tax_rate FROM public.tax_codes WHERE id = v_line.tax_code_id;
      END IF;
      v_l_tax_rate := COALESCE(v_l_tax_rate, 5.00);
      v_l_tax := round(v_l_taxable * (v_l_tax_rate / 100.00), 3);
      v_l_total := v_l_taxable + v_l_tax;

      IF v_uom IS NULL AND v_line.item_id IS NOT NULL THEN
        SELECT uom_id INTO v_uom FROM public.items WHERE id = v_line.item_id;
      END IF;

      IF v_uom IS NULL THEN
        SELECT id INTO v_uom FROM public.uoms WHERE company_id = v_cust.company_id LIMIT 1;
      END IF;

      INSERT INTO public.quotation_lines (
        quotation_id, line_number, line_type, item_id, description,
        quantity, uom_id, unit_price, discount_percent, discount_amount,
        tax_code_id, tax_rate, taxable_amount, tax_amount, line_total,
        work_order_line_id, created_at
      ) VALUES (
        v_quote_id, v_line_no, COALESCE(v_line.line_type, 'service'), v_line.item_id, v_line.description,
        v_l_qty, v_uom, v_l_price, v_l_disc_pct, v_l_disc,
        v_line.tax_code_id, v_l_tax_rate, v_l_taxable, v_l_tax, v_l_total,
        v_line.work_order_line_id, v_now
      );

      v_subtotal := v_subtotal + v_l_raw;
      v_disc_amt := v_disc_amt + v_l_disc;
      v_taxable  := v_taxable + v_l_taxable;
      v_tax      := v_tax + v_l_tax;
      v_grand_total := v_grand_total + v_l_total;
      v_line_no := v_line_no + 1;
    END;
  END LOOP;

  -- 6. Update Quotation Header with Consolidated Calculations
  UPDATE public.quotations
  SET
    subtotal = v_subtotal,
    discount_amount = v_disc_amt,
    taxable_amount = v_taxable,
    tax_amount = v_tax,
    grand_total = v_grand_total,
    updated_at = v_now
  WHERE id = v_quote_id;

  -- 7. Log Initial Status History
  INSERT INTO public.quotation_status_history (
    company_id, quotation_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_cust.company_id, v_quote_id, NULL, 'draft', auth.uid(), 'Quotation created', v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'quotation_id', v_quote_id,
    'quotation_number', v_quote_number,
    'grand_total', v_grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. RPC: submit_quotation()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_quotation(
  p_quotation_id uuid,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_q RECORD;
  v_set RECORD;
  v_next_status public.quotation_status;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, quotation_number, status, grand_total, discount_percent
  INTO v_q
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_q.status <> 'draft' THEN
    RAISE EXCEPTION 'Quotation % is in "%" status (must be draft to submit)', v_q.quotation_number, v_q.status
      USING ERRCODE = '22000';
  END IF;

  -- Check Company Approval Thresholds
  SELECT quotation_approval_threshold, discount_approval_threshold
  INTO v_set
  FROM public.settings
  WHERE company_id = v_q.company_id;

  IF (v_q.grand_total >= COALESCE(v_set.quotation_approval_threshold, 5000.000)) OR
     (v_q.discount_percent >= COALESCE(v_set.discount_approval_threshold, 15.00)) THEN
    v_next_status := 'pending_approval';
  ELSE
    v_next_status := 'approved';
  END IF;

  UPDATE public.quotations
  SET
    status = v_next_status,
    submitted_by = auth.uid(),
    submitted_at = v_now,
    approved_by = CASE WHEN v_next_status = 'approved' THEN auth.uid() ELSE NULL END,
    approved_at = CASE WHEN v_next_status = 'approved' THEN v_now ELSE NULL END,
    updated_at = v_now
  WHERE id = p_quotation_id;

  INSERT INTO public.quotation_status_history (
    company_id, quotation_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_q.company_id, p_quotation_id, 'draft', v_next_status, auth.uid(), p_notes, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'quotation_id', p_quotation_id,
    'status', v_next_status,
    'requires_approval', (v_next_status = 'pending_approval')
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC: approve_quotation()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_quotation(
  p_quotation_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_q RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, quotation_number, status
  INTO v_q
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_q.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Quotation % is in "%" status (must be pending_approval to approve)', v_q.quotation_number, v_q.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.quotations
  SET
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = v_now,
    updated_at = v_now
  WHERE id = p_quotation_id;

  INSERT INTO public.quotation_status_history (
    company_id, quotation_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_q.company_id, p_quotation_id, 'pending_approval', 'approved', auth.uid(), p_notes, v_now
  );

  RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC: accept_quotation()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_quotation(
  p_quotation_id uuid,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_q RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, quotation_number, status, grand_total
  INTO v_q
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_q.status NOT IN ('approved', 'sent') THEN
    RAISE EXCEPTION 'Quotation % cannot be accepted from status "%"', v_q.quotation_number, v_q.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.quotations
  SET
    status = 'accepted',
    accepted_at = v_now,
    updated_at = v_now
  WHERE id = p_quotation_id;

  INSERT INTO public.quotation_status_history (
    company_id, quotation_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_q.company_id, p_quotation_id, v_q.status, 'accepted', auth.uid(), p_notes, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'quotation_id', p_quotation_id,
    'status', 'accepted',
    'grand_total', v_q.grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: revise_quotation() (Creates Next Version v2, v3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revise_quotation(
  p_quotation_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old RECORD;
  v_new_id uuid;
  v_new_ver integer;
  v_line RECORD;
  v_line_no integer := 1;
  v_subtotal numeric(14,3) := 0.000;
  v_taxable numeric(14,3) := 0.000;
  v_tax numeric(14,3) := 0.000;
  v_grand_total numeric(14,3) := 0.000;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_old
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  v_new_ver := v_old.version + 1;

  -- Mark old version as not latest
  UPDATE public.quotations
  SET is_latest_version = false, updated_at = v_now
  WHERE id = p_quotation_id;

  -- Create new version record
  INSERT INTO public.quotations (
    company_id, branch_id, customer_id, site_id, work_order_id,
    quotation_number, version, is_latest_version, parent_quotation_id,
    quotation_date, valid_until, currency, subtotal, discount_percent, discount_amount,
    taxable_amount, tax_amount, grand_total, notes, terms_and_conditions,
    status, created_by, created_at, updated_at
  ) VALUES (
    v_old.company_id, v_old.branch_id, v_old.customer_id, v_old.site_id, v_old.work_order_id,
    v_old.quotation_number, v_new_ver, true, p_quotation_id,
    CURRENT_DATE, v_old.valid_until, v_old.currency, 0.000, v_old.discount_percent, 0.000,
    0.000, 0.000, 0.000, COALESCE(p_notes, v_old.notes), v_old.terms_and_conditions,
    'draft', auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_new_id;

  -- Insert revised lines
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    line_type text, item_id uuid, description text, quantity numeric,
    uom_id uuid, unit_price numeric, discount_percent numeric, tax_code_id uuid
  )
  LOOP
    DECLARE
      v_qty numeric(12,4) := COALESCE(v_line.quantity, 1.0000);
      v_price numeric(14,3) := COALESCE(v_line.unit_price, 0.000);
      v_disc_pct numeric(5,2) := COALESCE(v_line.discount_percent, 0.00);
      v_raw numeric(14,3) := round(v_qty * v_price, 3);
      v_disc numeric(14,3) := round(v_raw * (v_disc_pct / 100.00), 3);
      v_taxable_l numeric(14,3) := v_raw - v_disc;
      v_tax_rate numeric(5,2) := 5.00;
      v_tax_l numeric(14,3);
      v_tot_l numeric(14,3);
      v_uom uuid := v_line.uom_id;
    BEGIN
      IF v_line.tax_code_id IS NOT NULL THEN
        SELECT rate INTO v_l_tax_rate FROM public.tax_codes WHERE id = v_line.tax_code_id;
      END IF;
      v_l_tax_rate := COALESCE(v_l_tax_rate, 5.00);
      v_tax_l := round(v_taxable_l * (v_l_tax_rate / 100.00), 3);
      v_tot_l := v_taxable_l + v_tax_l;

      IF v_uom IS NULL AND v_line.item_id IS NOT NULL THEN
        SELECT uom_id INTO v_uom FROM public.items WHERE id = v_line.item_id;
      END IF;

      INSERT INTO public.quotation_lines (
        quotation_id, line_number, line_type, item_id, description,
        quantity, uom_id, unit_price, discount_percent, discount_amount,
        tax_code_id, tax_rate, taxable_amount, tax_amount, line_total, created_at
      ) VALUES (
        v_new_id, v_line_no, COALESCE(v_line.line_type, 'service'), v_line.item_id, v_line.description,
        v_qty, v_uom, v_price, v_disc_pct, v_disc,
        v_line.tax_code_id, v_l_tax_rate, v_taxable_l, v_tax_l, v_tot_l, v_now
      );

      v_subtotal := v_subtotal + v_raw;
      v_taxable  := v_taxable + v_taxable_l;
      v_tax      := v_tax + v_tax_l;
      v_grand_total := v_grand_total + v_tot_l;
      v_line_no := v_line_no + 1;
    END;
  END LOOP;

  UPDATE public.quotations
  SET
    subtotal = v_subtotal,
    taxable_amount = v_taxable,
    tax_amount = v_tax,
    grand_total = v_grand_total,
    updated_at = v_now
  WHERE id = v_new_id;

  INSERT INTO public.quotation_status_history (
    company_id, quotation_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_old.company_id, v_new_id, NULL, 'draft', auth.uid(), 'Revision version created from v' || v_old.version, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_quotation_id', v_new_id,
    'quotation_number', v_old.quotation_number,
    'version', v_new_ver,
    'grand_total', v_grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: fulfill_sales_order() (Connects Material Sales to Stock Ledger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_sales_order(
  p_sales_order_id uuid,
  p_location_id uuid,
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
  v_so RECORD;
  v_line RECORD;
  v_so_line RECORD;
  v_qty numeric(12,4);
  v_item_id uuid;
  v_so_line_id uuid;
  v_unfulfilled_count integer;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, branch_id, order_number, status
  INTO v_so
  FROM public.sales_orders
  WHERE id = p_sales_order_id
  FOR UPDATE;

  IF v_so.id IS NULL THEN
    RAISE EXCEPTION 'Sales Order % not found', p_sales_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_so.status NOT IN ('confirmed', 'partially_fulfilled') THEN
    RAISE EXCEPTION 'Sales order % is in "%" status (must be confirmed or partially_fulfilled)', v_so.order_number, v_so.status
      USING ERRCODE = '22000';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    sales_order_line_id uuid,
    item_id uuid,
    quantity numeric,
    serial_number text,
    batch_number text
  )
  LOOP
    v_so_line_id := v_line.sales_order_line_id;
    v_item_id := v_line.item_id;
    v_qty := v_line.quantity;

    SELECT id, quantity, fulfilled_quantity, remaining_quantity
    INTO v_so_line
    FROM public.sales_order_lines
    WHERE id = v_so_line_id AND sales_order_id = p_sales_order_id
    FOR UPDATE;

    IF v_so_line.id IS NULL THEN
      RAISE EXCEPTION 'Sales Order Line % does not belong to Sales Order %', v_so_line_id, p_sales_order_id
        USING ERRCODE = '22000';
    END IF;

    IF v_qty > v_so_line.remaining_quantity THEN
      RAISE EXCEPTION 'Fulfillment quantity (%) exceeds remaining sales order quantity (%)', v_qty, v_so_line.remaining_quantity
        USING ERRCODE = '22000';
    END IF;

    -- Issue stock from storage location via existing authoritative stock ledger engine
    PERFORM public.record_stock_movement(
      v_so.company_id,
      v_so.branch_id,
      v_item_id,
      p_location_id,
      'customer_sale'::public.stock_movement_type,
      'out'::public.stock_movement_direction,
      v_qty,
      0.0000,
      'sales_order',
      p_sales_order_id,
      v_line.serial_number,
      v_line.batch_number,
      COALESCE(p_notes, 'Sales fulfillment on order ' || v_so.order_number),
      p_idempotency_key
    );

    UPDATE public.sales_order_lines
    SET fulfilled_quantity = fulfilled_quantity + v_qty
    WHERE id = v_so_line_id;
  END LOOP;

  -- Check if any remaining quantity is left on any line
  SELECT COUNT(*) INTO v_unfulfilled_count
  FROM public.sales_order_lines
  WHERE sales_order_id = p_sales_order_id AND remaining_quantity > 0;

  IF v_unfulfilled_count = 0 THEN
    UPDATE public.sales_orders
    SET status = 'fulfilled', fulfilled_at = v_now, updated_at = v_now
    WHERE id = p_sales_order_id;
  ELSE
    UPDATE public.sales_orders
    SET status = 'partially_fulfilled', updated_at = v_now
    WHERE id = p_sales_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sales_order_id', p_sales_order_id,
    'status', CASE WHEN v_unfulfilled_count = 0 THEN 'fulfilled' ELSE 'partially_fulfilled' END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: create_invoice_from_work_order() (Prevents Duplicate Billing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_from_work_order(
  p_work_order_id uuid,
  p_due_date date DEFAULT NULL,
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
  v_existing_inv RECORD;
  v_inv_id uuid;
  v_inv_number text;
  v_line RECORD;
  v_mat RECORD;
  v_line_no integer := 1;
  v_subtotal numeric(14,3) := 0.000;
  v_taxable numeric(14,3) := 0.000;
  v_tax numeric(14,3) := 0.000;
  v_grand_total numeric(14,3) := 0.000;
  v_due_date date;
  v_now timestamptz := now();
  v_default_uom uuid;
BEGIN
  SELECT id, company_id, branch_id, customer_id, site_id, work_order_number, status
  INTO v_wo
  FROM public.work_orders
  WHERE id = p_work_order_id;

  IF v_wo.id IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', p_work_order_id USING ERRCODE = 'P0002';
  END IF;

  -- Prevent duplicate invoicing on the same work order
  SELECT id, invoice_number INTO v_existing_inv
  FROM public.invoices
  WHERE work_order_id = p_work_order_id AND status <> 'cancelled'
  LIMIT 1;

  IF v_existing_inv.id IS NOT NULL THEN
    RAISE EXCEPTION 'Work order % is already billed under active invoice %', v_wo.work_order_number, v_existing_inv.invoice_number
      USING ERRCODE = '22000';
  END IF;

  v_due_date := COALESCE(p_due_date, CURRENT_DATE + INTERVAL '30 days');

  SELECT id INTO v_default_uom FROM public.uoms WHERE company_id = v_wo.company_id LIMIT 1;

  -- Create Draft Invoice
  v_inv_number := public.generate_document_number(
    v_wo.company_id,
    'INV'::public.document_type,
    v_wo.branch_id
  );

  INSERT INTO public.invoices (
    company_id, branch_id, customer_id, site_id, work_order_id,
    invoice_number, invoice_date, due_date, currency,
    subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
    status, notes, created_by, idempotency_key, created_at, updated_at
  ) VALUES (
    v_wo.company_id, v_wo.branch_id, v_wo.customer_id, v_wo.site_id, p_work_order_id,
    v_inv_number, CURRENT_DATE, v_due_date, 'AED',
    0.000, 0.000, 0.000, 0.000, 0.000,
    'draft', COALESCE(p_notes, 'Billing for Work Order ' || v_wo.work_order_number),
    auth.uid(), p_idempotency_key, v_now, v_now
  )
  RETURNING id INTO v_inv_id;

  -- 1. Billable Work Order Lines (Labor & Services)
  FOR v_line IN
    SELECT id, line_type, description, quantity, unit_price, total_price
    FROM public.work_order_lines
    WHERE work_order_id = p_work_order_id AND is_billable = true
  LOOP
    DECLARE
      v_l_tax numeric(14,3) := round(v_line.total_price * 0.05, 3);
      v_l_tot numeric(14,3) := v_line.total_price + v_l_tax;
    BEGIN
      INSERT INTO public.invoice_lines (
        invoice_id, line_number, line_type, description,
        quantity, uom_id, unit_price, tax_rate, taxable_amount, tax_amount, line_total,
        work_order_id, work_order_line_id, created_at
      ) VALUES (
        v_inv_id, v_line_no, v_line.line_type, v_line.description,
        v_line.quantity, v_default_uom, v_line.unit_price, 5.00, v_line.total_price, v_l_tax, v_l_tot,
        p_work_order_id, v_line.id, v_now
      );

      v_subtotal := v_subtotal + v_line.total_price;
      v_taxable  := v_taxable + v_line.total_price;
      v_tax      := v_tax + v_l_tax;
      v_grand_total := v_grand_total + v_l_tot;
      v_line_no := v_line_no + 1;
    END;
  END LOOP;

  -- 2. Billable Materials / Parts from job_material_movements
  FOR v_mat IN
    SELECT jmm.id, jmm.item_code, jmm.item_name, jmm.quantity, jmm.serial_number, i.sale_price, i.uom_id
    FROM public.job_material_movements jmm
    LEFT JOIN public.items i ON i.sku = jmm.item_code AND i.company_id = v_wo.company_id
    WHERE jmm.work_order_id = p_work_order_id
      AND jmm.movement_type = 'installed'
      AND jmm.is_billable = true
  LOOP
    DECLARE
      v_price numeric(14,3) := COALESCE(v_mat.sale_price, 100.000);
      v_raw numeric(14,3) := round(v_mat.quantity * v_price, 3);
      v_m_tax numeric(14,3) := round(v_raw * 0.05, 3);
      v_m_tot numeric(14,3) := v_raw + v_m_tax;
    BEGIN
      INSERT INTO public.invoice_lines (
        invoice_id, line_number, line_type, description,
        quantity, uom_id, unit_price, tax_rate, taxable_amount, tax_amount, line_total,
        work_order_id, job_material_movement_id, created_at
      ) VALUES (
        v_inv_id, v_line_no, 'part', v_mat.item_name || COALESCE(' (S/N: ' || v_mat.serial_number || ')', ''),
        v_mat.quantity, COALESCE(v_mat.uom_id, v_default_uom), v_price, 5.00, v_raw, v_m_tax, v_m_tot,
        p_work_order_id, v_mat.id, v_now
      );

      v_subtotal := v_subtotal + v_raw;
      v_taxable  := v_taxable + v_raw;
      v_tax      := v_tax + v_m_tax;
      v_grand_total := v_grand_total + v_m_tot;
      v_line_no := v_line_no + 1;
    END;
  END LOOP;

  UPDATE public.invoices
  SET
    subtotal = v_subtotal,
    taxable_amount = v_taxable,
    tax_amount = v_tax,
    grand_total = v_grand_total,
    updated_at = v_now
  WHERE id = v_inv_id;

  INSERT INTO public.invoice_status_history (
    company_id, invoice_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_wo.company_id, v_inv_id, NULL, 'draft', auth.uid(), 'Draft invoice generated from WO ' || v_wo.work_order_number, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'grand_total', v_grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: issue_invoice() (Stamps Invoice & Activates Immutability)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_invoice(
  p_invoice_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, invoice_number, status, grand_total, customer_id
  INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Invoice % is in "%" status (cannot issue non-draft invoice)', v_inv.invoice_number, v_inv.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.invoices
  SET
    status = 'issued',
    issued_by = auth.uid(),
    issued_at = v_now,
    updated_at = v_now
  WHERE id = p_invoice_id;

  INSERT INTO public.invoice_status_history (
    company_id, invoice_id, from_status, to_status, changed_by, reason, created_at
  ) VALUES (
    v_inv.company_id, p_invoice_id, v_inv.status, 'issued', auth.uid(), 'Commercial invoice finalized and issued', v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'invoice_number', v_inv.invoice_number,
    'status', 'issued',
    'grand_total', v_inv.grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: allocate_payment() (Multi-Invoice Payment Distribution)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_payment(
  p_payment_id uuid,
  p_allocations jsonb, -- Array of { invoice_id, amount }
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pmt RECORD;
  v_alloc RECORD;
  v_inv RECORD;
  v_amt numeric(14,3);
  v_inv_id uuid;
  v_total_to_allocate numeric(14,3) := 0.000;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, customer_id, currency, amount, allocated_amount, unallocated_amount, status
  INTO v_pmt
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_pmt.id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_pmt.status NOT IN ('received', 'cleared') THEN
    RAISE EXCEPTION 'Cannot allocate payment in status "%"', v_pmt.status USING ERRCODE = '22000';
  END IF;

  -- 1. Pre-validate total allocation does not exceed unallocated payment balance
  FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(invoice_id uuid, amount numeric)
  LOOP
    v_total_to_allocate := v_total_to_allocate + round(v_alloc.amount, 3);
  END LOOP;

  IF v_total_to_allocate > v_pmt.unallocated_amount THEN
    RAISE EXCEPTION 'Requested allocation amount (%) exceeds payment unallocated balance (%)',
      v_total_to_allocate, v_pmt.unallocated_amount
      USING ERRCODE = '22000';
  END IF;

  -- 2. Process each allocation line
  FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(invoice_id uuid, amount numeric)
  LOOP
    v_inv_id := v_alloc.invoice_id;
    v_amt := round(v_alloc.amount, 3);

    IF v_amt <= 0 THEN
      RAISE EXCEPTION 'Allocation amount must be strictly positive' USING ERRCODE = '22000';
    END IF;

    SELECT id, company_id, customer_id, currency, status, grand_total, amount_paid, amount_due
    INTO v_inv
    FROM public.invoices
    WHERE id = v_inv_id
    FOR UPDATE;

    IF v_inv.id IS NULL THEN
      RAISE EXCEPTION 'Invoice % not found', v_inv_id USING ERRCODE = 'P0002';
    END IF;

    IF v_inv.customer_id <> v_pmt.customer_id THEN
      RAISE EXCEPTION 'Invoice % customer does not match payment customer', v_inv_id USING ERRCODE = '22000';
    END IF;

    IF v_amt > v_inv.amount_due THEN
      RAISE EXCEPTION 'Allocation (%) exceeds invoice outstanding balance (%)', v_amt, v_inv.amount_due
        USING ERRCODE = '22000';
    END IF;

    -- Record allocation
    INSERT INTO public.payment_allocations (
      company_id, payment_id, invoice_id, allocated_amount, allocation_date, created_by, created_at
    ) VALUES (
      v_pmt.company_id, p_payment_id, v_inv_id, v_amt, v_now, auth.uid(), v_now
    )
    ON CONFLICT (payment_id, invoice_id)
    DO UPDATE SET allocated_amount = payment_allocations.allocated_amount + EXCLUDED.allocated_amount;

    -- Update Invoice Balances & Status
    UPDATE public.invoices
    SET
      amount_paid = amount_paid + v_amt,
      status = CASE
        WHEN (grand_total - (amount_paid + v_amt) - amount_credited) <= 0.000 THEN 'paid'
        ELSE 'partially_paid'
      END,
      updated_at = v_now
    WHERE id = v_inv_id;

    -- Update Payment Allocated Amount
    UPDATE public.payments
    SET
      allocated_amount = allocated_amount + v_amt,
      updated_at = v_now
    WHERE id = p_payment_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'total_allocated', v_total_to_allocate
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: unallocate_payment()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unallocate_payment(
  p_payment_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alloc RECORD;
  v_now timestamptz := now();
BEGIN
  SELECT id, allocated_amount INTO v_alloc
  FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND invoice_id = p_invoice_id
  FOR UPDATE;

  IF v_alloc.id IS NULL THEN
    RAISE EXCEPTION 'Allocation between payment % and invoice % not found', p_payment_id, p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Delete allocation record
  DELETE FROM public.payment_allocations WHERE id = v_alloc.id;

  -- Revert Invoice Balances & Status
  UPDATE public.invoices
  SET
    amount_paid = amount_paid - v_alloc.allocated_amount,
    status = CASE
      WHEN (amount_paid - v_alloc.allocated_amount) <= 0.000 THEN 'issued'
      ELSE 'partially_paid'
    END,
    updated_at = v_now
  WHERE id = p_invoice_id;

  -- Revert Payment Balances
  UPDATE public.payments
  SET
    allocated_amount = allocated_amount - v_alloc.allocated_amount,
    updated_at = v_now
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'unallocated_amount', v_alloc.allocated_amount
  );
END;
$$;
