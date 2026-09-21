-- =============================================================================
-- Migration 032: Inventory & Purchasing Operational and Reporting Views
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- High-performance relational views for warehouse storekeepers, fleet dispatchers,
-- inventory managers, and field technicians.
-- Uses security_invoker = true so queries automatically inherit caller RLS policies.

-- ---------------------------------------------------------------------------
-- 1. View: view_current_stock
-- ---------------------------------------------------------------------------
-- Consolidates inventory levels, valuation, and reorder status across all locations.
CREATE OR REPLACE VIEW public.view_current_stock
WITH (security_invoker = true)
AS
SELECT
  sb.company_id,
  l.branch_id,
  sb.location_id,
  l.code AS location_code,
  l.name AS location_name,
  l.location_type,
  l.assigned_employee_id,
  sb.item_id,
  i.sku,
  i.name AS item_name,
  i.item_type,
  i.category_id,
  c.name AS category_name,
  i.uom_id,
  u.code AS uom_code,
  u.name AS uom_name,
  sb.quantity AS quantity_on_hand,
  sb.reserved_quantity,
  sb.available_quantity,
  sb.average_cost AS average_unit_cost,
  sb.stock_value AS total_valuation,
  i.reorder_level,
  i.reorder_quantity,
  CASE
    WHEN i.reorder_level > 0 AND sb.available_quantity <= i.reorder_level THEN true
    ELSE false
  END AS is_low_stock,
  i.track_serial,
  i.track_batch,
  sb.last_movement_at,
  sb.updated_at
FROM public.stock_balances sb
JOIN public.locations l ON l.id = sb.location_id
JOIN public.items i ON i.id = sb.item_id
JOIN public.uoms u ON u.id = i.uom_id
LEFT JOIN public.item_categories c ON c.id = i.category_id;

COMMENT ON VIEW public.view_current_stock IS 'Real-time stock on-hand, reservations, available quantities, and average costing per location.';

-- ---------------------------------------------------------------------------
-- 2. View: view_technician_van_stock
-- ---------------------------------------------------------------------------
-- Dedicated mobile inventory view for technicians and dispatch supervisors.
CREATE OR REPLACE VIEW public.view_technician_van_stock
WITH (security_invoker = true)
AS
SELECT
  sb.company_id,
  l.branch_id,
  e.id AS employee_id,
  e.employee_code,
  p.full_name AS technician_name,
  p.phone AS technician_phone,
  l.id AS location_id,
  l.code AS van_code,
  l.name AS van_name,
  sb.item_id,
  i.sku,
  i.name AS item_name,
  i.item_type,
  u.code AS uom_code,
  sb.quantity AS quantity_on_hand,
  sb.reserved_quantity,
  sb.available_quantity,
  sb.average_cost AS average_unit_cost,
  sb.stock_value AS total_valuation,
  i.track_serial,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sn.id,
          'serial_number', sn.serial_number,
          'status', sn.status,
          'batch_number', sn.batch_number
        )
      )
      FROM public.serial_numbers sn
      WHERE sn.item_id = sb.item_id
        AND sn.current_location_id = l.id
        AND sn.status = 'in_stock'
    ),
    '[]'::jsonb
  ) AS available_serials
FROM public.stock_balances sb
JOIN public.locations l ON l.id = sb.location_id AND l.location_type = 'technician_van'
JOIN public.employees e ON e.id = l.assigned_employee_id
JOIN public.profiles p ON p.id = e.profile_id
JOIN public.items i ON i.id = sb.item_id
JOIN public.uoms u ON u.id = i.uom_id;

COMMENT ON VIEW public.view_technician_van_stock IS 'Mobile van stock balances linked directly to assigned technicians with serialized parts listing.';

-- ---------------------------------------------------------------------------
-- 3. View: view_low_stock_alerts
-- ---------------------------------------------------------------------------
-- Proactive replenishment alerts checking reorder_rules and fallback item reorder levels.
CREATE OR REPLACE VIEW public.view_low_stock_alerts
WITH (security_invoker = true)
AS
WITH stock_thresholds AS (
  -- Location-specific reorder rules
  SELECT
    rr.company_id,
    l.branch_id,
    rr.location_id,
    l.name AS location_name,
    l.code AS location_code,
    rr.item_id,
    rr.min_level AS threshold_level,
    rr.reorder_quantity,
    rr.preferred_supplier_id
  FROM public.reorder_rules rr
  JOIN public.locations l ON l.id = rr.location_id
  WHERE rr.is_active = true

  UNION ALL

  -- Fallback to item default reorder levels for warehouse locations
  SELECT
    i.company_id,
    l.branch_id,
    l.id AS location_id,
    l.name AS location_name,
    l.code AS location_code,
    i.id AS item_id,
    i.reorder_level AS threshold_level,
    i.reorder_quantity,
    NULL::uuid AS preferred_supplier_id
  FROM public.items i
  CROSS JOIN public.locations l
  WHERE i.reorder_level > 0
    AND l.is_active = true
    AND l.location_type = 'warehouse'
    AND NOT EXISTS (
      SELECT 1 FROM public.reorder_rules rr
      WHERE rr.company_id = i.company_id
        AND rr.item_id = i.id
        AND rr.location_id = l.id
    )
)
SELECT
  st.company_id,
  st.branch_id,
  st.location_id,
  st.location_name,
  st.location_code,
  st.item_id,
  i.sku,
  i.name AS item_name,
  u.code AS uom_code,
  COALESCE(sb.quantity, 0.0000) AS quantity_on_hand,
  COALESCE(sb.available_quantity, 0.0000) AS quantity_available,
  st.threshold_level,
  st.reorder_quantity,
  (st.threshold_level - COALESCE(sb.available_quantity, 0.0000)) AS deficit_quantity,
  st.preferred_supplier_id,
  s.name AS preferred_supplier_name,
  s.email AS preferred_supplier_email,
  s.phone AS preferred_supplier_phone
