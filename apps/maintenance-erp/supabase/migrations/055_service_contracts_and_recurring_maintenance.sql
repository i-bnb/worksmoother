-- =============================================================================
-- Migration 055: Phase 4 AMC, Service Contracts & Recurring Maintenance
-- Maintenance Management ERP
-- =============================================================================
-- Enhances contract management foundation:
--   1. amc_contracts extensions: contract_type, currency, terms, suspension, cancellation, renewal
--   2. amc_contract_assets extensions: coverage_type, coverage dates, asset pricing
--   3. contract_entitlements: quotas for visits, labor hours, parts allowance, emergency visits
--   4. contract_slas: service calendars, working days, business-hours response/resolution
--   5. contract_billing_schedules: periodic installment billing with idempotency
--   6. amc_schedules extensions: schedule types, technicians, checklists, service requests
--   7. work_orders & work_order_lines extensions: contract backlinks and coverage classifications
--   8. RPCs: quotation conversion, coverage evaluation, entitlement recording, recurring scheduling & billing

-- ---------------------------------------------------------------------------
-- 1. Extend Status ENUMs
-- ---------------------------------------------------------------------------
ALTER TYPE public.amc_contract_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE public.amc_contract_status ADD VALUE IF NOT EXISTS 'suspended';

-- ---------------------------------------------------------------------------
-- 2. Extend Table: amc_contracts
-- ---------------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'amc',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS terms_and_conditions text,
  ADD COLUMN IF NOT EXISTS renewal_settings jsonb NOT NULL DEFAULT '{"auto_renewal": false, "renewal_notice_days": 30, "price_adjustment_percent": 0}'::jsonb,
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewal_contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE INDEX IF NOT EXISTS idx_amc_contracts_type ON public.amc_contracts (company_id, contract_type, status);
CREATE INDEX IF NOT EXISTS idx_amc_contracts_quotation ON public.amc_contracts (quotation_id) WHERE quotation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Extend Table: amc_contract_assets
-- ---------------------------------------------------------------------------
ALTER TABLE public.amc_contract_assets
  ADD COLUMN IF NOT EXISTS coverage_type text NOT NULL DEFAULT 'full_service'
    CHECK (coverage_type IN ('full_service', 'parts_only', 'labor_only', 'preventive_only', 'breakdown_only', 'parts_and_labor', 'custom')),
  ADD COLUMN IF NOT EXISTS coverage_start date,
  ADD COLUMN IF NOT EXISTS coverage_end date,
  ADD COLUMN IF NOT EXISTS asset_price numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (asset_price >= 0),
  ADD COLUMN IF NOT EXISTS service_notes text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_amc_contract_assets_status ON public.amc_contract_assets (amc_contract_id, is_active);

