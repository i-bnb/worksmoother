-- =============================================================================
-- Migration 043: Finance, Accounting, Rental & AMC Custom Types & Enums
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Account Classifications (Standard Double-Entry 5-Pillar Taxonomy)
-- ---------------------------------------------------------------------------
CREATE TYPE public.account_type AS ENUM (
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense'
);

-- ---------------------------------------------------------------------------
-- 2. Journal Entry Lifecycle Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.journal_status AS ENUM (
  'draft',
  'approved',
  'posted',
  'reversed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- 3. Accounting Period Control Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.period_status AS ENUM (
  'open',
  'locked',
  'closed'
);

-- ---------------------------------------------------------------------------
-- 4. Supplier Bill (Accounts Payable) Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.bill_status AS ENUM (
  'draft',
  'approved',
  'posted',
  'partially_paid',
  'paid',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- 5. Operational & Job Expense Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.expense_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'rejected',
  'posted',
  'reimbursed'
);

-- ---------------------------------------------------------------------------
-- 6. Equipment Rental Lifecycle Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.rental_asset_status AS ENUM (
  'available',
  'reserved',
  'out_for_rental',
  'returned',
  'under_inspection',
  'maintenance',
  'damaged',
  'retired'
);

CREATE TYPE public.rental_contract_status AS ENUM (
  'draft',
  'approved',
  'reserved',
  'active',
  'extended',
  'return_pending',
  'returned',
  'closed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- 7. Annual Maintenance Contract (AMC) Statuses
-- ---------------------------------------------------------------------------
CREATE TYPE public.amc_contract_status AS ENUM (
  'draft',
  'quoted',
  'approved',
  'active',
  'expiring',
  'expired',
  'renewed',
  'cancelled'
);

CREATE TYPE public.amc_schedule_status AS ENUM (
  'scheduled',
  'work_order_generated',
  'completed',
  'skipped',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- 8. Extend document_type Enum with Phase 3 Document Series
-- ---------------------------------------------------------------------------
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'JRN';   -- General Journal Entry (JRN-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'BILL';  -- Supplier Bill / AP Invoice (BILL-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'SPAY';  -- Supplier Payment / Disbursement (SPAY-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'EXP';   -- Expense Claim (EXP-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'RNT';   -- Rental Contract (RNT-YYYY-XXXX)
-- Note: 'AMC' (Annual Maintenance Contract) was already registered in 001_extensions.sql
