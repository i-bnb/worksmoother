-- =============================================================================
-- Migration 024: Item Master, UOMs & Hierarchical Categories
-- Maintenance Management ERP — Phase 2A Inventory & Purchasing
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: uoms (Units of Measurement)
-- ---------------------------------------------------------------------------
CREATE TABLE public.uoms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code            text        NOT NULL, -- 'PCS', 'MTR', 'KG', 'LTR', 'HR', 'BOX'
  name            text        NOT NULL,
  allow_decimals  boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_uoms_company_code ON public.uoms (company_id, code);

CREATE TRIGGER set_uoms_updated_at
  BEFORE UPDATE ON public.uoms
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.uoms IS 'Units of measurement with strict decimal precision control.';

-- ---------------------------------------------------------------------------
-- 2. Table: item_categories (Hierarchical Categories)
-- ---------------------------------------------------------------------------
CREATE TABLE public.item_categories (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  parent_category_id  uuid        REFERENCES public.item_categories(id) ON DELETE SET NULL,
  code                text        NOT NULL,
  name                text        NOT NULL,
  description         text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_item_categories_company_code ON public.item_categories (company_id, code);
CREATE INDEX idx_item_categories_parent ON public.item_categories (parent_category_id);

CREATE TRIGGER set_item_categories_updated_at
  BEFORE UPDATE ON public.item_categories
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.item_categories IS 'Hierarchical classification of inventory parts, consumables, and services.';

-- ---------------------------------------------------------------------------
-- 3. Table: items (Master Inventory Catalogue)
-- ---------------------------------------------------------------------------
CREATE TABLE public.items (
  id                uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid              NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sku               text              NOT NULL,
  name              text              NOT NULL,
  multilingual_name jsonb             NOT NULL DEFAULT '{}'::jsonb,
  description       text,
  category_id       uuid              REFERENCES public.item_categories(id) ON DELETE SET NULL,
  uom_id            uuid              NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  item_type         public.item_type  NOT NULL DEFAULT 'spare',
  track_serial      boolean           NOT NULL DEFAULT false,
  track_batch       boolean           NOT NULL DEFAULT false,
  standard_cost     numeric(12,4)     NOT NULL DEFAULT 0.0000 CHECK (standard_cost >= 0),
  sale_price        numeric(12,4)     NOT NULL DEFAULT 0.0000 CHECK (sale_price >= 0),
  reorder_level     numeric(10,2)     NOT NULL DEFAULT 0.00 CHECK (reorder_level >= 0),
  reorder_quantity  numeric(10,2)     NOT NULL DEFAULT 0.00 CHECK (reorder_quantity >= 0),
  is_active         boolean           NOT NULL DEFAULT true,
  created_by        uuid              REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_items_company_sku ON public.items (company_id, sku);
CREATE INDEX idx_items_category ON public.items (category_id, is_active);
CREATE INDEX idx_items_type     ON public.items (company_id, item_type);
CREATE INDEX idx_items_tracking ON public.items (company_id, track_serial, track_batch);

CREATE TRIGGER set_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.items IS 'Item Master defining spare parts, consumables, and chargeable maintenance services.';

-- ---------------------------------------------------------------------------
-- 4. Validation Function: Validate Quantity against UOM Decimal Rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_item_quantity(
  p_item_id uuid,
  p_quantity numeric
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allow_decimals boolean;
BEGIN
  SELECT u.allow_decimals INTO v_allow_decimals
  FROM public.items i
  JOIN public.uoms u ON u.id = i.uom_id
  WHERE i.id = p_item_id;

  IF v_allow_decimals IS FALSE AND (p_quantity != trunc(p_quantity)) THEN
    RAISE EXCEPTION 'Invalid fractional quantity (%) for integer-only UOM', p_quantity
      USING ERRCODE = '22000';
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.validate_item_quantity(uuid, numeric)
IS 'Enforces integer-only constraints on non-decimal UOMs (e.g. preventing 2.75 pieces).';

-- Attach audit triggers
SELECT public.attach_audit_trigger('uoms');
SELECT public.attach_audit_trigger('item_categories');
SELECT public.attach_audit_trigger('items');
