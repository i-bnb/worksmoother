-- =============================================================================
-- Migration 013: Core Operations Custom Types & Enums
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================

-- Customer categorization
CREATE TYPE public.customer_type AS ENUM (
  'commercial',
  'residential',
  'industrial',
  'government'
);

-- Equipment lifecycle status
CREATE TYPE public.asset_status AS ENUM (
  'active',
  'under_maintenance',
  'replaced',
  'removed'
);

-- Service Request lifecycle status
CREATE TYPE public.service_request_status AS ENUM (
  'new',
  'triaged',
  'converted',
  'cancelled',
  'closed'
);

-- Service Request intake channel
CREATE TYPE public.service_request_source AS ENUM (
  'phone',
  'whatsapp',
  'customer_portal',
  'email',
  'internal'
);

-- Work Order lifecycle status machine
CREATE TYPE public.work_order_status AS ENUM (
  'new',
  'quoted',
  'approved',
  'scheduled',
  'dispatched',
  'in_progress',
  'on_hold',
  'completed',
  'invoiced',
  'closed',
  'cancelled'
);

-- Priority levels for requests and work orders
CREATE TYPE public.work_order_priority AS ENUM (
  'critical',
  'high',
  'medium',
  'low'
);

-- Originating source for work orders
CREATE TYPE public.work_order_source AS ENUM (
  'service_request',
  'amc',
  'preventive',
  'internal'
);

-- Visit trip lifecycle status
CREATE TYPE public.visit_status AS ENUM (
  'scheduled',
  'dispatched',
  'in_progress',
  'completed',
  'cancelled'
);

-- Realtime field status of a technician on a specific visit
CREATE TYPE public.technician_visit_status AS ENUM (
  'assigned',
  'en_route',
  'working',
  'paused',
  'done'
);

-- Discrete actions recorded during field maintenance
CREATE TYPE public.activity_type AS ENUM (
  'inspected',
  'diagnosed',
  'repaired',
  'replaced',
  'installed',
  'cleaned',
  'gas_charged',
  'tested',
  'commissioned'
);

-- Categorization of technician tracked time
CREATE TYPE public.timesheet_category AS ENUM (
  'travel',
  'on_site',
  'paused'
);

-- Quantitative equipment readings
CREATE TYPE public.reading_type AS ENUM (
  'gas_pressure_suction',
  'gas_pressure_discharge',
  'amps',
  'voltage',
  'supply_air_temp',
  'return_air_temp',
  'earth_resistance',
  'water_pressure',
  'other'
);

-- Direction of parts / materials on site
CREATE TYPE public.material_movement_type AS ENUM (
  'installed',
  'removed'
);

-- Commercial coverage terms for installed parts
CREATE TYPE public.material_coverage AS ENUM (
  'chargeable',
  'amc',
  'warranty',
  'goodwill'
);

-- Disposition pathway for removed / defective components
CREATE TYPE public.material_disposition AS ENUM (
  'return_to_stock',
  'supplier_warranty_return',
  'scrap',
  'left_with_customer'
);

-- Classification of uploaded job documents & photos
CREATE TYPE public.attachment_category AS ENUM (
  'before',
  'after',
  'document',
  'signature',
  'other'
);

-- Checklist question response modalities
CREATE TYPE public.checklist_response_type AS ENUM (
  'pass_fail',
  'numeric',
  'text',
  'yes_no',
  'photo'
);
