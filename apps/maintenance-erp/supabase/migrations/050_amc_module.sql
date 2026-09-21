-- =============================================================================
-- Migration 050: Annual Maintenance Contracts (AMC), Scheduling & Dispatch
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. amc_contracts (AMC-YYYY-XXXX) with service SLA & frequency configuration
--   2. amc_contract_assets (Links AMC to customer_assets equipment registry)
--   3. amc_schedules (Idempotent recurring visit generation: Q1, Q2, Q3, Q4)
--   4. generate_amc_work_order() (Integrates directly into Phase 1 Work Order engine)
--   5. bill_amc_contract() (Generates recurring installment invoices in Phase 2B)
--   6. renew_amc_contract() (Historical renewal preserving audit trail)

-- ---------------------------------------------------------------------------
-- 1. Table: amc_contracts
-- ---------------------------------------------------------------------------
CREATE TABLE public.amc_contracts (
  id                    uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                      REFERENCES public.branches(id) ON DELETE SET NULL,
  contract_number       text                      NOT NULL,
  customer_id           uuid                      NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id               uuid                      REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  start_date            date                      NOT NULL,
  end_date              date                      NOT NULL,
  contract_value        numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (contract_value >= 0),
  tax_amount            numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  total_amount          numeric(14,3)             GENERATED ALWAYS AS (contract_value + tax_amount) STORED,
  billing_frequency     text                      NOT NULL DEFAULT 'quarterly', -- 'annual_upfront', 'quarterly', 'monthly', 'milestone'
  service_frequency     text                      NOT NULL DEFAULT 'quarterly', -- 'monthly', 'bi_monthly', 'quarterly', 'semi_annual', 'annual'
  response_sla_hours    integer                   NOT NULL DEFAULT 4 CHECK (response_sla_hours > 0),
  included_visits       integer                   NOT NULL DEFAULT 4 CHECK (included_visits >= 0),
  included_labour       boolean                   NOT NULL DEFAULT true,
  included_materials    boolean                   NOT NULL DEFAULT false,
  exclusions            text,
  status                public.amc_contract_status NOT NULL DEFAULT 'draft',
  previous_contract_id  uuid                      REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  renewal_quotation_id  uuid                      REFERENCES public.quotations(id) ON DELETE SET NULL,
  notes                 text,
  created_by            uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by           uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  created_at            timestamptz               NOT NULL DEFAULT now(),
  updated_at            timestamptz               NOT NULL DEFAULT now(),

  CONSTRAINT chk_amc_contract_dates CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX uq_amc_contracts_number ON public.amc_contracts (company_id, contract_number);
CREATE INDEX idx_amc_contracts_customer     ON public.amc_contracts (customer_id, status);
CREATE INDEX idx_amc_contracts_dates        ON public.amc_contracts (company_id, start_date, end_date);

CREATE TRIGGER set_amc_contracts_updated_at
  BEFORE UPDATE ON public.amc_contracts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate AMC Contract Number (AMC-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_amc_contract_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.contract_number IS NULL OR trim(NEW.contract_number) = '' THEN
    NEW.contract_number := public.generate_document_number(
      NEW.company_id,
      'AMC'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_amc_contract_auto_fields
  BEFORE INSERT ON public.amc_contracts
  FOR EACH ROW EXECUTE FUNCTION public.handle_amc_contract_before_insert();

COMMENT ON TABLE public.amc_contracts IS 'Annual Maintenance Contracts defining service coverage, SLAs, and recurring terms.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('amc_contracts');

-- ---------------------------------------------------------------------------
-- 2. Table: amc_contract_assets (Covered Equipment in Customer Asset Tree)
-- ---------------------------------------------------------------------------
CREATE TABLE public.amc_contract_assets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  amc_contract_id     uuid        NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  customer_asset_id   uuid        NOT NULL REFERENCES public.customer_assets(id) ON DELETE RESTRICT,
  service_coverage    text        NOT NULL DEFAULT 'full', -- 'full', 'preventive_only', 'comprehensive'
  visit_frequency     text        NOT NULL DEFAULT 'quarterly',
  included_services   text[]      DEFAULT ARRAY[]::text[],
  exclusions          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_amc_contract_assets ON public.amc_contract_assets (amc_contract_id, customer_asset_id);
CREATE INDEX idx_amc_contract_assets_asset ON public.amc_contract_assets (customer_asset_id);

COMMENT ON TABLE public.amc_contract_assets IS 'Equipment covered under an AMC without duplicating the central asset registry.';

-- ---------------------------------------------------------------------------
-- 3. Table: amc_schedules (Planned Recurring Visits)
-- ---------------------------------------------------------------------------
CREATE TABLE public.amc_schedules (
  id                    uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  amc_contract_id       uuid                      NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  amc_contract_asset_id uuid                      REFERENCES public.amc_contract_assets(id) ON DELETE SET NULL,
  scheduled_date        date                      NOT NULL,
  period_label          text                      NOT NULL, -- 'Q1-2026', 'Q2-2026', etc.
  status                public.amc_schedule_status NOT NULL DEFAULT 'scheduled',
  work_order_id         uuid                      REFERENCES public.work_orders(id) ON DELETE SET NULL,
  notes                 text,
  created_at            timestamptz               NOT NULL DEFAULT now()
);

-- Idempotency constraint preventing duplicate schedule generation for the same period
CREATE UNIQUE INDEX uq_amc_schedules_period
  ON public.amc_schedules (
    amc_contract_id,
    period_label,
    COALESCE(amc_contract_asset_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_amc_schedules_date ON public.amc_schedules (scheduled_date, status);

COMMENT ON TABLE public.amc_schedules IS 'Recurring scheduled maintenance visits generated from AMC terms.';

-- ---------------------------------------------------------------------------
-- 4. Transactional RPC: generate_amc_schedule()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_amc_schedule(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_interval interval;
  v_num_visits integer;
  v_date date;
  v_period_label text;
  v_count integer := 0;
  i integer;
BEGIN
  SELECT * INTO v_contract
  FROM public.amc_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'AMC contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  IF v_contract.service_frequency = 'monthly' THEN
    v_interval := INTERVAL '1 month';
    v_num_visits := 12;
  ELSIF v_contract.service_frequency = 'bi_monthly' THEN
    v_interval := INTERVAL '2 months';
    v_num_visits := 6;
  ELSIF v_contract.service_frequency = 'quarterly' THEN
    v_interval := INTERVAL '3 months';
    v_num_visits := 4;
  ELSIF v_contract.service_frequency = 'semi_annual' THEN
    v_interval := INTERVAL '6 months';
    v_num_visits := 2;
  ELSE
    v_interval := INTERVAL '1 year';
    v_num_visits := 1;
  END IF;

  FOR i IN 1..v_num_visits LOOP
    v_date := v_contract.start_date + ((i - 1) * v_interval);
    IF v_date <= v_contract.end_date THEN
      v_period_label := 'Visit-' || LPAD(i::text, 2, '0') || ' (' || to_char(v_date, 'Mon YYYY') || ')';

      INSERT INTO public.amc_schedules (
        amc_contract_id, scheduled_date, period_label, status
      ) VALUES (
        p_contract_id, v_date, v_period_label, 'scheduled'
      )
      ON CONFLICT (amc_contract_id, period_label, COALESCE(amc_contract_asset_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO NOTHING;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'contract_id', p_contract_id,
    'schedules_generated', v_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Transactional RPC: generate_amc_work_order()
-- ---------------------------------------------------------------------------
-- Spawns a real Phase 1 Work Order from an AMC Schedule record
CREATE OR REPLACE FUNCTION public.generate_amc_work_order(p_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sched RECORD;
  v_contract RECORD;
  v_wo_id uuid;
  v_wo_number text;
  v_st_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_sched
  FROM public.amc_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF v_sched.id IS NULL THEN
    RAISE EXCEPTION 'AMC Schedule % not found', p_schedule_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency check
  IF v_sched.work_order_id IS NOT NULL THEN
    SELECT id, order_number INTO v_wo_id, v_wo_number
    FROM public.work_orders
    WHERE id = v_sched.work_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'already_generated', true,
      'work_order_id', v_wo_id,
      'order_number', v_wo_number
    );
  END IF;

  SELECT * INTO v_contract
  FROM public.amc_contracts
  WHERE id = v_sched.amc_contract_id;

  -- Resolve default maintenance service type
  SELECT id INTO v_st_id
  FROM public.service_types
  WHERE company_id = v_contract.company_id AND is_active = true
  ORDER BY created_at ASC LIMIT 1;

  -- Create Phase 1 Work Order
  INSERT INTO public.work_orders (
    company_id, branch_id, customer_id, site_id, service_type_id,
    title, description, priority, status, created_by, created_at, updated_at
  ) VALUES (
    v_contract.company_id, v_contract.branch_id, v_contract.customer_id, v_contract.site_id, v_st_id,
    'AMC Service: ' || v_contract.contract_number || ' - ' || v_sched.period_label,
    'Scheduled preventive maintenance under contract ' || v_contract.contract_number,
    'medium', 'pending_dispatch', auth.uid(), v_now, v_now
  )
  RETURNING id, order_number INTO v_wo_id, v_wo_number;

  -- Link work order back to schedule
  UPDATE public.amc_schedules
  SET
    work_order_id = v_wo_id,
    status = 'work_order_generated'
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object(
    'success', true,
    'schedule_id', p_schedule_id,
    'work_order_id', v_wo_id,
    'order_number', v_wo_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Transactional RPC: bill_amc_contract()
-- ---------------------------------------------------------------------------
-- Spawns recurring installment commercial invoice in Phase 2B
CREATE OR REPLACE FUNCTION public.bill_amc_contract(
  p_contract_id uuid,
  p_period_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_installment_subtotal numeric(14,3);
  v_installment_tax numeric(14,3);
  v_installment_grand_total numeric(14,3);
  v_num_installments integer := 4;
  v_inv_id uuid;
  v_inv_number text;
  v_note_pattern text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_contract
  FROM public.amc_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'AMC Contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  v_note_pattern := 'AMC Installment: ' || v_contract.contract_number || ' - ' || p_period_label;

  -- Check if invoice already exists for this contract and period (Idempotency)
  SELECT id, invoice_number INTO v_inv_id, v_inv_number
  FROM public.invoices
  WHERE company_id = v_contract.company_id
    AND notes = v_note_pattern
    AND status <> 'cancelled';

  IF v_inv_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_billed', true,
      'invoice_id', v_inv_id,
      'invoice_number', v_inv_number
    );
  END IF;

  -- Determine installment division
  IF v_contract.billing_frequency = 'annual_upfront' THEN
    v_num_installments := 1;
  ELSIF v_contract.billing_frequency = 'semi_annual' THEN
    v_num_installments := 2;
  ELSIF v_contract.billing_frequency = 'quarterly' THEN
    v_num_installments := 4;
  ELSIF v_contract.billing_frequency = 'monthly' THEN
    v_num_installments := 12;
  END IF;

  v_installment_subtotal := ROUND(v_contract.contract_value / v_num_installments, 3);
  v_installment_tax := ROUND(v_contract.tax_amount / v_num_installments, 3);
  v_installment_grand_total := v_installment_subtotal + v_installment_tax;

  -- Create Commercial Invoice in Phase 2B
  INSERT INTO public.invoices (
    company_id, branch_id, customer_id, site_id,
    invoice_date, due_date, currency, subtotal,
    taxable_amount, tax_amount, grand_total,
    status, notes, created_by, created_at, updated_at
  ) VALUES (
    v_contract.company_id, v_contract.branch_id, v_contract.customer_id, v_contract.site_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'AED', v_installment_subtotal,
    v_installment_subtotal, v_installment_tax, v_installment_grand_total,
    'draft', v_note_pattern, auth.uid(), v_now, v_now
  )
  RETURNING id, invoice_number INTO v_inv_id, v_inv_number;

  -- Insert invoice line item
  INSERT INTO public.invoice_lines (
    invoice_id, line_type, description, quantity, unit_price,
    subtotal, tax_rate, tax_amount, total_amount
  ) VALUES (
    v_inv_id, 'service', 'AMC Maintenance Service (' || p_period_label || ') - ' || v_contract.contract_number,
    1.0000, v_installment_subtotal, v_installment_subtotal, 5.00,
    v_installment_tax, v_installment_grand_total
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'period_label', p_period_label,
    'grand_total', v_installment_grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Transactional RPC: renew_amc_contract()
-- ---------------------------------------------------------------------------
-- Spawns renewal contract preserving previous contract linkage
CREATE OR REPLACE FUNCTION public.renew_amc_contract(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old RECORD;
  v_new_id uuid;
  v_new_number text;
  v_new_start date;
  v_new_end date;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_old
  FROM public.amc_contracts
  WHERE id = p_contract_id;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'AMC Contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  v_new_start := v_old.end_date + INTERVAL '1 day';
  v_new_end := v_new_start + (v_old.end_date - v_old.start_date);

  -- Create renewed contract
  INSERT INTO public.amc_contracts (
    company_id, branch_id, customer_id, site_id,
    start_date, end_date, contract_value, tax_amount,
    billing_frequency, service_frequency, response_sla_hours,
    included_visits, included_labour, included_materials, exclusions,
    status, previous_contract_id, notes, created_by, created_at, updated_at
  ) VALUES (
    v_old.company_id, v_old.branch_id, v_old.customer_id, v_old.site_id,
    v_new_start, v_new_end, v_old.contract_value, v_old.tax_amount,
    v_old.billing_frequency, v_old.service_frequency, v_old.response_sla_hours,
    v_old.included_visits, v_old.included_labour, v_old.included_materials, v_old.exclusions,
    'active', p_contract_id, 'Renewed from ' || v_old.contract_number,
    auth.uid(), v_now, v_now
  )
  RETURNING id, contract_number INTO v_new_id, v_new_number;

  -- Copy covered assets
  INSERT INTO public.amc_contract_assets (
    amc_contract_id, customer_asset_id, service_coverage,
    visit_frequency, included_services, exclusions
  )
  SELECT
    v_new_id, customer_asset_id, service_coverage,
    visit_frequency, included_services, exclusions
  FROM public.amc_contract_assets
  WHERE amc_contract_id = p_contract_id;

  -- Update old contract to renewed
  UPDATE public.amc_contracts
  SET status = 'renewed', updated_at = v_now
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_contract_id', p_contract_id,
    'new_contract_id', v_new_id,
    'new_contract_number', v_new_number,
    'start_date', v_new_start,
    'end_date', v_new_end
  );
END;
$$;
