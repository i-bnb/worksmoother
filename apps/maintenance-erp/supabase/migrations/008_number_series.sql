-- =============================================================================
-- Migration 008: Transactional & Concurrency-Safe Number Series System
-- Maintenance Management ERP — Phase 0 Foundation
-- =============================================================================
-- Guaranteed unique, gap-resistant, concurrency-safe document numbering:
--   Examples: WO-2026-0001, INV-2026-0001, PO-2026-0001, SR-2026-0001
-- Features:
--   - SELECT ... FOR UPDATE row-level locking avoids race conditions and duplicates
--   - Timezone-aware annual sequence reset based on company settings
--   - Branch-aware numbering support (e.g. WO-DXB-2026-0001)
--   - Executable via SECURITY DEFINER function so frontend never generates numbers

-- ---------------------------------------------------------------------------
-- 1. Table: number_series
-- ---------------------------------------------------------------------------
CREATE TABLE public.number_series (
  id                  uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id           uuid                  REFERENCES public.branches(id) ON DELETE CASCADE,
  doc_type            public.document_type  NOT NULL,
  prefix              text                  NOT NULL,
  current_year        integer               NOT NULL,
  current_sequence    bigint                NOT NULL DEFAULT 0,
  pad_length          integer               NOT NULL DEFAULT 4 CHECK (pad_length >= 3 AND pad_length <= 10),
  yearly_reset        boolean               NOT NULL DEFAULT true,
  include_branch      boolean               NOT NULL DEFAULT false,
  is_active           boolean               NOT NULL DEFAULT true,
  last_generated_at   timestamptz,
  created_at          timestamptz           NOT NULL DEFAULT now(),
  updated_at          timestamptz           NOT NULL DEFAULT now()
);

-- Unique index per company, doc_type, year, and branch (NULL branch coalesced)
CREATE UNIQUE INDEX uq_number_series_scope
  ON public.number_series (
    company_id,
    doc_type,
    current_year,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_number_series_lookup
  ON public.number_series (company_id, doc_type, is_active);

CREATE TRIGGER set_number_series_updated_at
  BEFORE UPDATE ON public.number_series
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.number_series IS 'Configuration and state for transactional document number generation.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('number_series');

-- ---------------------------------------------------------------------------
-- 2. Transactional Generator Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_document_number(
  p_company_id uuid,
  p_doc_type public.document_type,
  p_branch_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tz text;
  v_active_year integer;
  v_series_id uuid;
  v_prefix text;
  v_next_seq bigint;
  v_pad_len integer;
  v_yearly_reset boolean;
  v_include_branch boolean;
  v_branch_code text := '';
  v_doc_number text;
BEGIN
  -- Validate caller has access to this company
  IF auth.uid() IS NOT NULL AND NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not belong to company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  -- 1. Determine company timezone to calculate accurate local calendar year
  SELECT COALESCE(timezone, 'Asia/Dubai') INTO v_tz
  FROM public.companies
  WHERE id = p_company_id;

  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  v_active_year := EXTRACT(YEAR FROM (now() AT TIME ZONE v_tz))::integer;

  -- 2. Lookup existing series with row lock (FOR UPDATE), preferring branch-specific over company-wide
  SELECT
    id, prefix, current_sequence, pad_length, yearly_reset, include_branch
  INTO
    v_series_id, v_prefix, v_next_seq, v_pad_len, v_yearly_reset, v_include_branch
  FROM public.number_series
  WHERE company_id = p_company_id
    AND doc_type = p_doc_type
    AND is_active = true
    AND (branch_id = p_branch_id OR (p_branch_id IS NULL AND branch_id IS NULL))
  ORDER BY branch_id NULLS LAST
  LIMIT 1
  FOR UPDATE;

  -- 3. If no existing series found, initialize default series on the fly
  IF v_series_id IS NULL THEN
    v_prefix := p_doc_type::text;
    v_pad_len := 4;
    v_yearly_reset := true;
    v_include_branch := (p_branch_id IS NOT NULL);

    INSERT INTO public.number_series (
      company_id, branch_id, doc_type, prefix, current_year,
      current_sequence, pad_length, yearly_reset, include_branch, is_active
    ) VALUES (
      p_company_id, p_branch_id, p_doc_type, v_prefix, v_active_year,
      0, v_pad_len, v_yearly_reset, v_include_branch, true
    )
    ON CONFLICT (
      company_id, doc_type, current_year,
      COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    DO NOTHING
    RETURNING id INTO v_series_id;

    -- Lock the newly created or existing row
    SELECT
      id, prefix, current_sequence, pad_length, yearly_reset, include_branch
    INTO
      v_series_id, v_prefix, v_next_seq, v_pad_len, v_yearly_reset, v_include_branch
    FROM public.number_series
    WHERE company_id = p_company_id
      AND doc_type = p_doc_type
      AND (branch_id = p_branch_id OR (p_branch_id IS NULL AND branch_id IS NULL))
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- 4. Check for year turnover and increment sequence
  IF v_yearly_reset AND v_active_year > (
    SELECT current_year FROM public.number_series WHERE id = v_series_id
  ) THEN
    v_next_seq := 1;
    UPDATE public.number_series
    SET
      current_year = v_active_year,
      current_sequence = 1,
      last_generated_at = now(),
      updated_at = now()
    WHERE id = v_series_id;
  ELSE
    v_next_seq := v_next_seq + 1;
    UPDATE public.number_series
    SET
      current_sequence = v_next_seq,
      last_generated_at = now(),
      updated_at = now()
    WHERE id = v_series_id;
  END IF;

  -- 5. Branch code if configured
  IF v_include_branch AND p_branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code
    FROM public.branches
    WHERE id = p_branch_id;
  END IF;

  -- 6. Format the document number string
  IF v_branch_code <> '' THEN
    v_doc_number := format(
      '%s-%s-%s-%s',
      v_prefix,
      v_branch_code,
      v_active_year::text,
      lpad(v_next_seq::text, v_pad_len, '0')
    );
  ELSE
    v_doc_number := format(
      '%s-%s-%s',
      v_prefix,
      v_active_year::text,
      lpad(v_next_seq::text, v_pad_len, '0')
    );
  END IF;

  RETURN v_doc_number;
END;
$$;

COMMENT ON FUNCTION public.generate_document_number(uuid, public.document_type, uuid) IS 'Atomically generates the next concurrency-safe document number (e.g. WO-2026-0001) using row-level locking.';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security on number_series
-- ---------------------------------------------------------------------------
ALTER TABLE public.number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.number_series FORCE ROW LEVEL SECURITY;

-- Select: Company users can read series configurations
CREATE POLICY number_series_select ON public.number_series
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
  );

-- Manage: Only owner_admin or operations_manager
CREATE POLICY number_series_manage ON public.number_series
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  )
  WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_any_role(ARRAY['owner_admin'::public.user_role, 'operations_manager'::public.user_role])
  );
