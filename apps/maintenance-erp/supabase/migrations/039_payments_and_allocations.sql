-- =============================================================================
-- Migration 039: Payments, Multi-Invoice Allocations & Gateway Foundation
-- Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
-- =============================================================================
-- Features:
--   - Configurable payment methods (Cash, Bank Transfer, Cheque, Card, UPI, Online Gateway)
--   - Customer payments with unallocated balance tracking (advance deposits)
--   - Multi-invoice payment allocations with strict bounds checks
--   - Provider-agnostic payment gateway foundation (Stripe, Razorpay, etc.)
--   - Phase 3 double-entry financial posting hooks (is_posted_to_gl, gl_journal_entry_id)

-- ---------------------------------------------------------------------------
-- 1. Table: payment_methods
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_methods (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                text        NOT NULL, -- 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'UPI', 'GATEWAY'
  name                text        NOT NULL,
  requires_reference  boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_payment_methods_company_code ON public.payment_methods (company_id, code);

CREATE TRIGGER set_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.payment_methods IS 'Configurable company payment channels and receipt mechanisms.';

-- ---------------------------------------------------------------------------
-- 2. Table: payments
-- ---------------------------------------------------------------------------
CREATE TABLE public.payments (
  id                  uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id           uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id         uuid                  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  payment_number      text                  NOT NULL,
  payment_date        date                  NOT NULL DEFAULT CURRENT_DATE,
  currency            text                  NOT NULL DEFAULT 'AED',
  amount              numeric(14,3)         NOT NULL CHECK (amount > 0),
  payment_method_id   uuid                  REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  payment_method      text                  NOT NULL DEFAULT 'bank_transfer',
  reference_number    text,
  bank_name           text,
  allocated_amount    numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (allocated_amount >= 0),
  unallocated_amount  numeric(14,3)         GENERATED ALWAYS AS (amount - allocated_amount) STORED,
  status              public.payment_status NOT NULL DEFAULT 'received',
  notes               text,
  created_by          uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  received_by         uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  is_posted_to_gl     boolean               NOT NULL DEFAULT false,
  gl_posted_at        timestamptz,
  gl_journal_entry_id uuid,
  idempotency_key     text,
  created_at          timestamptz           NOT NULL DEFAULT now(),
  updated_at          timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT chk_payment_allocated_bounds CHECK (allocated_amount <= amount)
);

CREATE UNIQUE INDEX uq_payments_company_number ON public.payments (company_id, payment_number);
CREATE INDEX idx_payments_customer_status ON public.payments (customer_id, status);
CREATE INDEX idx_payments_date            ON public.payments (company_id, payment_date DESC);
CREATE UNIQUE INDEX uq_payments_idempotency
  ON public.payments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Payment Number
CREATE OR REPLACE FUNCTION public.handle_payment_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payment_number IS NULL OR trim(NEW.payment_number) = '' THEN
    NEW.payment_number := public.generate_document_number(
      NEW.company_id,
      'PAY'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_auto_fields
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_payment_before_insert();

COMMENT ON TABLE public.payments IS 'Customer receipts and advance deposits supporting multi-invoice allocations.';

-- ---------------------------------------------------------------------------
-- 3. Table: payment_allocations
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_allocations (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id        uuid          NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id        uuid          NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  allocated_amount  numeric(14,3) NOT NULL CHECK (allocated_amount > 0),
  allocation_date   timestamptz   NOT NULL DEFAULT now(),
  created_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_payment_allocations_pair ON public.payment_allocations (payment_id, invoice_id);
CREATE INDEX idx_payment_allocations_invoice ON public.payment_allocations (invoice_id);

COMMENT ON TABLE public.payment_allocations IS 'Granular distribution mapping customer payments against specific open invoices.';

-- ---------------------------------------------------------------------------
-- 4. Payment Gateway Foundation (Provider-Agnostic Abstraction)
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_providers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code        text        NOT NULL, -- 'stripe', 'razorpay', 'payfort', 'custom'
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_payment_providers_code ON public.payment_providers (company_id, code);

CREATE TABLE public.payment_transactions (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_id           uuid          REFERENCES public.payment_providers(id) ON DELETE SET NULL,
  invoice_id            uuid          REFERENCES public.invoices(id) ON DELETE SET NULL,
  payment_id            uuid          REFERENCES public.payments(id) ON DELETE SET NULL,
  transaction_reference text          NOT NULL,
  amount                numeric(14,3) NOT NULL CHECK (amount > 0),
  currency              text          NOT NULL DEFAULT 'AED',
  status                text          NOT NULL DEFAULT 'pending', -- 'pending', 'authorized', 'captured', 'failed', 'refunded'
  raw_response          jsonb,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_trans_ref ON public.payment_transactions (company_id, transaction_reference);
CREATE INDEX idx_payment_trans_inv ON public.payment_transactions (invoice_id);

-- Attach audit triggers
SELECT public.attach_audit_trigger('payment_methods');
SELECT public.attach_audit_trigger('payments');
SELECT public.attach_audit_trigger('payment_allocations');
