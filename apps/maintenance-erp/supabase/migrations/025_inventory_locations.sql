-- =============================================================================
-- Migration 025: Unified Inventory Locations (Warehouses & Mobile Vans)
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================
-- All physical stock locations share a unified schema:
--   - warehouse: Central hubs, branch stores, plant stockrooms
--   - technician_van: Mobile vehicle inventory assigned 1:1 to field engineers
--   - returns / quarantine: Defective or inspected parts
--   - scrap: Damaged/decommissioned parts awaiting disposal

-- ---------------------------------------------------------------------------
-- 1. Table: locations
-- ---------------------------------------------------------------------------
CREATE TABLE public.locations (
  id                    uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  code                  text                  NOT NULL,
  name                  text                  NOT NULL,
  location_type         public.location_type  NOT NULL DEFAULT 'warehouse',
  assigned_employee_id  uuid                  REFERENCES public.employees(id) ON DELETE SET NULL,
  address               text,
  is_active             boolean               NOT NULL DEFAULT true,
  created_at            timestamptz           NOT NULL DEFAULT now(),
  updated_at            timestamptz           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_locations_company_code ON public.locations (company_id, code);
CREATE UNIQUE INDEX uq_locations_assigned_van
  ON public.locations (company_id, assigned_employee_id)
  WHERE location_type = 'technician_van' AND is_active = true;

CREATE INDEX idx_locations_type_branch ON public.locations (company_id, location_type, branch_id);

CREATE TRIGGER set_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.locations IS 'Stock locations across central warehouses, branch depots, quarantine yards, and mobile technician vans.';

-- ---------------------------------------------------------------------------
-- 2. Helper Functions for Van Location Resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_technician_van_location_id(p_employee_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loc_id uuid;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.id INTO v_loc_id
  FROM public.locations l
  WHERE l.assigned_employee_id = p_employee_id
    AND l.location_type = 'technician_van'
    AND l.is_active = true
  LIMIT 1;

  RETURN v_loc_id;
END;
$$;

COMMENT ON FUNCTION public.get_technician_van_location_id(uuid)
IS 'Resolves the active inventory location UUID for a given technician mobile van.';

CREATE OR REPLACE FUNCTION public.get_current_technician_van_location_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.get_technician_van_location_id(public.get_current_employee_id());
END;
$$;

COMMENT ON FUNCTION public.get_current_technician_van_location_id()
IS 'Resolves the active van location UUID for the currently authenticated technician.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('locations');
