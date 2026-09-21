-- =============================================================================
-- Migration 045: General Ledger, Journal Entries, Lines & Immutability Triggers
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Core Accounting Invariants:
--   1. Double-entry rule: Every posted transaction must balance (Total Debit = Total Credit).
--   2. Immutability: Once a journal is posted or reversed, it cannot be modified or deleted.
--   3. Correcting historical entries requires an explicit balancing reversal journal.
--   4. Journal lines cannot contain simultaneous debit and credit.

-- ---------------------------------------------------------------------------
-- 1. Table: journal_entries
-- ---------------------------------------------------------------------------
CREATE TABLE public.journal_entries (
  id                      uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  journal_number          text                  NOT NULL,
  journal_date            date                  NOT NULL DEFAULT CURRENT_DATE,
  period_id               uuid                  REFERENCES public.accounting_periods(id) ON DELETE RESTRICT,
  reference_type          text                  NOT NULL, -- 'invoice', 'payment', 'credit_note', 'supplier_bill', 'supplier_payment', 'inventory_cogs', 'manual', 'reversal', 'rental', 'amc', 'expense'
  reference_id            uuid,
  description             text                  NOT NULL,
  currency                text                  NOT NULL DEFAULT 'AED',
  exchange_rate           numeric(12,6)         NOT NULL DEFAULT 1.000000 CHECK (exchange_rate > 0),
  status                  public.journal_status NOT NULL DEFAULT 'draft',
  total_debit             numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (total_debit >= 0),
  total_credit            numeric(14,3)         NOT NULL DEFAULT 0.000 CHECK (total_credit >= 0),
  created_by              uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by             uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  posted_by               uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at               timestamptz,
  reversal_of_journal_id  uuid                  REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  idempotency_key         text,
  created_at              timestamptz           NOT NULL DEFAULT now(),
  updated_at              timestamptz           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_journal_entries_company_number ON public.journal_entries (company_id, journal_number);
CREATE INDEX idx_journal_entries_date      ON public.journal_entries (company_id, journal_date DESC);
CREATE INDEX idx_journal_entries_status    ON public.journal_entries (company_id, status);
CREATE INDEX idx_journal_entries_reference ON public.journal_entries (reference_type, reference_id);
CREATE INDEX idx_journal_entries_period    ON public.journal_entries (period_id);
CREATE UNIQUE INDEX uq_journal_entries_idempotency
  ON public.journal_entries (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER set_journal_entries_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Journal Number (JRN-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_journal_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.journal_number IS NULL OR trim(NEW.journal_number) = '' THEN
    NEW.journal_number := public.generate_document_number(
      NEW.company_id,
      'JRN'::public.document_type,
      NEW.branch_id
    );
  END IF;

  -- Auto-resolve accounting period if not explicitly supplied
  IF NEW.period_id IS NULL THEN
    SELECT id INTO NEW.period_id
    FROM public.accounting_periods
    WHERE company_id = NEW.company_id
      AND NEW.journal_date >= start_date
      AND NEW.journal_date <= end_date
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_auto_fields
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_journal_before_insert();

COMMENT ON TABLE public.journal_entries IS 'General Journal Header for double-entry financial accounting.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('journal_entries');

-- ---------------------------------------------------------------------------
-- 2. Table: journal_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.journal_lines (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid          NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id        uuid          NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  debit             numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (debit >= 0),
  credit            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (credit >= 0),
  base_debit        numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (base_debit >= 0),
  base_credit       numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (base_credit >= 0),
  description       text,
  customer_id       uuid          REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id       uuid          REFERENCES public.suppliers(id) ON DELETE SET NULL,
  employee_id       uuid          REFERENCES public.employees(id) ON DELETE SET NULL,
  work_order_id     uuid          REFERENCES public.work_orders(id) ON DELETE SET NULL,
  cost_center_id    uuid          REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_journal_lines_debit_credit CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT chk_journal_lines_nonzero CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX idx_journal_lines_entry      ON public.journal_lines (journal_entry_id);
CREATE INDEX idx_journal_lines_account    ON public.journal_lines (account_id);
CREATE INDEX idx_journal_lines_customer   ON public.journal_lines (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_journal_lines_supplier   ON public.journal_lines (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_journal_lines_work_order ON public.journal_lines (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX idx_journal_lines_cost_ctr   ON public.journal_lines (cost_center_id) WHERE cost_center_id IS NOT NULL;

COMMENT ON TABLE public.journal_lines IS 'Individual debit and credit entries making up a balanced journal.';

-- ---------------------------------------------------------------------------
-- 3. Strict Database Immutability Triggers for Posted Journals
-- ---------------------------------------------------------------------------

-- Trigger on journal_entries: Block direct updates or deletion once posted/reversed
CREATE OR REPLACE FUNCTION public.trg_enforce_journal_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Fatal: Cannot delete % journal % (financial records are strictly immutable). Use reverse_journal_entry() instead.',
        OLD.status, OLD.journal_number USING ERRCODE = '22000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- If already posted or reversed, forbid mutating financial or core metadata
    IF OLD.status IN ('posted', 'reversed') THEN
      IF NEW.total_debit <> OLD.total_debit OR
         NEW.total_credit <> OLD.total_credit OR
         NEW.journal_date <> OLD.journal_date OR
         NEW.period_id <> OLD.period_id OR
         NEW.currency <> OLD.currency OR
         NEW.exchange_rate <> OLD.exchange_rate OR
         NEW.company_id <> OLD.company_id OR
         (OLD.status = 'reversed' AND NEW.status <> 'reversed') OR
         (OLD.status = 'posted' AND NEW.status NOT IN ('posted', 'reversed')) THEN
        RAISE EXCEPTION 'Fatal: Journal % is % and its financial records are strictly immutable. Corrections must be made via reversal journal.',
          OLD.journal_number, OLD.status USING ERRCODE = '22000';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_immutability
  BEFORE UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_journal_immutability();

-- Trigger on journal_lines: Block any line mutation if journal is posted or reversed
CREATE OR REPLACE FUNCTION public.trg_enforce_journal_lines_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.journal_status;
  v_num text;
  v_entry_id uuid;
BEGIN
  v_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;

  SELECT status, journal_number INTO v_status, v_num
  FROM public.journal_entries
  WHERE id = v_entry_id;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Fatal: Cannot % lines on % journal % (immutable accounting record).',
      TG_OP, v_status, v_num USING ERRCODE = '22000';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_journal_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_journal_lines_immutability();
