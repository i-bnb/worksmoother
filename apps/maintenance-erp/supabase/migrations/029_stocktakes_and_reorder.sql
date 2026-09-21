-- =============================================================================
-- Migration 029: Reorder Rules & Physical Stocktake (Count) Workflows
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: reorder_rules
-- ---------------------------------------------------------------------------
CREATE TABLE public.reorder_rules (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id               uuid          NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  location_id           uuid          NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  min_level             numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (min_level >= 0),
  max_level             numeric(12,4),
  reorder_quantity      numeric(12,4) NOT NULL DEFAULT 0.0000 CHECK (reorder_quantity >= 0),
  preferred_supplier_id uuid          REFERENCES public.suppliers(id) ON DELETE SET NULL,
  is_active             boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_min_max_levels CHECK (max_level IS NULL OR max_level >= min_level)
);

CREATE UNIQUE INDEX uq_reorder_rules_item_loc ON public.reorder_rules (company_id, item_id, location_id);

CREATE TRIGGER set_reorder_rules_updated_at
  BEFORE UPDATE ON public.reorder_rules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.reorder_rules IS 'Per-item and per-location threshold limits for proactive replenishment triggering.';

-- ---------------------------------------------------------------------------
-- 2. Table: stocktakes (Physical Count Cycles)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stocktakes (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id         uuid                    REFERENCES public.branches(id) ON DELETE SET NULL,
  stocktake_number  text                    NOT NULL,
  location_id       uuid                    NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  status            public.stocktake_status NOT NULL DEFAULT 'draft',
  scheduled_date    date                    NOT NULL DEFAULT CURRENT_DATE,
  posted_at         timestamptz,
  posted_by         uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  updated_at        timestamptz             NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_stocktakes_number ON public.stocktakes (company_id, stocktake_number);
CREATE INDEX idx_stocktakes_location ON public.stocktakes (location_id, status);

CREATE TRIGGER set_stocktakes_updated_at
  BEFORE UPDATE ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-numbering generator for Stocktake
CREATE OR REPLACE FUNCTION public.handle_stocktake_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seq bigint;
  v_year integer;
BEGIN
  IF NEW.stocktake_number IS NULL OR trim(NEW.stocktake_number) = '' THEN
    v_year := EXTRACT(YEAR FROM now())::integer;
    v_seq := nextval('public.stocktake_seq'::regclass);
    NEW.stocktake_number := format('STK-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.stocktake_seq START 1;

CREATE TRIGGER trg_stocktake_auto_number
  BEFORE INSERT ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.handle_stocktake_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Table: stocktake_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.stocktake_lines (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id          uuid          NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  item_id               uuid          NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  system_quantity       numeric(12,4) NOT NULL DEFAULT 0.0000,
  counted_quantity      numeric(12,4),
  discrepancy_quantity  numeric(12,4) GENERATED ALWAYS AS (COALESCE(counted_quantity, 0) - system_quantity) STORED,
  notes                 text,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_stocktake_lines_item ON public.stocktake_lines (stocktake_id, item_id);

-- Attach audit triggers
SELECT public.attach_audit_trigger('reorder_rules');
SELECT public.attach_audit_trigger('stocktakes');
