-- =============================================================================
-- Migration 033: Sales, Invoicing & Payments Custom Types & Enums
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================

-- Quotation workflow states
CREATE TYPE public.quotation_status AS ENUM (
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled'
);

-- Sales Order commercial and fulfillment states
CREATE TYPE public.sales_order_status AS ENUM (
  'draft',
  'confirmed',
  'partially_fulfilled',
  'fulfilled',
  'invoiced',
  'cancelled'
);

-- Commercial Invoice lifecycle states
CREATE TYPE public.invoice_status AS ENUM (
  'draft',
  'approved',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled'
);

-- Credit Note financial adjustment states
CREATE TYPE public.credit_note_status AS ENUM (
  'draft',
  'approved',
  'issued',
  'applied',
  'cancelled'
);

-- Customer Payment collection and clearing states
CREATE TYPE public.payment_status AS ENUM (
  'draft',
  'received',
  'cleared',
  'bounced',
  'cancelled'
);

-- Extend document_type enum with Sales Order (SO), Credit Note (CN), and Payment (PAY)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'SO';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'CN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'PAY';