-- ---------------------------------------------------------------------------
-- 4. New Table: contract_entitlements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_entitlements (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_id           uuid          NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  contract_asset_id     uuid          REFERENCES public.amc_contract_assets(id) ON DELETE CASCADE,
  entitlement_type      text          NOT NULL
    CHECK (entitlement_type IN ('preventive_visits', 'emergency_visits', 'total_visits', 'labor_hours', 'parts_allowance', 'annual_service_value')),
  total_entitled        numeric(14,3) NOT NULL CHECK (total_entitled >= 0),
  used_quantity         numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (used_quantity >= 0),
  remaining_quantity    numeric(14,3) GENERATED ALWAYS AS (total_entitled - used_quantity) STORED,
  unit                  text          NOT NULL DEFAULT 'visits',
  limit_action          text          NOT NULL DEFAULT 'convert_to_billable'
    CHECK (limit_action IN ('reject_coverage', 'convert_to_billable', 'require_approval')),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_entitlements
  ON public.contract_entitlements (
    contract_id,
    COALESCE(contract_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
    entitlement_type
  );

CREATE INDEX IF NOT EXISTS idx_contract_entitlements_company ON public.contract_entitlements (company_id, contract_id);

CREATE TRIGGER set_contract_entitlements_updated_at
  BEFORE UPDATE ON public.contract_entitlements
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('contract_entitlements');

-- ---------------------------------------------------------------------------
-- 5. New Table: contract_slas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_slas (
  id                    uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_id           uuid                        NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  priority              public.work_order_priority  NOT NULL,
  response_time_hours   numeric(6,2)                NOT NULL DEFAULT 4.00 CHECK (response_time_hours > 0),
  resolution_time_hours numeric(6,2)                NOT NULL DEFAULT 24.00 CHECK (resolution_time_hours > 0),
  emergency_response_hours numeric(6,2)             DEFAULT 2.00,
  service_window_start  time                        NOT NULL DEFAULT '09:00:00',
  service_window_end    time                        NOT NULL DEFAULT '18:00:00',
  working_days          integer[]                   NOT NULL DEFAULT '{1,2,3,4,5,6}'::integer[],
  timezone              text                        NOT NULL DEFAULT 'Asia/Kolkata',
  is_active             boolean                     NOT NULL DEFAULT true,
  created_at            timestamptz                 NOT NULL DEFAULT now(),
  updated_at            timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_contract_sla_times CHECK (resolution_time_hours >= response_time_hours)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_slas
  ON public.contract_slas (contract_id, priority);

CREATE INDEX IF NOT EXISTS idx_contract_slas_company ON public.contract_slas (company_id, contract_id);

CREATE TRIGGER set_contract_slas_updated_at
  BEFORE UPDATE ON public.contract_slas
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('contract_slas');

-- ---------------------------------------------------------------------------
-- 6. New Table: contract_billing_schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_billing_schedules (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_id           uuid          NOT NULL REFERENCES public.amc_contracts(id) ON DELETE CASCADE,
  installment_number    integer       NOT NULL CHECK (installment_number >= 1),
  billing_period_start  date          NOT NULL,
  billing_period_end    date          NOT NULL,
  billing_date          date          NOT NULL,
  amount                numeric(14,3) NOT NULL CHECK (amount >= 0),
  tax_amount            numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  total_amount          numeric(14,3) GENERATED ALWAYS AS (amount + tax_amount) STORED,
  period_label          text          NOT NULL,
  invoice_id            uuid          REFERENCES public.invoices(id) ON DELETE SET NULL,
  status                text          NOT NULL DEFAULT 'unbilled'
    CHECK (status IN ('unbilled', 'billed', 'partially_billed', 'paid', 'overdue', 'cancelled')),
  idempotency_key       text          NOT NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_billing_period_dates CHECK (billing_period_end >= billing_period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_billing_period
  ON public.contract_billing_schedules (contract_id, billing_period_start, billing_period_end);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_billing_idempotency
  ON public.contract_billing_schedules (company_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_contract_billing_due
  ON public.contract_billing_schedules (company_id, billing_date, status);

CREATE TRIGGER set_contract_billing_schedules_updated_at
  BEFORE UPDATE ON public.contract_billing_schedules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('contract_billing_schedules');

-- ---------------------------------------------------------------------------
-- 7. Extend Table: amc_schedules
-- ---------------------------------------------------------------------------
ALTER TABLE public.amc_schedules
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_asset_id uuid REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'preventive'
    CHECK (schedule_type IN ('preventive', 'inspection', 'calibration', 'routine', 'custom')),
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'quarterly',
  ADD COLUMN IF NOT EXISTS interval_days integer,
  ADD COLUMN IF NOT EXISTS last_completed_date date,
  ADD COLUMN IF NOT EXISTS assigned_technician_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority public.work_order_priority NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS checklist_id uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_amc_schedules_asset
  ON public.amc_schedules (customer_asset_id) WHERE customer_asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. Extend Table: work_orders & work_order_lines
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_asset_id uuid REFERENCES public.amc_contract_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maintenance_schedule_id uuid REFERENCES public.amc_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coverage_status text NOT NULL DEFAULT 'billable'
    CHECK (coverage_status IN ('covered', 'partially_covered', 'billable', 'out_of_scope'));

CREATE INDEX IF NOT EXISTS idx_work_orders_contract
  ON public.work_orders (contract_id) WHERE contract_id IS NOT NULL;

ALTER TABLE public.work_order_lines
  ADD COLUMN IF NOT EXISTS coverage_status text NOT NULL DEFAULT 'billable'
    CHECK (coverage_status IN ('covered', 'partially_covered', 'billable', 'out_of_scope')),
  ADD COLUMN IF NOT EXISTS covered_amount numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (covered_amount >= 0),
  ADD COLUMN IF NOT EXISTS billable_amount numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (billable_amount >= 0);

-- ---------------------------------------------------------------------------
-- 9. RPC: convert_quotation_to_contract
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_quotation_to_contract(
  p_quotation_id uuid,
  p_contract_type text DEFAULT 'amc',
  p_billing_frequency text DEFAULT 'quarterly',
  p_service_frequency text DEFAULT 'quarterly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote RECORD;
  v_contract_id uuid;
  v_contract_number text;
  v_start_date date;
  v_end_date date;
  v_now timestamptz := now();
  v_existing_id uuid;
BEGIN
  SELECT * INTO v_quote
  FROM public.quotations
  WHERE id = p_quotation_id;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_quote.status NOT IN ('approved', 'accepted') THEN
    RAISE EXCEPTION 'Quotation % must be approved or accepted before converting to contract (current: %)',
      p_quotation_id, v_quote.status USING ERRCODE = '22000';
  END IF;

  -- Idempotency check: check if already converted
  SELECT id INTO v_existing_id
  FROM public.amc_contracts
  WHERE quotation_id = p_quotation_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_converted', true,
      'contract_id', v_existing_id
    );
  END IF;

  v_start_date := CURRENT_DATE;
  v_end_date := v_start_date + INTERVAL '1 year';

  -- Create Contract
  INSERT INTO public.amc_contracts (
    company_id, branch_id, customer_id, site_id,
    start_date, end_date, contract_value, tax_amount,
    billing_frequency, service_frequency,
    contract_type, currency, status, quotation_id,
    notes, created_by, created_at, updated_at
  ) VALUES (
    v_quote.company_id, v_quote.branch_id, v_quote.customer_id, v_quote.site_id,
    v_start_date, v_end_date, v_quote.subtotal, v_quote.tax_amount,
    p_billing_frequency, p_service_frequency,
    p_contract_type, v_quote.currency, 'draft', p_quotation_id,
    'Converted from Quotation ' || v_quote.quotation_number,
    auth.uid(), v_now, v_now
  )
  RETURNING id, contract_number INTO v_contract_id, v_contract_number;

  RETURN jsonb_build_object(
    'success', true,
    'contract_id', v_contract_id,
    'contract_number', v_contract_number,
    'contract_type', p_contract_type,
    'contract_value', v_quote.subtotal,
    'total_amount', v_quote.grand_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: record_entitlement_usage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_entitlement_usage(
  p_contract_id uuid,
  p_type text,
  p_amount numeric,
  p_asset_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ent RECORD;
  v_new_used numeric(14,3);
  v_exceeded boolean := false;
  v_excess numeric(14,3) := 0.000;
BEGIN
  SELECT * INTO v_ent
  FROM public.contract_entitlements
  WHERE contract_id = p_contract_id
    AND entitlement_type = p_type
    AND (
      (p_asset_id IS NULL AND contract_asset_id IS NULL) OR
      (contract_asset_id = p_asset_id)
    )
  FOR UPDATE;

  IF v_ent.id IS NULL THEN
    -- Fallback check for contract-wide entitlement
    SELECT * INTO v_ent
    FROM public.contract_entitlements
    WHERE contract_id = p_contract_id
      AND entitlement_type = p_type
      AND contract_asset_id IS NULL
    FOR UPDATE;
  END IF;

  IF v_ent.id IS NULL THEN
    RETURN jsonb_build_object(
      'has_entitlement', false,
      'is_covered', false,
      'reason', 'No entitlement configured for ' || p_type
    );
  END IF;

  v_new_used := v_ent.used_quantity + p_amount;

  IF v_new_used > v_ent.total_entitled THEN
    v_exceeded := true;
    v_excess := v_new_used - v_ent.total_entitled;

    IF v_ent.limit_action = 'reject_coverage' THEN
      RETURN jsonb_build_object(
        'has_entitlement', true,
        'is_covered', false,
        'limit_exceeded', true,
        'limit_action', 'reject_coverage',
        'remaining', v_ent.remaining_quantity,
        'excess', v_excess
      );
    END IF;
  END IF;

  UPDATE public.contract_entitlements
  SET
    used_quantity = v_new_used,
    updated_at = now()
  WHERE id = v_ent.id;

  RETURN jsonb_build_object(
    'has_entitlement', true,
    'is_covered', NOT v_exceeded OR v_ent.limit_action = 'convert_to_billable',
    'limit_exceeded', v_exceeded,
    'limit_action', v_ent.limit_action,
    'previous_used', v_ent.used_quantity,
    'new_used', v_new_used,
    'total_entitled', v_ent.total_entitled,
    'remaining', GREATEST(v_ent.total_entitled - v_new_used, 0.000),
    'excess_billable', v_excess
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. RPC: calculate_contract_coverage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_contract_coverage(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo RECORD;
  v_contract RECORD;
  v_asset RECORD;
  v_coverage_type text := 'billable';
  v_is_covered boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_wo
  FROM public.work_orders
  WHERE id = p_work_order_id;

  IF v_wo.id IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', p_work_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_wo.contract_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_covered', false,
      'coverage_status', 'billable',
      'reason', 'Work order is not linked to any service contract'
    );
  END IF;

  SELECT * INTO v_contract
  FROM public.amc_contracts
  WHERE id = v_wo.contract_id;

  IF v_contract.status <> 'active' THEN
    RETURN jsonb_build_object(
      'is_covered', false,
      'coverage_status', 'billable',
      'reason', 'Contract ' || v_contract.contract_number || ' is not active (status: ' || v_contract.status || ')'
    );
  END IF;

  IF CURRENT_DATE < v_contract.start_date OR CURRENT_DATE > v_contract.end_date THEN
    RETURN jsonb_build_object(
      'is_covered', false,
      'coverage_status', 'billable',
      'reason', 'Current date is outside contract active coverage period'
    );
  END IF;

  -- Check asset coverage if work order targets a specific asset
  IF v_wo.asset_id IS NOT NULL THEN
    SELECT * INTO v_asset
    FROM public.amc_contract_assets
    WHERE amc_contract_id = v_contract.id
      AND customer_asset_id = v_wo.asset_id
      AND is_active = true;

    IF v_asset.id IS NULL THEN
      RETURN jsonb_build_object(
        'is_covered', false,
        'coverage_status', 'billable',
        'reason', 'Asset is not covered under contract ' || v_contract.contract_number
      );
    END IF;

    v_coverage_type := v_asset.coverage_type;
  ELSE
    v_coverage_type := 'full_service';
  END IF;

  -- Determine coverage based on coverage_type
  IF v_coverage_type = 'full_service' OR v_coverage_type = 'parts_and_labor' THEN
    v_is_covered := true;
  ELSIF v_coverage_type = 'preventive_only' THEN
    v_is_covered := (v_wo.source = 'amc' OR v_wo.source = 'preventive');
  ELSIF v_coverage_type = 'breakdown_only' THEN
    v_is_covered := (v_wo.source = 'service_request');
  ELSE
    v_is_covered := true;
  END IF;

  RETURN jsonb_build_object(
    'is_covered', v_is_covered,
    'coverage_status', CASE WHEN v_is_covered THEN 'covered' ELSE 'billable' END,
    'coverage_type', v_coverage_type,
    'contract_id', v_contract.id,
    'contract_number', v_contract.contract_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. RPC: generate_recurring_contract_invoices
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_recurring_contract_invoices(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sched RECORD;
  v_contract RECORD;
  v_inv_id uuid;
  v_inv_number text;
  v_count integer := 0;
  v_now timestamptz := now();
BEGIN
  FOR v_sched IN
    SELECT bs.*, c.contract_number, c.currency, c.customer_id, c.site_id, c.branch_id
    FROM public.contract_billing_schedules bs
    JOIN public.amc_contracts c ON c.id = bs.contract_id
    WHERE bs.status = 'unbilled'
      AND bs.billing_date <= p_date
      AND c.status = 'active'
    FOR UPDATE OF bs
  LOOP
    -- Create Phase 2B Invoice
    INSERT INTO public.invoices (
      company_id, branch_id, customer_id, site_id,
      invoice_date, due_date, currency, subtotal,
      taxable_amount, tax_amount, grand_total,
      status, notes, created_by, created_at, updated_at
    ) VALUES (
      v_sched.company_id, v_sched.branch_id, v_sched.customer_id, v_sched.site_id,
      v_sched.billing_date, v_sched.billing_date + INTERVAL '30 days',
      v_sched.currency, v_sched.amount, v_sched.amount, v_sched.tax_amount,
      v_sched.total_amount, 'issued',
      'Contract Recurring Billing: ' || v_sched.contract_number || ' (' || v_sched.period_label || ')',
      auth.uid(), v_now, v_now
    )
    RETURNING id, invoice_number INTO v_inv_id, v_inv_number;

    -- Create invoice line item
    INSERT INTO public.invoice_lines (
      invoice_id, line_type, description, quantity, unit_price,
      subtotal, tax_rate, tax_amount, total_amount
    ) VALUES (
      v_inv_id, 'service',
      'Contract Maintenance Installment #' || v_sched.installment_number || ' (' || v_sched.period_label || ') - ' || v_sched.contract_number,
      1.0000, v_sched.amount, v_sched.amount,
      CASE WHEN v_sched.amount > 0 THEN ROUND((v_sched.tax_amount / v_sched.amount) * 100, 2) ELSE 0.00 END,
      v_sched.tax_amount, v_sched.total_amount
    );

    -- Mark billing schedule as billed
    UPDATE public.contract_billing_schedules
    SET
      status = 'billed',
      invoice_id = v_inv_id,
      updated_at = v_now
    WHERE id = v_sched.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'invoices_generated', v_count,
    'as_of_date', p_date
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. RPC: get_contract_profitability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_contract_profitability(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_revenue numeric(14,3) := 0.000;
  v_parts_cost numeric(14,3) := 0.000;
  v_labor_cost numeric(14,3) := 0.000;
  v_other_cost numeric(14,3) := 0.000;
  v_total_cost numeric(14,3) := 0.000;
  v_margin numeric(14,3) := 0.000;
  v_margin_pct numeric(8,2) := 0.00;
BEGIN
  SELECT * INTO v_contract
  FROM public.amc_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  v_revenue := v_contract.contract_value;

  -- Sum parts costs from stock ledger issues on this contract's work orders
  SELECT COALESCE(SUM(ABS(sl.total_cost)), 0.000) INTO v_parts_cost
  FROM public.stock_ledger sl
  JOIN public.work_orders wo ON wo.id = sl.work_order_id
  WHERE wo.contract_id = p_contract_id
    AND sl.transaction_type IN ('issue', 'adjustment_out');

  -- Sum labor costs from timesheets (duration in minutes / 60 * standard technician cost 250 INR/hr)
  SELECT COALESCE(SUM((ts.duration_minutes / 60.0) * 250.0), 0.000) INTO v_labor_cost
  FROM public.timesheets ts
  JOIN public.work_orders wo ON wo.id = ts.work_order_id
  WHERE wo.contract_id = p_contract_id;

  -- Sum expenses charged to contract work orders
  SELECT COALESCE(SUM(e.amount), 0.000) INTO v_other_cost
  FROM public.expenses e
  JOIN public.work_orders wo ON wo.id = e.work_order_id
  WHERE wo.contract_id = p_contract_id
    AND e.status IN ('approved', 'posted');

  v_total_cost := v_parts_cost + v_labor_cost + v_other_cost;
  v_margin := v_revenue - v_total_cost;

  IF v_revenue > 0 THEN
    v_margin_pct := ROUND((v_margin / v_revenue) * 100, 2);
  ELSE
    v_margin_pct := 0.00;
  END IF;

  RETURN jsonb_build_object(
    'contract_id', p_contract_id,
    'contract_number', v_contract.contract_number,
    'contract_value', v_revenue,
    'parts_cost', v_parts_cost,
    'labor_cost', v_labor_cost,
    'expenses_cost', v_other_cost,
    'total_direct_cost', v_total_cost,
    'gross_margin', v_margin,
    'margin_percentage', v_margin_pct
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. Row Level Security Policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_slas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_billing_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_contract_entitlements_org
  ON public.contract_entitlements
  FOR ALL
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY rls_contract_slas_org
  ON public.contract_slas
  FOR ALL
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY rls_contract_billing_schedules_org
  ON public.contract_billing_schedules
  FOR ALL
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());
