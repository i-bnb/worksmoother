-- =============================================================================
-- Migration 021: Dispatch Board & Operational Reporting Views
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================
-- High-performance relational views for dispatchers and executives.
-- Uses security_invoker = true so queries automatically inherit caller RLS policies.

-- ---------------------------------------------------------------------------
-- 1. View: view_dispatch_board
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_dispatch_board
WITH (security_invoker = true)
AS
SELECT
  wo.company_id,
  wo.branch_id,
  wo.id AS work_order_id,
  wo.work_order_number,
  wo.priority,
  wo.status AS work_order_status,
  wo.scheduled_start,
  wo.scheduled_end,
  wo.due_at AS sla_due_at,
  CASE
    WHEN wo.due_at IS NOT NULL AND wo.due_at < now() AND wo.status NOT IN ('completed', 'closed', 'cancelled') THEN true
    ELSE false
  END AS is_sla_breached,
  c.id AS customer_id,
  c.name AS customer_name,
  cs.id AS site_id,
  cs.name AS site_name,
  cs.address AS site_address,
  cs.latitude,
  cs.longitude,
  ca.id AS asset_id,
  ca.name AS asset_name,
  st.name AS service_type_name,
  v.id AS current_visit_id,
  v.visit_number,
  v.status AS visit_status,
  v.check_in_at,
  lead_p.full_name AS lead_technician_name,
  lead_e.id AS lead_employee_id
FROM public.work_orders wo
JOIN public.customers c ON c.id = wo.customer_id
JOIN public.customer_sites cs ON cs.id = wo.site_id
LEFT JOIN public.customer_assets ca ON ca.id = wo.asset_id
LEFT JOIN public.service_types st ON st.id = wo.service_type_id
LEFT JOIN LATERAL (
  SELECT id, visit_number, status, check_in_at
  FROM public.visits
  WHERE work_order_id = wo.id
  ORDER BY visit_number DESC
  LIMIT 1
) v ON true
LEFT JOIN LATERAL (
  SELECT e.id, e.profile_id
  FROM public.work_order_assignments woa
  JOIN public.employees e ON e.id = woa.employee_id
  WHERE woa.work_order_id = wo.id AND woa.is_active = true AND woa.role_in_job = 'lead'
  LIMIT 1
) lead_e ON true
LEFT JOIN public.profiles lead_p ON lead_p.id = lead_e.profile_id;

COMMENT ON VIEW public.view_dispatch_board IS 'Live dispatch board view consolidating priority, SLA deadlines, GPS coordinates, and assigned crew.';

-- ---------------------------------------------------------------------------
-- 2. View: view_technician_workload
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_technician_workload
WITH (security_invoker = true)
AS
SELECT
  e.company_id,
  e.branch_id,
  e.id AS employee_id,
  e.employee_code,
  p.full_name AS technician_name,
  p.phone,
  COUNT(DISTINCT woa.work_order_id) FILTER (WHERE wo.status IN ('scheduled', 'dispatched', 'in_progress')) AS active_jobs_count,
  COUNT(DISTINCT woa.work_order_id) FILTER (WHERE wo.status = 'completed') AS completed_jobs_count,
  COUNT(DISTINCT woa.work_order_id) FILTER (WHERE wo.status IN ('new', 'approved', 'scheduled')) AS pending_jobs_count,
  COUNT(DISTINCT woa.work_order_id) AS total_assigned_jobs_count,
  MAX(vt.status_updated_at) AS last_status_update,
  (
    SELECT vt2.status
    FROM public.visit_technicians vt2
    JOIN public.visits v2 ON v2.id = vt2.visit_id
    WHERE vt2.employee_id = e.id AND v2.status = 'in_progress'
    ORDER BY vt2.status_updated_at DESC
    LIMIT 1
  ) AS current_visit_status
FROM public.employees e
JOIN public.profiles p ON p.id = e.profile_id
JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'technician' AND ur.is_active = true
LEFT JOIN public.work_order_assignments woa ON woa.employee_id = e.id AND woa.is_active = true
LEFT JOIN public.work_orders wo ON wo.id = woa.work_order_id
LEFT JOIN public.visit_technicians vt ON vt.employee_id = e.id
WHERE e.is_active = true
GROUP BY e.company_id, e.branch_id, e.id, e.employee_code, p.full_name, p.phone;

COMMENT ON VIEW public.view_technician_workload IS 'Realtime technician workload, active dispatch counts, and field presence.';

