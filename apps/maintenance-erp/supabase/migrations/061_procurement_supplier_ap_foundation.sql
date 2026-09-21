-- =============================================================================
-- Migration 061: Supplier Management, Procurement, Vendor Portal & Accounts Payable
-- Maintenance Management ERP — Phase 10 Foundation
-- =============================================================================
-- Features:
--   1. Supplier Master extensions (legal_name, supplier_type, pan, status, credit_limit, category)
--   2. Multi-contact and multi-address management (supplier_contacts, supplier_addresses)
--   3. Supplier status audit trail (supplier_status_history)
--   4. Supplier product & service catalog mappings (supplier_products)
--   5. Traceable Purchase Requests (WO, AMC, Rental links) & Multi-level Approvals (purchase_request_items, purchase_request_approvals)
--   6. Supplier Quotations & Multi-Vendor Comparison (supplier_quotations, supplier_quotation_items)
--   7. Purchase Order revisions & configurable approval rules (purchase_order_revisions, procurement_approval_rules)
--   8. Goods Receipt inspection breakdown (accepted, rejected, damaged) & Serialized Asset generation
--   9. Supplier Invoices & 3-Way Matching Engine (match_supplier_bill_3way)
--  10. Accounts Payable Disbursements, Advances & Reversals (supplier_payments extensions)
--  11. Supplier Document Management (supplier_documents)
--  12. Supplier Portal Access Layer (supplier_portal_users)
--  13. AP Aging Analysis & Procurement Spend Procedures
--  14. Row-Level Security (RLS) & Automated Audit Triggers

-- ---------------------------------------------------------------------------
-- 1. Extend public.suppliers
-- ---------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS supplier_type text DEFAULT 'PARTS_SUPPLIER',
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS payment_address text,
  ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'GENERAL';

