-- =============================================================================
-- Migration 053: Sales Domain Enhancements & India GST Tax Architecture
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   1. Extension of invoice_status ('void') and payment_status ('void', 'reversed', 'refunded')
--   2. Lineage linking: quotation_line_id on invoice_lines
--   3. India GST tax engine (CGST, SGST, IGST, HSN/SAC, Place of Supply rules)
--   4. Atomic conversion: convert_quotation_to_invoice()
--   5. Voiding & Reversals: void_invoice() and reverse_payment()
--   6. Customer billing summary RPC: get_customer_billing_summary()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend Status ENUMs
-- ---------------------------------------------------------------------------
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'void';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'void';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'reversed';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'refunded';

-- ---------------------------------------------------------------------------
-- 2. Lineage Linking: quotation_line_id on invoice_lines
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'quotation_line_id'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD COLUMN quotation_line_id uuid REFERENCES public.quotation_lines(id) ON DELETE SET NULL;
    CREATE INDEX idx_invoice_lines_quote_line ON public.invoice_lines (quotation_line_id) WHERE quotation_line_id IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Tax System Extensions for India GST
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Extend tax_codes with GST categorization and HSN/SAC code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tax_codes' AND column_name = 'gst_type'
  ) THEN
    ALTER TABLE public.tax_codes
      ADD COLUMN gst_type text NOT NULL DEFAULT 'standard', -- 'standard', 'cgst_sgst', 'igst', 'exempt'
      ADD COLUMN hsn_sac_code text;
  END IF;

  -- Add GST breakdown columns to quotation_lines
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quotation_lines' AND column_name = 'cgst_rate'
  ) THEN
    ALTER TABLE public.quotation_lines
      ADD COLUMN cgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (cgst_rate >= 0),
      ADD COLUMN cgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (cgst_amount >= 0),
      ADD COLUMN sgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (sgst_rate >= 0),
      ADD COLUMN sgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (sgst_amount >= 0),
      ADD COLUMN igst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (igst_rate >= 0),
      ADD COLUMN igst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (igst_amount >= 0),
      ADD COLUMN hsn_sac_code text;
  END IF;

  -- Add GST breakdown columns to invoice_lines
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'cgst_rate'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD COLUMN cgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (cgst_rate >= 0),
      ADD COLUMN cgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (cgst_amount >= 0),
      ADD COLUMN sgst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (sgst_rate >= 0),
      ADD COLUMN sgst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (sgst_amount >= 0),
      ADD COLUMN igst_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (igst_rate >= 0),
      ADD COLUMN igst_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (igst_amount >= 0),
      ADD COLUMN hsn_sac_code text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Function: calculate_india_gst()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_india_gst(
  p_company_id uuid,
  p_amount numeric,
  p_supplier_state text,
  p_customer_state text,
  p_tax_code_id uuid DEFAULT NULL,
  p_is_exempt boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_amt numeric(14,3) := round(COALESCE(p_amount, 0), 3);
  v_tax_rate numeric(5,2);
  v_is_inclusive boolean := false;
  v_taxable numeric(14,3);
  v_total_tax numeric(14,3);
  v_cgst_rate numeric(5,2) := 0.00;
  v_cgst_amount numeric(14,3) := 0.000;
  v_sgst_rate numeric(5,2) := 0.00;
  v_sgst_amount numeric(14,3) := 0.000;
  v_igst_rate numeric(5,2) := 0.00;
  v_igst_amount numeric(14,3) := 0.000;
  v_is_intra_state boolean;
BEGIN
  IF p_is_exempt THEN
    RETURN jsonb_build_object(
      'taxable_amount', v_amt,
      'tax_rate', 0.00,
      'tax_amount', 0.000,
      'gross_amount', v_amt,
      'is_exempt', true,
      'cgst_rate', 0.00, 'cgst_amount', 0.000,
      'sgst_rate', 0.00, 'sgst_amount', 0.000,
      'igst_rate', 0.00, 'igst_amount', 0.000
    );
  END IF;

  IF p_tax_code_id IS NOT NULL THEN
    SELECT rate, is_inclusive INTO v_tax_rate, v_is_inclusive
    FROM public.tax_codes
    WHERE id = p_tax_code_id AND company_id = p_company_id;
  END IF;

  IF v_tax_rate IS NULL THEN
    SELECT tax_rate, tax_inclusive INTO v_tax_rate, v_is_inclusive
    FROM public.settings
    WHERE company_id = p_company_id;
  END IF;

  v_tax_rate := COALESCE(v_tax_rate, 18.00); -- Default 18% GST standard rate in India
  v_is_inclusive := COALESCE(v_is_inclusive, false);

  IF v_is_inclusive THEN
    v_taxable := round(v_amt / (1.00 + (v_tax_rate / 100.00)), 3);
    v_total_tax := round(v_amt - v_taxable, 3);
  ELSE
    v_taxable := v_amt;
    v_total_tax := round(v_amt * (v_tax_rate / 100.00), 3);
  END IF;

  -- Place of supply comparison: intra-state vs inter-state
  v_is_intra_state := (
    p_supplier_state IS NOT NULL AND
    p_customer_state IS NOT NULL AND
    lower(trim(p_supplier_state)) = lower(trim(p_customer_state))
  );

  IF v_is_intra_state THEN
    -- Intra-state: CGST + SGST (split equally)
    v_cgst_rate := round(v_tax_rate / 2.00, 2);
    v_sgst_rate := round(v_tax_rate / 2.00, 2);
    v_cgst_amount := round(v_total_tax / 2.00, 3);
    v_sgst_amount := round(v_total_tax - v_cgst_amount, 3); -- Exact balancing of halves
    v_igst_rate := 0.00;
    v_igst_amount := 0.000;
  ELSE
    -- Inter-state: IGST (full rate)
    v_igst_rate := v_tax_rate;
    v_igst_amount := v_total_tax;
    v_cgst_rate := 0.00;
    v_cgst_amount := 0.000;
    v_sgst_rate := 0.00;
    v_sgst_amount := 0.000;
  END IF;

  RETURN jsonb_build_object(
    'taxable_amount', v_taxable,
    'tax_rate', v_tax_rate,
    'tax_amount', v_total_tax,
    'gross_amount', round(v_taxable + v_total_tax, 3),
    'is_exempt', false,
    'is_intra_state', v_is_intra_state,
    'cgst_rate', v_cgst_rate,
    'cgst_amount', v_cgst_amount,
    'sgst_rate', v_sgst_rate,
    'sgst_amount', v_sgst_amount,
    'igst_rate', v_igst_rate,
    'igst_amount', v_igst_amount
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: convert_quotation_to_invoice()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_quotation_to_invoice(
  p_quotation_id uuid,
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
  v_quote RECORD;
  v_existing_inv RECORD;
  v_inv_id uuid;
  v_inv_number text;
  v_line RECORD;
  v_line_no integer := 1;
  v_due_date date;
  v_now timestamptz := now();
BEGIN
  -- 1. Fetch & lock quotation
  SELECT * INTO v_quote
  FROM public.quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_quote.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Quotation Status: must be 'accepted'
  IF v_quote.status <> 'accepted' THEN
    RAISE EXCEPTION 'Quotation % is in status "%". Only accepted quotations can be converted to an invoice.',
      v_quote.quotation_number, v_quote.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, invoice_number INTO v_inv_id, v_inv_number
    FROM public.invoices
    WHERE company_id = v_quote.company_id AND idempotency_key = p_idempotency_key;

    IF v_inv_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_inv_id,
        'invoice_number', v_inv_number,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- 4. Prevent duplicate conversion if active invoice already exists for this quotation
  SELECT id, invoice_number INTO v_existing_inv
  FROM public.invoices
  WHERE quotation_id = p_quotation_id
    AND status NOT IN ('cancelled', 'void')
  LIMIT 1;

  IF v_existing_inv.id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted to invoice %',
      v_quote.quotation_number, v_existing_inv.invoice_number
      USING ERRCODE = '22000';
  END IF;

  v_due_date := COALESCE(p_due_date, CURRENT_DATE + INTERVAL '30 days');

  -- 5. Pre-generate Invoice Number
  v_inv_number := public.generate_document_number(
    v_quote.company_id,
    'INV'::public.document_type,
    v_quote.branch_id
  );

  -- 6. Insert Draft Invoice Header
  INSERT INTO public.invoices (
    company_id, branch_id, customer_id, site_id, work_order_id,
    quotation_id, invoice_number, invoice_date, due_date, currency,
    subtotal, discount_amount, taxable_amount, tax_amount, grand_total,
    amount_paid, amount_credited, status, notes, terms_and_conditions,
    created_by, idempotency_key, created_at, updated_at
  ) VALUES (
    v_quote.company_id, v_quote.branch_id, v_quote.customer_id, v_quote.site_id, v_quote.work_order_id,
    v_quote.id, v_inv_number, CURRENT_DATE, v_due_date, v_quote.currency,
    v_quote.subtotal, v_quote.discount_amount, v_quote.taxable_amount, v_quote.tax_amount, v_quote.grand_total,
    0.000, 0.000, 'draft', COALESCE(p_notes, v_quote.notes), v_quote.terms_and_conditions,
    auth.uid(), p_idempotency_key, v_now, v_now
  )
  RETURNING id INTO v_inv_id;

  -- 7. Clone Quotation Lines into Invoice Lines
  FOR v_line IN
    SELECT * FROM public.quotation_lines
    WHERE quotation_id = p_quotation_id
    ORDER BY line_number ASC
  LOOP
    INSERT INTO public.invoice_lines (
      invoice_id, line_number, line_type, item_id, description,
      quantity, uom_id, unit_price, discount_amount, tax_code_id,
      tax_rate, taxable_amount, tax_amount, line_total,
      quotation_line_id, work_order_id, work_order_line_id,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, hsn_sac_code,
      created_at
    ) VALUES (
      v_inv_id, v_line_no, v_line.line_type, v_line.item_id, v_line.description,
      v_line.quantity, v_line.uom_id, v_line.unit_price, v_line.discount_amount, v_line.tax_code_id,
      v_line.tax_rate, v_line.taxable_amount, v_line.tax_amount, v_line.line_total,
      v_line.id, v_quote.work_order_id, v_line.work_order_line_id,
      v_line.cgst_rate, v_line.cgst_amount, v_line.sgst_rate, v_line.sgst_amount, v_line.igst_rate, v_line.igst_amount, v_line.hsn_sac_code,
      v_now
    );
    v_line_no := v_line_no + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'quotation_number', v_quote.quotation_number,
    'grand_total', v_quote.grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: void_invoice()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_invoice(
  p_invoice_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv RECORD;
BEGIN
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_inv.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  -- Only accountant, finance or owner_admin can void invoices
  IF NOT (public.has_role(v_inv.company_id, 'accountant') OR public.has_role(v_inv.company_id, 'owner_admin')) THEN
    RAISE EXCEPTION 'Unauthorized: Only accountants or administrators can void invoices' USING ERRCODE = '42501';
  END IF;

  -- Rejection check: Cannot void if payments have been collected
  IF v_inv.amount_paid > 0 THEN
    RAISE EXCEPTION 'Cannot void invoice %: Payments of % have already been recorded. Reverse payments first.',
      v_inv.invoice_number, v_inv.amount_paid
      USING ERRCODE = '22000';
  END IF;

  IF v_inv.status IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'Invoice % is already %', v_inv.invoice_number, v_inv.status
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.invoices
  SET status = 'void',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = p_reason,
      updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'invoice_number', v_inv.invoice_number,
    'status', 'void'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: reverse_payment()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payment(
  p_payment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment RECORD;
  v_alloc RECORD;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_payment.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  IF v_payment.status IN ('reversed', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'Payment % is already %', v_payment.payment_number, v_payment.status
      USING ERRCODE = '22000';
  END IF;

  -- Reverse allocations from each invoice
  FOR v_alloc IN
    SELECT * FROM public.payment_allocations
    WHERE payment_id = p_payment_id
    FOR UPDATE
  LOOP
    UPDATE public.invoices
    SET amount_paid = round(GREATEST(0, amount_paid - v_alloc.allocated_amount), 3),
        status = CASE
          WHEN (amount_paid - v_alloc.allocated_amount) <= 0 THEN 'issued'::public.invoice_status
          ELSE 'partially_paid'::public.invoice_status
        END,
        updated_at = now()
    WHERE id = v_alloc.invoice_id;
  END LOOP;

  -- Delete allocation rows
  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id;

  -- Mark payment as reversed
  UPDATE public.payments
  SET status = 'reversed',
      allocated_amount = 0.000,
      notes = concat(COALESCE(notes, ''), ' [REVERSED: ', p_reason, ' at ', now()::text, ']'),
      updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'payment_number', v_payment.payment_number,
    'status', 'reversed'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: get_customer_billing_summary()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_billing_summary(
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cust RECORD;
  v_total_invoiced numeric(14,3) := 0.000;
  v_total_paid numeric(14,3) := 0.000;
  v_total_credited numeric(14,3) := 0.000;
  v_outstanding_balance numeric(14,3) := 0.000;
  v_unallocated_deposits numeric(14,3) := 0.000;
  v_open_invoices integer := 0;
BEGIN
  SELECT id, company_id, name, code INTO v_cust
  FROM public.customers
  WHERE id = p_customer_id;

  IF v_cust.id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- Total invoiced, paid, credited, and outstanding
  SELECT
    COALESCE(sum(grand_total), 0.000),
    COALESCE(sum(amount_paid), 0.000),
    COALESCE(sum(amount_credited), 0.000),
    COALESCE(sum(CASE WHEN status IN ('issued', 'partially_paid', 'overdue') THEN amount_due ELSE 0.000 END), 0.000),
    COALESCE(count(*) FILTER (WHERE status IN ('issued', 'partially_paid', 'overdue')), 0)
  INTO
    v_total_invoiced, v_total_paid, v_total_credited, v_outstanding_balance, v_open_invoices
  FROM public.invoices
  WHERE customer_id = p_customer_id
    AND status NOT IN ('cancelled', 'void');

  -- Unallocated customer deposits / advance payments
  SELECT COALESCE(sum(unallocated_amount), 0.000)
  INTO v_unallocated_deposits
  FROM public.payments
  WHERE customer_id = p_customer_id
    AND status IN ('received', 'cleared');

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_name', v_cust.name,
    'customer_code', v_cust.code,
    'total_invoiced', v_total_invoiced,
    'total_paid', v_total_paid,
    'total_credited', v_total_credited,
    'outstanding_balance', v_outstanding_balance,
    'unallocated_deposits', v_unallocated_deposits,
    'net_receivable', round(v_outstanding_balance - v_unallocated_deposits, 3),
    'open_invoice_count', v_open_invoices
  );
END;
$$;