-- ---------------------------------------------------------------------------
-- 3. View: view_work_order_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_work_order_summary
WITH (security_invoker = true)
AS
SELECT
  company_id,
  branch_id,
  COUNT(*) AS total_work_orders,
  COUNT(*) FILTER (WHERE status = 'new') AS new_count,
  COUNT(*) FILTER (WHERE status = 'quoted') AS quoted_count,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled_count,
  COUNT(*) FILTER (WHERE status = 'dispatched') AS dispatched_count,
  COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
  COUNT(*) FILTER (WHERE status = 'on_hold') AS on_hold_count,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
  COUNT(*) FILTER (WHERE status = 'invoiced') AS invoiced_count,
  COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
  COUNT(*) FILTER (WHERE priority = 'critical') AS critical_priority_count,
  COUNT(*) FILTER (WHERE priority = 'high') AS high_priority_count
FROM public.work_orders
GROUP BY company_id, branch_id;

COMMENT ON VIEW public.view_work_order_summary IS 'Categorized aggregation of work order counts by lifecycle status and priority.';

-- ---------------------------------------------------------------------------
-- 4. View: view_sla_performance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_sla_performance
WITH (security_invoker = true)
AS
SELECT
  wo.company_id,
  wo.service_type_id,
  st.name AS service_type_name,
  COUNT(*) AS total_evaluated_orders,
  COUNT(*) FILTER (
    WHERE wo.status IN ('completed', 'invoiced', 'closed')
      AND (wo.due_at IS NULL OR wo.updated_at <= wo.due_at)
  ) AS completed_within_sla,
  COUNT(*) FILTER (
    WHERE wo.due_at IS NOT NULL AND (
      (wo.status IN ('completed', 'invoiced', 'closed') AND wo.updated_at > wo.due_at)
      OR (wo.status NOT IN ('completed', 'invoiced', 'closed', 'cancelled') AND now() > wo.due_at)
    )
  ) AS breached_sla,
  COUNT(*) FILTER (
    WHERE wo.status NOT IN ('completed', 'invoiced', 'closed', 'cancelled')
      AND wo.due_at IS NOT NULL
      AND wo.due_at >= now()
      AND wo.due_at <= now() + interval '2 hours'
  ) AS due_soon_count,
  ROUND(
    (
      COUNT(*) FILTER (WHERE wo.status IN ('completed', 'invoiced', 'closed') AND (wo.due_at IS NULL OR wo.updated_at <= wo.due_at)) * 100.0
      / NULLIF(COUNT(*) FILTER (WHERE wo.status IN ('completed', 'invoiced', 'closed')), 0)
    ),
    2
  ) AS sla_compliance_pct
FROM public.work_orders wo
LEFT JOIN public.service_types st ON st.id = wo.service_type_id
GROUP BY wo.company_id, wo.service_type_id, st.name;

COMMENT ON VIEW public.view_sla_performance IS 'SLA compliance metrics, breach totals, and imminent deadline alerts.';

-- ---------------------------------------------------------------------------
-- 5. View: view_first_time_fix_rate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_first_time_fix_rate
WITH (security_invoker = true)
AS
WITH wo_visit_counts AS (
  SELECT
    wo.company_id,
    wo.id AS work_order_id,
    COUNT(v.id) AS total_visits,
    BOOL_OR(COALESCE(v.is_first_time_fix, false)) AS flagged_ftf
  FROM public.work_orders wo
  JOIN public.visits v ON v.work_order_id = wo.id
  WHERE wo.status IN ('completed', 'invoiced', 'closed')
  GROUP BY wo.company_id, wo.id
)
SELECT
  company_id,
  COUNT(*) AS total_completed_jobs,
  COUNT(*) FILTER (WHERE total_visits = 1 OR flagged_ftf = true) AS first_time_fix_jobs,
  COUNT(*) FILTER (WHERE total_visits > 1 AND flagged_ftf = false) AS multi_visit_jobs,
  ROUND(
    (
      COUNT(*) FILTER (WHERE total_visits = 1 OR flagged_ftf = true) * 100.0
      / NULLIF(COUNT(*), 0)
    ),
    2
  ) AS first_time_fix_rate_pct
FROM wo_visit_counts
GROUP BY company_id;

COMMENT ON VIEW public.view_first_time_fix_rate IS 'Dynamic First-Time-Fix (FTF) KPI calculation based on single-visit job completion.';
