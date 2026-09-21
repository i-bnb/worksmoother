-- =============================================================================
-- Migration 023: Inventory & Purchasing Custom Types & Enums
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================

-- Broad classification of items in the catalogue
CREATE TYPE public.item_type AS ENUM (
  'service',
  'material',
  'spare',
  'rental_asset'
);

-- Types of storage and transit facilities
CREATE TYPE public.location_type AS ENUM (
  'warehouse',
  'technician_van',
  'returns',
  'quarantine',
  'scrap'
);

-- Distinct operational causes for stock ledger transactions
CREATE TYPE public.stock_movement_type AS ENUM (
  'purchase_receipt',
  'transfer_out',
  'transfer_in',
  'job_issue',
  'job_return',
  'customer_sale',
  'adjustment',
  'write_off',
  'scrap',
  'opening_balance'
);

-- Movement flow direction relative to the location
CREATE TYPE public.stock_movement_direction AS ENUM (
  'in',
  'out'
);

-- Lifecycle tracking of individual serialized parts
CREATE TYPE public.serial_status AS ENUM (
  'in_stock',
  'in_transit',
  'installed',
  'returned',
  'scrapped',
  'written_off'
);

-- Inter-location stock transfer workflow
CREATE TYPE public.transfer_status AS ENUM (
  'draft',
  'requested',
  'approved',
  'in_transit',
  'received',
  'cancelled'
);

-- Internal requisition workflow
CREATE TYPE public.purchase_request_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'rejected',
  'converted_to_po',
  'cancelled'
);

-- Purchase Order commercial procurement workflow
CREATE TYPE public.purchase_order_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'ordered',
  'partially_received',
  'fully_received',
  'cancelled'
);

-- Physical inventory stocktake verification workflow
CREATE TYPE public.stocktake_status AS ENUM (
  'draft',
  'counting',
  'review',
  'approved',
  'posted',
  'cancelled'
);

-- Extend document_type enum with Transfer (TRN) and Adjustment (ADJ)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'TRN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'ADJ';
