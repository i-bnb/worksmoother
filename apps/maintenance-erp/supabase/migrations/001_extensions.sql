-- =============================================================================
-- Migration 001: Extensions & Custom Types
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Run this first. All subsequent migrations depend on these types and extensions.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- gen_random_uuid() fallback
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- crypt(), gen_salt() for any password hashing needs
CREATE EXTENSION IF NOT EXISTS "moddatetime";    -- auto-update updated_at via trigger
-- pg_stat_statements is typically pre-enabled on Supabase; guard against error:
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Custom ENUM Types
-- ---------------------------------------------------------------------------

-- User roles within a company
CREATE TYPE public.user_role AS ENUM (
  'owner_admin',
  'operations_manager',
  'supervisor',
  'technician',
  'storekeeper',
  'accountant',
  'customer'
);

-- Notification / messaging channels
CREATE TYPE public.notification_channel AS ENUM (
  'in_app',
  'push',
  'whatsapp',
  'email',
  'sms'
);

-- Notification lifecycle statuses
CREATE TYPE public.notification_status AS ENUM (
  'pending',
  'queued',
  'sent',
  'delivered',
  'failed',
  'retrying'
);

-- Document types for the number series system
CREATE TYPE public.document_type AS ENUM (
  'WO',   -- Work Order
  'INV',  -- Invoice
  'QUO',  -- Quotation
  'PO',   -- Purchase Order
  'SR',   -- Service Request
  'AMC',  -- Annual Maintenance Contract
  'DN',   -- Delivery Note
  'GRN',  -- Goods Receipt Note
  'RMA',  -- Return Merchandise Authorization
  'PMT'   -- Payment Receipt
);

-- Queue job statuses
CREATE TYPE public.queue_job_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'retrying',
  'cancelled'
);

-- Automation execution statuses
CREATE TYPE public.automation_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'skipped'
);

-- Audit actions
CREATE TYPE public.audit_action AS ENUM (
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT'  -- reserved for sensitive read-access logging
);

-- ---------------------------------------------------------------------------
-- Reusable helper: auto-update updated_at on row change
-- ---------------------------------------------------------------------------
-- Uses moddatetime extension.
-- Usage: CREATE TRIGGER set_updated_at
--          BEFORE UPDATE ON <table>
--          FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
--
-- This comment documents the pattern; each table migration attaches this trigger.
