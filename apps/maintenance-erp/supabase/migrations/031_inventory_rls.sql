-- =============================================================================
-- Migration 031: Inventory & Purchasing Row Level Security (RLS) Policies
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- Security Model:
--   - Owner / Operations Manager: Unrestricted management within company
--   - Storekeeper: Full warehouse and purchasing fulfillment scope
--   - Technician: Permitted van stock view & job material issue permissions
--   - Accountant: Read-only inventory valuation, POs, and goods receipts
--   - Customer: Completely blocked from all internal inventory and procurement tables

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on all Phase 2A tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uoms FORCE ROW LEVEL SECURITY;

ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_ledger FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances FORCE ROW LEVEL SECURITY;

ALTER TABLE public.serial_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.serial_numbers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reorder_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktakes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stocktake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktake_lines FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. UOMs, Categories & Items
-- ---------------------------------------------------------------------------
CREATE POLICY uoms_select ON public.uoms
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY uoms_manage ON public.uoms
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY item_categories_select ON public.item_categories
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE POLICY item_categories_manage ON public.item_categories
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY items_select ON public.items
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY items_manage ON public.items
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 3. Locations
-- ---------------------------------------------------------------------------
CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
    AND (
      -- Technicians see warehouses and their own van
      NOT public.has_role('technician'::public.user_role)
      OR location_type <> 'technician_van'
      OR assigned_employee_id = public.get_current_employee_id()
    )
  );

CREATE POLICY locations_manage ON public.locations
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );

-- ---------------------------------------------------------------------------
-- 4. Stock Balances & Stock Ledger
-- ---------------------------------------------------------------------------
-- Technicians can see inventory in their van or general warehouses; customers denied
CREATE POLICY stock_balances_select ON public.stock_balances
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
    AND (
      public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role, 'accountant'::public.user_role, 'supervisor'::public.user_role])
      OR location_id = public.get_current_technician_van_location_id()
      OR (SELECT location_type FROM public.locations WHERE id = location_id) = 'warehouse'
    )
  );

-- Ledger is strictly read-only for authenticated staff; mutations happen exclusively via RPC
CREATE POLICY stock_ledger_select ON public.stock_ledger
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

-- ---------------------------------------------------------------------------
-- 5. Serial Numbers & Transfers
-- ---------------------------------------------------------------------------
CREATE POLICY serial_numbers_select ON public.serial_numbers
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY stock_transfers_select ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY stock_transfers_manage ON public.stock_transfers
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role, 'supervisor'::public.user_role])
  );

CREATE POLICY stock_transfer_lines_select ON public.stock_transfer_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND t.company_id = public.get_current_company_id())
  );

-- ---------------------------------------------------------------------------
-- 6. Purchasing (Suppliers, Requests, Orders, Goods Receipts)
-- ---------------------------------------------------------------------------
CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND NOT public.has_role('customer'::public.user_role)
  );

CREATE POLICY suppliers_manage ON public.suppliers
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY purchase_requests_select ON public.purchase_requests
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND NOT public.has_role('customer'::public.user_role));

CREATE POLICY purchase_requests_manage ON public.purchase_requests
  FOR ALL TO authenticated
  USING (company_id = public.get_current_company_id() AND NOT public.has_role('customer'::public.user_role));

CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role, 'accountant'::public.user_role])
  );

CREATE POLICY purchase_orders_manage ON public.purchase_orders
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY purchase_order_lines_select ON public.purchase_order_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = po_id AND po.company_id = public.get_current_company_id())
  );

CREATE POLICY goods_receipts_select ON public.goods_receipts
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role, 'accountant'::public.user_role])
  );

CREATE POLICY goods_receipt_lines_select ON public.goods_receipt_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.company_id = public.get_current_company_id())
  );

-- ---------------------------------------------------------------------------
-- 7. Reorder Rules & Stocktakes
-- ---------------------------------------------------------------------------
CREATE POLICY reorder_rules_select ON public.reorder_rules
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND NOT public.has_role('customer'::public.user_role));

CREATE POLICY reorder_rules_manage ON public.reorder_rules
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY stocktakes_select ON public.stocktakes
  FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND NOT public.has_role('customer'::public.user_role));

CREATE POLICY stocktakes_manage ON public.stocktakes
  FOR ALL TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role, 'storekeeper'::public.user_role])
  );

CREATE POLICY stocktake_lines_select ON public.stocktake_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stocktakes st WHERE st.id = stocktake_id AND st.company_id = public.get_current_company_id())
  );