DO $$
BEGIN
  -- Add check constraint for supplier_type if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_type'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT chk_suppliers_type
      CHECK (supplier_type IN ('PARTS_SUPPLIER', 'EQUIPMENT_SUPPLIER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'GENERAL_SUPPLIER'));
  END IF;

  -- Add check constraint for supplier status if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_status'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT chk_suppliers_status
      CHECK (status IN ('PROSPECT', 'ACTIVE', 'ON_HOLD', 'SUSPENDED', 'INACTIVE', 'BLACKLISTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppliers_company_status ON public.suppliers (company_id, status);
CREATE INDEX IF NOT EXISTS idx_suppliers_category ON public.suppliers (company_id, category);

-- ---------------------------------------------------------------------------
-- 2. Table: supplier_contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id   uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name          text          NOT NULL,
  designation   text,
  email         text,
  phone         text,
  department    text,
  is_primary    boolean       NOT NULL DEFAULT false,
  is_active     boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON public.supplier_contacts (supplier_id, is_active);
CREATE TRIGGER set_supplier_contacts_updated_at
  BEFORE UPDATE ON public.supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.supplier_contacts IS 'Contact personnel and department representatives for commercial suppliers.';

-- ---------------------------------------------------------------------------
-- 3. Table: supplier_addresses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_addresses (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id   uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  address_type  text          NOT NULL DEFAULT 'billing'
                              CHECK (address_type IN ('registered', 'billing', 'shipping', 'warehouse')),
  address_line1 text          NOT NULL,
  address_line2 text,
  city          text,
  state         text,
  country       text          NOT NULL DEFAULT 'AE',
  postal_code   text,
  is_primary    boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_addresses_supplier ON public.supplier_addresses (supplier_id);

-- ---------------------------------------------------------------------------
-- 4. Table: supplier_status_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_status_history (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id     uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  previous_status text          NOT NULL,
  new_status      text          NOT NULL,
  change_reason   text,
  changed_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_status_history_sup ON public.supplier_status_history (supplier_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Table: supplier_products (Catalog & Preferred Vendor Mappings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_products (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id             uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  item_id                 uuid          NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  supplier_sku            text,
  supplier_description    text,
  unit                    text          DEFAULT 'pcs',
  last_purchase_price     numeric(14,3),
  standard_purchase_price numeric(14,3),
  min_order_quantity      numeric(12,4) DEFAULT 1.0000,
  lead_time_days          integer       DEFAULT 7,
  is_preferred            boolean       NOT NULL DEFAULT false,
  is_active               boolean       NOT NULL DEFAULT true,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_supplier_products UNIQUE (company_id, supplier_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_item ON public.supplier_products (item_id, is_preferred);
CREATE TRIGGER set_supplier_products_updated_at
  BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 6. Extend purchase_requests & add purchase_request_items
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amc_contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rental_contract_id uuid REFERENCES public.rental_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS estimated_total numeric(14,3) NOT NULL DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_requests_priority'
  ) THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT chk_purchase_requests_priority
      CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_wo ON public.purchase_requests (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_amc ON public.purchase_requests (amc_contract_id) WHERE amc_contract_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid          NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  item_id               uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description           text          NOT NULL,
  quantity              numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit                  text          DEFAULT 'pcs',
  estimated_unit_price  numeric(14,3) DEFAULT 0.000 CHECK (estimated_unit_price >= 0),
  estimated_total       numeric(14,3) GENERATED ALWAYS AS (quantity * estimated_unit_price) STORED,
  required_date         date,
  notes                 text,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_request_items_req ON public.purchase_request_items (request_id);

CREATE TABLE IF NOT EXISTS public.purchase_request_approvals (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid          NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  approver_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approval_level  integer       NOT NULL DEFAULT 1,
  decision        text          NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment         text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_approvals_req ON public.purchase_request_approvals (request_id);

-- ---------------------------------------------------------------------------
-- 7. Table: supplier_quotations & supplier_quotation_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_quotations (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id             uuid          REFERENCES public.branches(id) ON DELETE SET NULL,
  supplier_id           uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_request_id   uuid          REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  quote_number          text          NOT NULL,
  quote_date            date          NOT NULL DEFAULT CURRENT_DATE,
  valid_until           date          NOT NULL,
  currency              text          NOT NULL DEFAULT 'AED',
  subtotal              numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  discount_amount       numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (discount_amount >= 0),
  tax_amount            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  freight_charges       numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (freight_charges >= 0),
  other_charges         numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (other_charges >= 0),
  grand_total           numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  lead_time_days        integer       DEFAULT 7,
  warranty_terms        text,
  payment_terms         text,
  terms_and_conditions  text,
  status                text          NOT NULL DEFAULT 'received'
                                      CHECK (status IN ('received', 'under_evaluation', 'accepted', 'rejected', 'expired')),
  attachments           jsonb         NOT NULL DEFAULT '[]'::jsonb,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_supplier_quotes UNIQUE (company_id, supplier_id, quote_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_pr ON public.supplier_quotations (purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_sup ON public.supplier_quotations (supplier_id, status);

CREATE TRIGGER set_supplier_quotations_updated_at
  BEFORE UPDATE ON public.supplier_quotations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.supplier_quotation_items (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      uuid          NOT NULL REFERENCES public.supplier_quotations(id) ON DELETE CASCADE,
  item_id           uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description       text          NOT NULL,
  quantity          numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit              text          DEFAULT 'pcs',
  unit_price        numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  tax_rate          numeric(5,2)  NOT NULL DEFAULT 5.00,
  tax_amount        numeric(14,3) NOT NULL DEFAULT 0.000,
  discount_amount   numeric(14,3) NOT NULL DEFAULT 0.000,
  line_total        numeric(14,3) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_quote_items ON public.supplier_quotation_items (quotation_id);

-- ---------------------------------------------------------------------------
-- 8. Extend purchase_orders & add purchase_order_revisions
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS purchase_request_id uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_quotation_id uuid REFERENCES public.supplier_quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freight_charges numeric(14,3) NOT NULL DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS other_charges numeric(14,3) NOT NULL DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,3) NOT NULL DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS acknowledgement_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledgement_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_ack_status'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT chk_po_ack_status
      CHECK (acknowledgement_status IN ('pending', 'acknowledged', 'partially_accepted', 'rejected'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.purchase_order_revisions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  po_id           uuid          NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  revision_number integer       NOT NULL,
  changed_fields  jsonb         NOT NULL,
  snapshot        jsonb         NOT NULL,
  changed_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  change_reason   text          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_po_revisions UNIQUE (po_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_po_revisions_po ON public.purchase_order_revisions (po_id);

CREATE TABLE IF NOT EXISTS public.procurement_approval_rules (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_name       text          NOT NULL,
  min_amount      numeric(14,3) NOT NULL DEFAULT 0.000,
  max_amount      numeric(14,3),
  department_id   uuid          REFERENCES public.departments(id) ON DELETE SET NULL,
  category        text,
  required_role   text          NOT NULL DEFAULT 'operations_manager',
  approval_level  integer       NOT NULL DEFAULT 1,
  is_active       boolean       NOT NULL DEFAULT true,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_procurement_rules_company ON public.procurement_approval_rules (company_id, is_active);

-- ---------------------------------------------------------------------------
-- 9. Extend goods_receipt_lines with Quality Inspection & Asset Sync
-- ---------------------------------------------------------------------------
ALTER TABLE public.goods_receipt_lines
  ADD COLUMN IF NOT EXISTS accepted_quantity numeric(12,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric(12,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS damaged_quantity numeric(12,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS inspection_status text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS manufacturing_date date,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS warranty_end_date date,
  ADD COLUMN IF NOT EXISTS created_asset_id uuid REFERENCES public.customer_assets(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_grn_line_inspection'
  ) THEN
    ALTER TABLE public.goods_receipt_lines
      ADD CONSTRAINT chk_grn_line_inspection
      CHECK (inspection_status IN ('accepted', 'rejected', 'damaged', 'pending_inspection'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Extend supplier_bills with 3-Way Matching
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS matching_status text NOT NULL DEFAULT 'unmatched',
  ADD COLUMN IF NOT EXISTS matching_variance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_bills_matching'
  ) THEN
    ALTER TABLE public.supplier_bills
      ADD CONSTRAINT chk_supplier_bills_matching
      CHECK (matching_status IN ('unmatched', 'matched', 'partially_matched', 'price_variance', 'quantity_variance', 'tax_variance', 'missing_receipt', 'missing_po', 'exception'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_bills_matching ON public.supplier_bills (company_id, matching_status);

-- ---------------------------------------------------------------------------
-- 11. Extend supplier_payments with Advances and Reversals
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS advance_id uuid REFERENCES public.supplier_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_payments_type'
  ) THEN
    ALTER TABLE public.supplier_payments
      ADD CONSTRAINT chk_supplier_payments_type
      CHECK (payment_type IN ('standard', 'advance', 'refund', 'reversal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_type ON public.supplier_payments (supplier_id, payment_type);

-- ---------------------------------------------------------------------------
-- 12. Table: supplier_documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_documents (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id       uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  document_type     text          NOT NULL
                                  CHECK (document_type IN ('tax_certificate', 'trade_license', 'agreement', 'quotation', 'invoice', 'delivery_note', 'other')),
  document_name     text          NOT NULL,
  file_url          text          NOT NULL,
  file_size_bytes   bigint,
  expiry_date       date,
  uploaded_by       uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_docs ON public.supplier_documents (supplier_id, document_type);

-- ---------------------------------------------------------------------------
-- 13. Table: supplier_portal_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_portal_users (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id             uuid          NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  contact_id              uuid          REFERENCES public.supplier_contacts(id) ON DELETE SET NULL,
  user_id                 uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portal_role             text          NOT NULL DEFAULT 'SUPPLIER_VIEWER'
                                        CHECK (portal_role IN ('SUPPLIER_ADMIN', 'SUPPLIER_SALES', 'SUPPLIER_ACCOUNTS', 'SUPPLIER_VIEWER')),
  is_active               boolean       NOT NULL DEFAULT true,
  invitation_token        text,
  invitation_accepted_at  timestamptz,
  last_login_at           timestamptz,
  created_at              timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_supplier_portal_users UNIQUE (supplier_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_portal_user ON public.supplier_portal_users (user_id, is_active);

-- ---------------------------------------------------------------------------
-- 14. Transactional RPC: match_supplier_bill_3way()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_supplier_bill_3way(
  p_bill_id uuid,
  p_price_tolerance_pct numeric DEFAULT 1.0,
  p_qty_tolerance_pct numeric DEFAULT 2.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill RECORD;
  v_po RECORD;
  v_grn RECORD;
  v_bill_line RECORD;
  v_po_line RECORD;
  v_grn_qty numeric(12,4);
  v_variances jsonb := '[]'::jsonb;
  v_has_price_var boolean := false;
  v_has_qty_var boolean := false;
  v_status text := 'matched';
  v_now timestamptz := now();
BEGIN
  -- 1. Fetch bill
  SELECT * INTO v_bill
  FROM public.supplier_bills
  WHERE id = p_bill_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier bill not found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Check for PO
  IF v_bill.po_id IS NULL THEN
    UPDATE public.supplier_bills
    SET matching_status = 'missing_po', matched_at = v_now, matched_by = auth.uid()
    WHERE id = p_bill_id;

    RETURN jsonb_build_object('matching_status', 'missing_po', 'message', 'Bill has no Purchase Order linked');
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_bill.po_id;

  -- 3. Check for GRN
  IF v_bill.goods_receipt_id IS NULL THEN
    -- Check if any GRN exists for this PO
    SELECT * INTO v_grn
    FROM public.goods_receipts
    WHERE po_id = v_bill.po_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_grn.id IS NULL THEN
      UPDATE public.supplier_bills
      SET matching_status = 'missing_receipt', matched_at = v_now, matched_by = auth.uid()
      WHERE id = p_bill_id;

      RETURN jsonb_build_object('matching_status', 'missing_receipt', 'message', 'No Goods Receipt found for Purchase Order');
    END IF;
  ELSE
    SELECT * INTO v_grn FROM public.goods_receipts WHERE id = v_bill.goods_receipt_id;
  END IF;

  -- 4. Compare Lines: Bill Lines vs PO Lines vs GRN Lines
  FOR v_bill_line IN
    SELECT * FROM public.supplier_bill_lines WHERE bill_id = p_bill_id
  LOOP
    -- Look up PO line
    SELECT * INTO v_po_line
    FROM public.purchase_order_lines
    WHERE po_id = v_bill.po_id AND (item_id = v_bill_line.item_id OR v_bill_line.item_id IS NULL)
    LIMIT 1;

    IF v_po_line.id IS NULL THEN
      v_variances := v_variances || jsonb_build_object(
        'bill_line_id', v_bill_line.id,
        'issue', 'Item not in Purchase Order',
        'item_id', v_bill_line.item_id
      );
      v_status := 'exception';
      CONTINUE;
    END IF;

    -- Look up accepted quantity from GRN lines
    SELECT COALESCE(SUM(accepted_quantity), 0) INTO v_grn_qty
    FROM public.goods_receipt_lines
    WHERE po_line_id = v_po_line.id;

    -- Check Quantity Variance
    IF v_grn_qty > 0 THEN
      DECLARE
        v_diff_qty numeric := abs(v_bill_line.quantity - v_grn_qty);
        v_diff_pct numeric := (v_diff_qty / v_grn_qty) * 100.0;
      BEGIN
        IF v_diff_pct > p_qty_tolerance_pct THEN
          v_has_qty_var := true;
          v_variances := v_variances || jsonb_build_object(
            'bill_line_id', v_bill_line.id,
            'issue', 'Quantity variance',
            'billed_qty', v_bill_line.quantity,
            'received_qty', v_grn_qty,
            'diff_pct', round(v_diff_pct, 2)
          );
        END IF;
      END;
    END IF;

    -- Check Price Variance
    IF v_po_line.unit_price > 0 THEN
      DECLARE
        v_diff_price numeric := abs(v_bill_line.unit_price - v_po_line.unit_price);
        v_diff_price_pct numeric := (v_diff_price / v_po_line.unit_price) * 100.0;
      BEGIN
        IF v_diff_price_pct > p_price_tolerance_pct THEN
          v_has_price_var := true;
          v_variances := v_variances || jsonb_build_object(
            'bill_line_id', v_bill_line.id,
            'issue', 'Price variance',
            'billed_unit_price', v_bill_line.unit_price,
            'po_unit_price', v_po_line.unit_price,
            'diff_pct', round(v_diff_price_pct, 2)
          );
        END IF;
      END;
    END IF;
  END LOOP;

  -- Determine final matching status
  IF v_status = 'exception' THEN
    NULL;
  ELSIF v_has_price_var AND v_has_qty_var THEN
    v_status := 'exception';
  ELSIF v_has_price_var THEN
    v_status := 'price_variance';
  ELSIF v_has_qty_var THEN
    v_status := 'quantity_variance';
  ELSE
    v_status := 'matched';
  END IF;

  UPDATE public.supplier_bills
  SET matching_status = v_status,
      matching_variance = v_variances,
      matched_at = v_now,
      matched_by = auth.uid(),
      goods_receipt_id = v_grn.id
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'bill_id', p_bill_id,
    'matching_status', v_status,
    'variances_count', jsonb_array_length(v_variances),
    'variances', v_variances
  );
END;
$$;

COMMENT ON FUNCTION public.match_supplier_bill_3way IS '3-Way matching engine comparing PO, Goods Receipt, and Supplier Bill.';

-- ---------------------------------------------------------------------------
-- 15. Transactional RPC: get_supplier_aging()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_aging(
  p_company_id uuid,
  p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  supplier_code text,
  currency text,
  current_amount numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_90_plus numeric,
  total_outstanding numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id AS supplier_id,
    s.name AS supplier_name,
    s.code AS supplier_code,
    b.currency,
    COALESCE(SUM(CASE WHEN b.due_date >= p_as_of_date THEN b.amount_due ELSE 0 END), 0) AS current_amount,
    COALESCE(SUM(CASE WHEN b.due_date < p_as_of_date AND b.due_date >= p_as_of_date - 30 THEN b.amount_due ELSE 0 END), 0) AS days_1_30,
    COALESCE(SUM(CASE WHEN b.due_date < p_as_of_date - 30 AND b.due_date >= p_as_of_date - 60 THEN b.amount_due ELSE 0 END), 0) AS days_31_60,
    COALESCE(SUM(CASE WHEN b.due_date < p_as_of_date - 60 AND b.due_date >= p_as_of_date - 90 THEN b.amount_due ELSE 0 END), 0) AS days_61_90,
    COALESCE(SUM(CASE WHEN b.due_date < p_as_of_date - 90 THEN b.amount_due ELSE 0 END), 0) AS days_90_plus,
    COALESCE(SUM(b.amount_due), 0) AS total_outstanding
  FROM public.suppliers s
  JOIN public.supplier_bills b ON b.supplier_id = s.id
  WHERE s.company_id = p_company_id
    AND b.status IN ('approved', 'posted', 'partially_paid')
    AND b.amount_due > 0
  GROUP BY s.id, s.name, s.code, b.currency
  ORDER BY total_outstanding DESC;
END;
$$;

COMMENT ON FUNCTION public.get_supplier_aging IS 'Calculates Accounts Payable aging buckets (Current, 1-30, 31-60, 61-90, 90+ days).';

-- ---------------------------------------------------------------------------
-- 16. Attach Audit Triggers & Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_users ENABLE ROW LEVEL SECURITY;

-- Standard tenant isolation policies
CREATE POLICY supplier_contacts_isolation ON public.supplier_contacts
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY supplier_addresses_isolation ON public.supplier_addresses
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY supplier_products_isolation ON public.supplier_products
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY supplier_quotes_isolation ON public.supplier_quotations
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY supplier_docs_isolation ON public.supplier_documents
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

CREATE POLICY procurement_rules_isolation ON public.procurement_approval_rules
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- Attach audit triggers
SELECT public.attach_audit_trigger('supplier_contacts');
SELECT public.attach_audit_trigger('supplier_products');
SELECT public.attach_audit_trigger('supplier_quotations');
SELECT public.attach_audit_trigger('purchase_order_revisions');
SELECT public.attach_audit_trigger('supplier_documents');