FROM stock_thresholds st
JOIN public.items i ON i.id = st.item_id
JOIN public.uoms u ON u.id = i.uom_id
LEFT JOIN public.stock_balances sb
  ON sb.company_id = st.company_id
 AND sb.item_id = st.item_id
 AND sb.location_id = st.location_id
LEFT JOIN public.suppliers s ON s.id = st.preferred_supplier_id
WHERE COALESCE(sb.available_quantity, 0.0000) <= st.threshold_level
  AND st.threshold_level > 0;

COMMENT ON VIEW public.view_low_stock_alerts IS 'Active inventory replenishment alerts indicating items that have fallen below safety thresholds.';

-- ---------------------------------------------------------------------------
-- 4. View: view_stock_movement_ledger
-- ---------------------------------------------------------------------------
-- Human-readable chronological audit ledger across all stock transactions.
CREATE OR REPLACE VIEW public.view_stock_movement_ledger
WITH (security_invoker = true)
AS
SELECT
  sl.id AS ledger_id,
  sl.company_id,
  sl.branch_id,
  sl.created_at,
  sl.movement_type,
  sl.movement_direction,
  sl.item_id,
  i.sku,
  i.name AS item_name,
  u.code AS uom_code,
  sl.location_id,
  l.name AS location_name,
  l.code AS location_code,
  l.location_type,
  sl.quantity,
  sl.unit_cost,
  sl.total_cost,
  sl.reference_type,
  sl.reference_id,
  CASE
    WHEN sl.reference_type = 'goods_receipt' THEN gr.receipt_number
    WHEN sl.reference_type = 'stock_transfer' THEN trn.transfer_number
    WHEN sl.reference_type = 'work_order' THEN wo.work_order_number
    WHEN sl.reference_type = 'stocktake' THEN stk.stocktake_number
    ELSE sl.reference_type
  END AS reference_number,
  sl.serial_number,
  sl.batch_number,
  sl.notes,
  sl.created_by,
  p.full_name AS performed_by_name
FROM public.stock_ledger sl
JOIN public.items i ON i.id = sl.item_id
JOIN public.uoms u ON u.id = i.uom_id
JOIN public.locations l ON l.id = sl.location_id
LEFT JOIN public.profiles p ON p.id = sl.created_by
LEFT JOIN public.goods_receipts gr ON sl.reference_type = 'goods_receipt' AND gr.id = sl.reference_id
LEFT JOIN public.stock_transfers trn ON sl.reference_type = 'stock_transfer' AND trn.id = sl.reference_id
LEFT JOIN public.work_orders wo ON sl.reference_type = 'work_order' AND wo.id = sl.reference_id
LEFT JOIN public.stocktakes stk ON sl.reference_type = 'stocktake' AND stk.id = sl.reference_id;

COMMENT ON VIEW public.view_stock_movement_ledger IS 'Audit trail of every physical stock addition, reduction, and transfer with document references.';

-- ---------------------------------------------------------------------------
-- 5. View: view_serial_lifecycle
-- ---------------------------------------------------------------------------
-- End-to-end component traceability: PO -> Warehouse -> Van -> Customer Asset -> Work Order.
CREATE OR REPLACE VIEW public.view_serial_lifecycle
WITH (security_invoker = true)
AS
SELECT
  sn.id AS serial_id,
  sn.company_id,
  sn.item_id,
  i.sku,
  i.name AS item_name,
  sn.serial_number,
  sn.batch_number,
  sn.status,
  sn.current_location_id,
  l.code AS current_location_code,
  l.name AS current_location_name,
  l.location_type AS current_location_type,
  e.id AS assigned_technician_id,
  p.full_name AS assigned_technician_name,
  sn.installed_customer_asset_id,
  ca.asset_code AS installed_asset_code,
  ca.name AS installed_asset_name,
  c.id AS customer_id,
  c.name AS customer_name,
  sn.installed_work_order_id,
  wo.work_order_number AS installed_work_order_number,
  sn.created_at,
  sn.updated_at
FROM public.serial_numbers sn
JOIN public.items i ON i.id = sn.item_id
LEFT JOIN public.locations l ON l.id = sn.current_location_id
LEFT JOIN public.employees e ON e.id = l.assigned_employee_id
LEFT JOIN public.profiles p ON p.id = e.profile_id
LEFT JOIN public.customer_assets ca ON ca.id = sn.installed_customer_asset_id
LEFT JOIN public.customers c ON c.id = ca.customer_id
LEFT JOIN public.work_orders wo ON wo.id = sn.installed_work_order_id;

COMMENT ON VIEW public.view_serial_lifecycle IS 'Comprehensive tracking of individual high-value serialized equipment parts and customer asset installations.';

-- ---------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.view_current_stock TO authenticated;
GRANT SELECT ON public.view_technician_van_stock TO authenticated;
GRANT SELECT ON public.view_low_stock_alerts TO authenticated;
GRANT SELECT ON public.view_stock_movement_ledger TO authenticated;
GRANT SELECT ON public.view_serial_lifecycle TO authenticated;
