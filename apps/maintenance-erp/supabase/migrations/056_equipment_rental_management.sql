-- =============================================================================
-- Migration 056: Phase 5 Equipment Rental / Asset Rental Management
-- Maintenance Management ERP
-- =============================================================================
-- Features:
--   1. Enums extension (rental_asset_status, rental_contract_status, damage & deposit types)
--   2. rental_assets extensions: ownership_type, registration_number, customer_asset_id,
--      metering rates & allowances, maintenance thresholds, turnaround buffer
--   3. rental_contracts extensions: quotation_id, deposit balances, pickup/delivery info
--   4. rental_contract_lines extensions: meter allowances, rates, deposit amounts
--   5. rental_extensions: rental extension requests, rate adjustments, approval workflow
--   6. rental_damage_assessments: return damage logging, photo proof, repair WO link, cost recovery
--   7. rental_security_deposits: deposit ledger (receipt, refund, adjustment, forfeiture, GL link)
--   8. rental_location_movements: immutable audit trail of fleet equipment movements
--   9. Transactional RPCs:
--      - check_rental_asset_availability
--      - dispatch_rental_asset_v2
--      - return_rental_asset_v2
--      - request_rental_extension
--      - approve_rental_extension
--      - record_rental_deposit_action
--      - assess_rental_damage
--      - calculate_rental_charges_v2
--      - generate_rental_invoice_v2
--      - get_rental_fleet_utilization
--  10. Security: Multi-tenant RLS policies and audit triggers

-- ---------------------------------------------------------------------------
-- 1. Extend Status ENUMs & Document Types
-- ---------------------------------------------------------------------------
ALTER TYPE public.rental_asset_status ADD VALUE IF NOT EXISTS 'return_pending';
ALTER TYPE public.rental_asset_status ADD VALUE IF NOT EXISTS 'lost';

ALTER TYPE public.rental_contract_status ADD VALUE IF NOT EXISTS 'quoted';
ALTER TYPE public.rental_contract_status ADD VALUE IF NOT EXISTS 'extension_requested';
ALTER TYPE public.rental_contract_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.rental_contract_status ADD VALUE IF NOT EXISTS 'overdue';

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'RDM'; -- Rental Damage Assessment
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'DEP'; -- Rental Deposit Receipt

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_damage_type') THEN
    CREATE TYPE public.rental_damage_type AS ENUM (
      'mechanical', 'electrical', 'structural', 'cosmetic', 'missing_parts', 'total_loss'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_damage_severity') THEN
    CREATE TYPE public.rental_damage_severity AS ENUM (
      'minor', 'moderate', 'severe', 'total_loss'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_responsibility') THEN
    CREATE TYPE public.rental_responsibility AS ENUM (
      'full', 'partial', 'waived', 'disputed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_deposit_action') THEN
    CREATE TYPE public.rental_deposit_action AS ENUM (
      'receipt', 'refund', 'damage_deduction', 'rent_adjustment', 'forfeiture'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Extend Table: rental_assets
-- ---------------------------------------------------------------------------
ALTER TABLE public.rental_assets
  ADD COLUMN IF NOT EXISTS ownership_type text NOT NULL DEFAULT 'owned'
    CHECK (ownership_type IN ('owned', 'leased', 'third_party')),
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS customer_asset_id uuid REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meter_unit text NOT NULL DEFAULT 'hours',
  ADD COLUMN IF NOT EXISTS meter_rate_per_unit numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (meter_rate_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS included_units_per_day numeric(12,2) NOT NULL DEFAULT 8.00 CHECK (included_units_per_day >= 0),
  ADD COLUMN IF NOT EXISTS maintenance_interval_units numeric(12,2),
  ADD COLUMN IF NOT EXISTS last_maintenance_meter numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (last_maintenance_meter >= 0),
  ADD COLUMN IF NOT EXISTS turnaround_buffer_days integer NOT NULL DEFAULT 1 CHECK (turnaround_buffer_days >= 0);

CREATE INDEX IF NOT EXISTS idx_rental_assets_customer_asset ON public.rental_assets (customer_asset_id) WHERE customer_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rental_assets_ownership ON public.rental_assets (company_id, ownership_type);

-- ---------------------------------------------------------------------------
-- 3. Extend Table: rental_contracts
-- ---------------------------------------------------------------------------
ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'pending'
    CHECK (deposit_status IN ('pending', 'received', 'held', 'partially_refunded', 'fully_refunded', 'adjusted', 'forfeited')),
  ADD COLUMN IF NOT EXISTS deposit_held numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (deposit_held >= 0),
  ADD COLUMN IF NOT EXISTS deposit_refunded numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (deposit_refunded >= 0),
  ADD COLUMN IF NOT EXISTS deposit_adjusted numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (deposit_adjusted >= 0),
  ADD COLUMN IF NOT EXISTS pickup_delivery_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_tier text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_rental_contracts_quotation ON public.rental_contracts (quotation_id) WHERE quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rental_contracts_deposit_status ON public.rental_contracts (company_id, deposit_status);

-- ---------------------------------------------------------------------------
-- 4. Extend Table: rental_contract_lines
-- ---------------------------------------------------------------------------
ALTER TABLE public.rental_contract_lines
  ADD COLUMN IF NOT EXISTS meter_included_units numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (meter_included_units >= 0),
  ADD COLUMN IF NOT EXISTS meter_rate_per_unit numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (meter_rate_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (deposit_amount >= 0);

-- ---------------------------------------------------------------------------
-- 5. New Table: rental_extensions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_extensions (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rental_contract_id  uuid          NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  original_end_date   date          NOT NULL,
  extended_end_date   date          NOT NULL,
  additional_days     integer       NOT NULL CHECK (additional_days > 0),
  rate_type           text          NOT NULL DEFAULT 'daily',
  unit_rate           numeric(14,3) NOT NULL CHECK (unit_rate >= 0),
  additional_charge   numeric(14,3) NOT NULL CHECK (additional_charge >= 0),
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  status              text          NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  requested_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  rejection_reason    text,
  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_rental_extension_dates CHECK (extended_end_date > original_end_date)
);

CREATE INDEX IF NOT EXISTS idx_rental_extensions_contract ON public.rental_extensions (rental_contract_id, status);

CREATE TRIGGER set_rental_extensions_updated_at
  BEFORE UPDATE ON public.rental_extensions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Attach audit trigger
SELECT public.attach_audit_trigger('rental_extensions');

-- ---------------------------------------------------------------------------
-- 6. New Table: rental_damage_assessments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_damage_assessments (
  id                      uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rental_contract_id      uuid                          NOT NULL REFERENCES public.rental_contracts(id) ON DELETE RESTRICT,
  rental_return_id        uuid                          NOT NULL REFERENCES public.rental_returns(id) ON DELETE RESTRICT,
  rental_asset_id         uuid                          NOT NULL REFERENCES public.rental_assets(id) ON DELETE RESTRICT,
  assessment_number       text                          NOT NULL,
  incident_date           date                          NOT NULL DEFAULT CURRENT_DATE,
  damage_type             public.rental_damage_type     NOT NULL,
  severity                public.rental_damage_severity NOT NULL,
  description             text                          NOT NULL,
  photos                  text[]                        DEFAULT ARRAY[]::text[],
  estimated_repair_cost   numeric(14,3)                 NOT NULL DEFAULT 0.000 CHECK (estimated_repair_cost >= 0),
  actual_repair_cost      numeric(14,3)                 NOT NULL DEFAULT 0.000 CHECK (actual_repair_cost >= 0),
  customer_responsibility public.rental_responsibility  NOT NULL DEFAULT 'full',
  approved_charge         numeric(14,3)                 NOT NULL DEFAULT 0.000 CHECK (approved_charge >= 0),
  repair_work_order_id    uuid                          REFERENCES public.work_orders(id) ON DELETE SET NULL,
  status                  text                          NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'under_review', 'approved', 'charged', 'waived')),
  assessed_by             uuid                          REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_by             uuid                          REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  created_at              timestamptz                   NOT NULL DEFAULT now(),
  updated_at              timestamptz                   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_damage_number ON public.rental_damage_assessments (company_id, assessment_number);
CREATE INDEX IF NOT EXISTS idx_rental_damage_contract ON public.rental_damage_assessments (rental_contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_damage_asset ON public.rental_damage_assessments (rental_asset_id, status);

CREATE TRIGGER set_rental_damage_updated_at
  BEFORE UPDATE ON public.rental_damage_assessments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Damage Assessment Number (RDM-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_rental_damage_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.assessment_number IS NULL OR trim(NEW.assessment_number) = '' THEN
    NEW.assessment_number := public.generate_document_number(
      NEW.company_id,
      'RDM'::public.document_type,
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rental_damage_auto_number
  BEFORE INSERT ON public.rental_damage_assessments
  FOR EACH ROW EXECUTE FUNCTION public.handle_rental_damage_before_insert();

SELECT public.attach_audit_trigger('rental_damage_assessments');

-- ---------------------------------------------------------------------------
-- 7. New Table: rental_security_deposits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_security_deposits (
  id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rental_contract_id  uuid                        NOT NULL REFERENCES public.rental_contracts(id) ON DELETE RESTRICT,
  transaction_type    public.rental_deposit_action NOT NULL,
  amount              numeric(14,3)               NOT NULL CHECK (amount > 0),
  payment_method      text                        NOT NULL DEFAULT 'bank_transfer',
  payment_reference   text,
  journal_entry_id    uuid                        REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes               text,
  created_by          uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_deposits_contract ON public.rental_security_deposits (rental_contract_id, transaction_type);
SELECT public.attach_audit_trigger('rental_security_deposits');

-- ---------------------------------------------------------------------------
-- 8. New Table: rental_location_movements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_location_movements (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rental_asset_id       uuid        NOT NULL REFERENCES public.rental_assets(id) ON DELETE RESTRICT,
  rental_contract_id    uuid        REFERENCES public.rental_contracts(id) ON DELETE SET NULL,
  movement_type         text        NOT NULL CHECK (movement_type IN ('dispatch', 'return', 'transfer', 'to_maintenance', 'from_maintenance')),
  from_location_id      uuid        REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id        uuid        REFERENCES public.locations(id) ON DELETE SET NULL,
  from_site_id          uuid        REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  to_site_id            uuid        REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  meter_reading         numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (meter_reading >= 0),
  moved_by              uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  movement_date         timestamptz NOT NULL DEFAULT now(),
  notes                 text
);

CREATE INDEX IF NOT EXISTS idx_rental_movements_asset ON public.rental_location_movements (rental_asset_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_rental_movements_contract ON public.rental_location_movements (rental_contract_id);

-- ---------------------------------------------------------------------------
-- 9. RPC: check_rental_asset_availability()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rental_asset_availability(
  p_asset_id uuid,
  p_start_date date,
  p_end_date date,
  p_buffer_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_buffer integer;
  v_overlap_res RECORD;
  v_overlap_cnt integer := 0;
BEGIN
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'reason', 'Invalid date range: end_date cannot be before start_date'
    );
  END IF;

  SELECT * INTO v_asset
  FROM public.rental_assets
  WHERE id = p_asset_id;

  IF v_asset.id IS NULL THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'reason', 'Rental asset not found'
    );
  END IF;

  IF v_asset.rental_status IN ('maintenance', 'damaged', 'retired', 'lost') THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'reason', 'Asset is currently in non-rentable status: ' || v_asset.rental_status::text
    );
  END IF;

  v_buffer := COALESCE(p_buffer_days, v_asset.turnaround_buffer_days, 1);

  -- Check confirmed reservations with turnaround buffer
  SELECT COUNT(*), max(rr.id)::text, max(rr.start_date)::text, max(rr.end_date)::text
  INTO v_overlap_cnt, v_overlap_res
  FROM public.rental_reservations rr
  WHERE rr.rental_asset_id = p_asset_id
    AND rr.status = 'confirmed'
    AND (p_start_date <= (rr.end_date + v_buffer) AND p_end_date >= (rr.start_date - v_buffer));

  IF v_overlap_cnt > 0 THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'reason', 'Asset has an overlapping confirmed reservation with turnaround buffer',
      'conflicting_reservation_count', v_overlap_cnt
    );
  END IF;

  -- Check active contract expected return date if currently on rent
  IF v_asset.rental_status IN ('out_for_rental', 'return_pending') THEN
    IF EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      JOIN public.rental_contract_lines rcl ON rcl.rental_contract_id = rc.id
      WHERE rcl.rental_asset_id = p_asset_id
        AND rc.status IN ('active', 'return_pending', 'overdue')
        AND (p_start_date <= (rc.expected_return_date + v_buffer))
    ) THEN
      RETURN jsonb_build_object(
        'is_available', false,
        'reason', 'Asset is currently on active rent and expected return date conflicts with requested start'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'is_available', true,
    'asset_id', p_asset_id,
    'asset_code', v_asset.asset_code,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'buffer_days', v_buffer
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: dispatch_rental_asset_v2()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_rental_asset_v2(
  p_contract_id uuid,
  p_asset_id uuid,
  p_meter_reading numeric,
  p_condition text DEFAULT 'good',
  p_signature_url text DEFAULT NULL,
  p_photos text[] DEFAULT ARRAY[]::text[],
  p_notes text DEFAULT NULL,
  p_carrier_info jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_asset RECORD;
  v_delivery_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, customer_id, site_id, status INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id, asset_code, current_location_id, rental_status INTO v_asset
  FROM public.rental_assets
  WHERE id = p_asset_id;

  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION 'Rental asset % not found', p_asset_id USING ERRCODE = 'P0002';
  END IF;

  -- Create delivery record
  INSERT INTO public.rental_deliveries (
    rental_contract_id, rental_asset_id, delivery_date, meter_reading,
    condition, customer_signature_url, photos, notes
  ) VALUES (
    p_contract_id, p_asset_id, v_now, p_meter_reading,
    p_condition, p_signature_url, p_photos, p_notes
  )
  RETURNING id INTO v_delivery_id;

  -- Log physical movement
  INSERT INTO public.rental_location_movements (
    company_id, rental_asset_id, rental_contract_id, movement_type,
    from_location_id, to_site_id, meter_reading, notes
  ) VALUES (
    v_contract.company_id, p_asset_id, p_contract_id, 'dispatch',
    v_asset.current_location_id, v_contract.site_id, p_meter_reading,
    COALESCE(p_notes, 'Equipment dispatched to customer jobsite')
  );

  -- Update asset status
  UPDATE public.rental_assets
  SET
    rental_status = 'out_for_rental',
    current_customer_id = v_contract.customer_id,
    current_site_id = v_contract.site_id,
    meter_reading = p_meter_reading,
    condition = p_condition,
    updated_at = v_now
  WHERE id = p_asset_id;

  -- Update contract status to active and store carrier info if provided
  UPDATE public.rental_contracts
  SET
    status = 'active',
    pickup_delivery_info = CASE
      WHEN p_carrier_info IS NOT NULL AND p_carrier_info <> '{}'::jsonb
      THEN pickup_delivery_info || p_carrier_info
      ELSE pickup_delivery_info
    END,
    updated_at = v_now
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_delivery_id,
    'asset_code', v_asset.asset_code,
    'meter_reading', p_meter_reading,
    'status', 'out_for_rental'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. RPC: return_rental_asset_v2()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_rental_asset_v2(
  p_contract_id uuid,
  p_asset_id uuid,
  p_meter_reading numeric,
  p_condition text DEFAULT 'good',
  p_cleaning_required boolean DEFAULT false,
  p_damage_notes text DEFAULT NULL,
  p_damage_charge numeric DEFAULT 0.000,
  p_cleaning_charge numeric DEFAULT 0.000,
  p_photos text[] DEFAULT ARRAY[]::text[],
  p_notes text DEFAULT NULL,
  p_return_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_asset RECORD;
  v_line RECORD;
  v_delivery RECORD;
  v_return_id uuid;
  v_now timestamptz := now();
  v_meter_diff numeric(12,2) := 0.00;
  v_rental_days integer;
  v_allowed_units numeric(12,2);
  v_excess_units numeric(12,2) := 0.00;
  v_excess_meter_charge numeric(14,3) := 0.000;
  v_extra_days integer := 0;
  v_extra_day_charge numeric(14,3) := 0.000;
  v_final_cleaning_charge numeric(14,3) := 0.000;
  v_total_charges numeric(14,3) := 0.000;
  v_target_status public.rental_asset_status := 'available';
  v_unreturned_count integer;
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_asset
  FROM public.rental_assets
  WHERE id = p_asset_id;

  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION 'Rental asset % not found', p_asset_id USING ERRCODE = 'P0002';
  END IF;

  -- Meter calculation
  v_meter_diff := GREATEST(p_meter_reading - v_asset.meter_reading, 0.00);

  -- Retrieve contract line configuration
  SELECT * INTO v_line
  FROM public.rental_contract_lines
  WHERE rental_contract_id = p_contract_id AND rental_asset_id = p_asset_id
  ORDER BY created_at DESC LIMIT 1;

  -- Calculate included units and excess meter charges
  v_rental_days := GREATEST(CURRENT_DATE - v_contract.start_date, 1);
  v_allowed_units := COALESCE(v_asset.included_units_per_day, 8.00) * v_rental_days;
  IF v_meter_diff > v_allowed_units AND v_asset.meter_rate_per_unit > 0 THEN
    v_excess_units := v_meter_diff - v_allowed_units;
    v_excess_meter_charge := v_excess_units * v_asset.meter_rate_per_unit;
  END IF;

  -- Calculate overdue extra days
  IF CURRENT_DATE > v_contract.expected_return_date THEN
    v_extra_days := CURRENT_DATE - v_contract.expected_return_date;
    v_extra_day_charge := v_extra_days * COALESCE(v_asset.daily_rate, 0.000);
  END IF;

  -- Cleaning charge
  IF p_cleaning_required OR p_cleaning_charge > 0 THEN
    v_final_cleaning_charge := GREATEST(p_cleaning_charge, 50.000);
  END IF;

  -- Create return record
  INSERT INTO public.rental_returns (
    rental_contract_id, rental_asset_id, return_date, meter_reading,
    meter_difference, condition, damage_notes, damage_charge,
    cleaning_charge, extra_day_charge, photos, notes
  ) VALUES (
    p_contract_id, p_asset_id, v_now, p_meter_reading,
    v_meter_diff, p_condition, p_damage_notes, p_damage_charge,
    v_final_cleaning_charge, v_extra_day_charge, p_photos, p_notes
  )
  RETURNING id INTO v_return_id;

  -- Record extra charges in rental_charges
  IF v_excess_meter_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'excess_meter', 'Excess meter usage: ' || v_excess_units || ' ' || v_asset.meter_unit, v_excess_meter_charge);
  END IF;

  IF v_extra_day_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'extra_days', 'Overdue extra days (' || v_extra_days || ' days)', v_extra_day_charge);
  END IF;

  IF v_final_cleaning_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'cleaning', 'Equipment cleaning and decontamination', v_final_cleaning_charge);
  END IF;

  IF p_damage_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'damage', COALESCE(p_damage_notes, 'Return damage charge'), p_damage_charge);
  END IF;

  -- Log location movement back to yard
  INSERT INTO public.rental_location_movements (
    company_id, rental_asset_id, rental_contract_id, movement_type,
    from_site_id, to_location_id, meter_reading, notes
  ) VALUES (
    v_contract.company_id, p_asset_id, p_contract_id, 'return',
    v_contract.site_id, COALESCE(p_return_location_id, v_asset.current_location_id),
    p_meter_reading, COALESCE(p_notes, 'Equipment returned from customer site')
  );

  -- Determine next asset status
  IF p_damage_charge > 0 OR p_condition IN ('damaged', 'needs_repair') THEN
    v_target_status := 'under_inspection';
  ELSIF v_asset.maintenance_interval_units IS NOT NULL AND
        (p_meter_reading - v_asset.last_maintenance_meter) >= v_asset.maintenance_interval_units THEN
    v_target_status := 'maintenance';
  ELSE
    v_target_status := 'available';
  END IF;

  UPDATE public.rental_assets
  SET
    rental_status = v_target_status,
    current_customer_id = NULL,
    current_site_id = NULL,
    current_location_id = COALESCE(p_return_location_id, current_location_id),
    meter_reading = p_meter_reading,
    condition = p_condition,
    updated_at = v_now
  WHERE id = p_asset_id;

  -- Fulfill reservation
  UPDATE public.rental_reservations
  SET status = 'fulfilled'
  WHERE rental_contract_id = p_contract_id AND rental_asset_id = p_asset_id;

  -- Check if other assets remain on contract
  SELECT COUNT(*) INTO v_unreturned_count
  FROM public.rental_contract_lines rcl
  LEFT JOIN public.rental_returns rr ON rr.rental_contract_id = rcl.rental_contract_id AND rr.rental_asset_id = rcl.rental_asset_id
  WHERE rcl.rental_contract_id = p_contract_id AND rr.id IS NULL;

  IF v_unreturned_count = 0 THEN
    UPDATE public.rental_contracts
    SET
      actual_return_date = CURRENT_DATE,
      status = 'returned',
      updated_at = v_now
    WHERE id = p_contract_id;
  END IF;

  v_total_charges := v_excess_meter_charge + v_extra_day_charge + v_final_cleaning_charge + p_damage_charge;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'meter_difference', v_meter_diff,
    'excess_meter_charge', v_excess_meter_charge,
    'extra_day_charge', v_extra_day_charge,
    'cleaning_charge', v_final_cleaning_charge,
    'damage_charge', p_damage_charge,
    'total_extra_charges', v_total_charges,
    'asset_status', v_target_status::text
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. RPC: request_rental_extension()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_rental_extension(
  p_contract_id uuid,
  p_extended_end_date date,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_days integer;
  v_line RECORD;
  v_charge numeric(14,3) := 0.000;
  v_tax numeric(14,3) := 0.000;
  v_ext_id uuid;
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  IF p_extended_end_date <= v_contract.expected_return_date THEN
    RAISE EXCEPTION 'extended_end_date must be strictly after current expected return date %',
      v_contract.expected_return_date USING ERRCODE = '22000';
  END IF;

  v_days := p_extended_end_date - v_contract.expected_return_date;

  -- Calculate additional charge based on primary contract line rate
  SELECT * INTO v_line
  FROM public.rental_contract_lines
  WHERE rental_contract_id = p_contract_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_line.id IS NOT NULL THEN
    v_charge := v_days * v_line.unit_rate;
    v_tax := round(v_charge * (COALESCE(v_line.tax_rate, 5.00) / 100.0), 3);
  END IF;

  INSERT INTO public.rental_extensions (
    company_id, rental_contract_id, original_end_date,
    extended_end_date, additional_days, rate_type,
    unit_rate, additional_charge, tax_amount, status,
    requested_by, notes
  ) VALUES (
    v_contract.company_id, p_contract_id, v_contract.expected_return_date,
    p_extended_end_date, v_days, COALESCE(v_line.rate_type, 'daily'),
    COALESCE(v_line.unit_rate, 0.000), v_charge, v_tax, 'requested',
    auth.uid(), p_notes
  )
  RETURNING id INTO v_ext_id;

  UPDATE public.rental_contracts
  SET status = 'extension_requested', updated_at = now()
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'extension_id', v_ext_id,
    'additional_days', v_days,
    'additional_charge', v_charge,
    'tax_amount', v_tax
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. RPC: approve_rental_extension()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_rental_extension(
  p_extension_id uuid,
  p_approved_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ext RECORD;
  v_contract RECORD;
BEGIN
  SELECT * INTO v_ext
  FROM public.rental_extensions
  WHERE id = p_extension_id;

  IF v_ext.id IS NULL THEN
    RAISE EXCEPTION 'Rental extension % not found', p_extension_id USING ERRCODE = 'P0002';
  END IF;

  IF v_ext.status <> 'requested' THEN
    RAISE EXCEPTION 'Rental extension is already in status %', v_ext.status USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = v_ext.rental_contract_id;

  -- Update extension status
  UPDATE public.rental_extensions
  SET
    status = 'approved',
    approved_by = COALESCE(p_approved_by, auth.uid()),
    approved_at = now(),
    updated_at = now()
  WHERE id = p_extension_id;

  -- Update contract expected return date and totals
  UPDATE public.rental_contracts
  SET
    expected_return_date = v_ext.extended_end_date,
    subtotal = subtotal + v_ext.additional_charge,
    tax_amount = tax_amount + v_ext.tax_amount,
    grand_total = grand_total + v_ext.additional_charge + v_ext.tax_amount,
    status = 'active',
    updated_at = now()
  WHERE id = v_ext.rental_contract_id;

  -- Add rental charge record for the extension
  INSERT INTO public.rental_charges (
    rental_contract_id, charge_type, description, amount, tax_amount
  ) VALUES (
    v_ext.rental_contract_id, 'rental_extension',
    'Rental Extension for ' || v_ext.additional_days || ' days until ' || v_ext.extended_end_date::text,
    v_ext.additional_charge, v_ext.tax_amount
  );

  -- Update reservation end dates
  UPDATE public.rental_reservations
  SET end_date = v_ext.extended_end_date
  WHERE rental_contract_id = v_ext.rental_contract_id AND status = 'confirmed';

  RETURN jsonb_build_object(
    'success', true,
    'extension_id', p_extension_id,
    'contract_id', v_ext.rental_contract_id,
    'new_expected_return_date', v_ext.extended_end_date,
    'status', 'approved'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. RPC: record_rental_deposit_action()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_rental_deposit_action(
  p_contract_id uuid,
  p_action public.rental_deposit_action,
  p_amount numeric,
  p_payment_method text DEFAULT 'bank_transfer',
  p_payment_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_deposit_id uuid;
  v_new_held numeric(14,3);
  v_new_refunded numeric(14,3);
  v_new_adjusted numeric(14,3);
  v_new_status text;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit transaction amount must be strictly positive' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  v_new_held := v_contract.deposit_held;
  v_new_refunded := v_contract.deposit_refunded;
  v_new_adjusted := v_contract.deposit_adjusted;

  IF p_action = 'receipt' THEN
    v_new_held := v_new_held + p_amount;
    v_new_status := 'held';
  ELSIF p_action = 'refund' THEN
    IF p_amount > v_new_held THEN
      RAISE EXCEPTION 'Refund amount % exceeds deposit held balance %', p_amount, v_new_held USING ERRCODE = '22000';
    END IF;
    v_new_held := v_new_held - p_amount;
    v_new_refunded := v_new_refunded + p_amount;
    v_new_status := CASE WHEN v_new_held = 0 THEN 'fully_refunded' ELSE 'partially_refunded' END;
  ELSIF p_action IN ('damage_deduction', 'rent_adjustment') THEN
    IF p_amount > v_new_held THEN
      RAISE EXCEPTION 'Adjustment amount % exceeds deposit held balance %', p_amount, v_new_held USING ERRCODE = '22000';
    END IF;
    v_new_held := v_new_held - p_amount;
    v_new_adjusted := v_new_adjusted + p_amount;
    v_new_status := 'adjusted';
  ELSIF p_action = 'forfeiture' THEN
    IF p_amount > v_new_held THEN
      RAISE EXCEPTION 'Forfeiture amount % exceeds deposit held balance %', p_amount, v_new_held USING ERRCODE = '22000';
    END IF;
    v_new_held := v_new_held - p_amount;
    v_new_adjusted := v_new_adjusted + p_amount;
    v_new_status := 'forfeited';
  END IF;

  -- Record transaction
  INSERT INTO public.rental_security_deposits (
    company_id, rental_contract_id, transaction_type,
    amount, payment_method, payment_reference, notes, created_by
  ) VALUES (
    v_contract.company_id, p_contract_id, p_action,
    p_amount, p_payment_method, p_payment_ref, p_notes, auth.uid()
  )
  RETURNING id INTO v_deposit_id;

  -- Update contract balances
  UPDATE public.rental_contracts
  SET
    deposit_held = v_new_held,
    deposit_refunded = v_new_refunded,
    deposit_adjusted = v_new_adjusted,
    deposit_status = v_new_status,
    updated_at = now()
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'deposit_transaction_id', v_deposit_id,
    'action', p_action::text,
    'amount', p_amount,
    'deposit_held', v_new_held,
    'deposit_refunded', v_new_refunded,
    'deposit_adjusted', v_new_adjusted,
    'deposit_status', v_new_status
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 15. RPC: assess_rental_damage()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assess_rental_damage(
  p_contract_id uuid,
  p_asset_id uuid,
  p_return_id uuid,
  p_damage_type public.rental_damage_type,
  p_severity public.rental_damage_severity,
  p_description text,
  p_photos text[] DEFAULT ARRAY[]::text[],
  p_estimated_cost numeric DEFAULT 0.000,
  p_customer_responsibility public.rental_responsibility DEFAULT 'full',
  p_approved_charge numeric DEFAULT 0.000,
  p_spawn_work_order boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_asset RECORD;
  v_assessment_id uuid;
  v_doc_num text;
  v_wo_id uuid;
BEGIN
  SELECT * INTO v_contract FROM public.rental_contracts WHERE id = p_contract_id;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_asset FROM public.rental_assets WHERE id = p_asset_id;
  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION 'Rental asset % not found', p_asset_id USING ERRCODE = 'P0002';
  END IF;

  -- Spawn Phase 1 repair work order if requested
  IF p_spawn_work_order THEN
    INSERT INTO public.work_orders (
      company_id, branch_id, customer_id, site_id,
      customer_asset_id, priority, status,
      title, description, created_by, created_at, updated_at
    ) VALUES (
      v_contract.company_id, v_contract.branch_id, v_contract.customer_id, v_contract.site_id,
      v_asset.customer_asset_id, 'urgent', 'scheduled',
      'Rental Damage Repair: ' || v_asset.asset_code,
      'Damage Type: ' || p_damage_type::text || ' - Severity: ' || p_severity::text || '. ' || p_description,
      auth.uid(), now(), now()
    )
    RETURNING id INTO v_wo_id;
  END IF;

  -- Create damage assessment record
  INSERT INTO public.rental_damage_assessments (
    company_id, rental_contract_id, rental_return_id, rental_asset_id,
    damage_type, severity, description, photos,
    estimated_repair_cost, actual_repair_cost, customer_responsibility,
    approved_charge, repair_work_order_id, status, assessed_by
  ) VALUES (
    v_contract.company_id, p_contract_id, p_return_id, p_asset_id,
    p_damage_type, p_severity, p_description, p_photos,
    p_estimated_cost, 0.000, p_customer_responsibility,
    p_approved_charge, v_wo_id,
    CASE WHEN p_approved_charge > 0 THEN 'approved' ELSE 'under_review' END,
    NULL
  )
  RETURNING id, assessment_number INTO v_assessment_id, v_doc_num;

  -- If approved charge > 0, record in rental_charges
  IF p_approved_charge > 0 THEN
    INSERT INTO public.rental_charges (
      rental_contract_id, charge_type, description, amount
    ) VALUES (
      p_contract_id, 'damage',
      'Approved damage recovery (' || v_doc_num || '): ' || p_description,
      p_approved_charge
    );
  END IF;

  -- Update asset status to damaged/maintenance
  UPDATE public.rental_assets
  SET rental_status = 'damaged', updated_at = now()
  WHERE id = p_asset_id;

  RETURN jsonb_build_object(
    'success', true,
    'damage_assessment_id', v_assessment_id,
    'assessment_number', v_doc_num,
    'repair_work_order_id', v_wo_id,
    'approved_charge', p_approved_charge,
    'status', CASE WHEN p_approved_charge > 0 THEN 'approved' ELSE 'under_review' END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 16. RPC: calculate_rental_charges_v2()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_rental_charges_v2(
  p_start_date date,
  p_end_date date,
  p_daily_rate numeric,
  p_weekly_rate numeric,
  p_monthly_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_days integer;
  v_months integer;
  v_weeks integer;
  v_rem_days integer;
  v_cost_daily numeric(14,3);
  v_cost_weekly numeric(14,3);
  v_cost_monthly numeric(14,3);
  v_cost_optimized numeric(14,3);
  v_best_rate_structure text;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end_date cannot be earlier than start_date' USING ERRCODE = '22000';
  END IF;

  v_days := (p_end_date - p_start_date) + 1;

  -- Pure daily cost
  v_cost_daily := v_days * p_daily_rate;

  -- Weekly cost (weeks + remaining days)
  v_weeks := v_days / 7;
  v_rem_days := v_days % 7;
  v_cost_weekly := (v_weeks * p_weekly_rate) + (v_rem_days * p_daily_rate);

  -- Monthly cost (months of 30 days + remaining weekly + daily)
  v_months := v_days / 30;
  v_rem_days := v_days % 30;
  v_cost_monthly := (v_months * p_monthly_rate) +
                    ((v_rem_days / 7) * p_weekly_rate) +
                    ((v_rem_days % 7) * p_daily_rate);
  IF p_monthly_rate > 0 AND ((v_months + 1) * p_monthly_rate) < v_cost_monthly THEN
    v_cost_monthly := (v_months + 1) * p_monthly_rate;
  END IF;

  -- Find minimum cost (optimizing for customer)
  v_cost_optimized := v_cost_daily;
  v_best_rate_structure := 'daily';

  IF p_weekly_rate > 0 AND v_cost_weekly < v_cost_optimized THEN
    v_cost_optimized := v_cost_weekly;
    v_best_rate_structure := 'weekly';
  END IF;

  IF p_monthly_rate > 0 AND v_cost_monthly < v_cost_optimized THEN
    v_cost_optimized := v_cost_monthly;
    v_best_rate_structure := 'monthly';
  END IF;

  RETURN jsonb_build_object(
    'total_days', v_days,
    'daily_cost', v_cost_daily,
    'weekly_cost', v_cost_weekly,
    'monthly_cost', v_cost_monthly,
    'optimized_cost', v_cost_optimized,
    'best_rate_structure', v_best_rate_structure
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 17. RPC: generate_rental_invoice_v2()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_rental_invoice_v2(
  p_contract_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_charge RECORD;
  v_inv_id uuid;
  v_inv_number text;
  v_subtotal numeric(14,3) := 0.000;
  v_tax numeric(14,3) := 0.000;
  v_grand_total numeric(14,3) := 0.000;
  v_charge_count integer := 0;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  -- Ensure contract subtotal is charged if uncharged
  IF NOT EXISTS (
    SELECT 1 FROM public.rental_charges
    WHERE rental_contract_id = p_contract_id AND charge_type = 'rental_fee'
  ) AND v_contract.subtotal > 0 THEN
    INSERT INTO public.rental_charges (
      rental_contract_id, charge_type, description, amount, tax_amount
    ) VALUES (
      p_contract_id, 'rental_fee', 'Contract Base Rental Fee ' || v_contract.contract_number,
      v_contract.subtotal, v_contract.tax_amount
    );
  END IF;

  -- Aggregate unbilled charges
  SELECT
    COUNT(*),
    COALESCE(SUM(amount), 0.000),
    COALESCE(SUM(tax_amount), 0.000)
  INTO v_charge_count, v_subtotal, v_tax
  FROM public.rental_charges
  WHERE rental_contract_id = p_contract_id AND is_invoiced = false;

  IF v_charge_count = 0 THEN
    RAISE EXCEPTION 'No uninvoiced rental charges found for contract %', v_contract.contract_number
      USING ERRCODE = '22000';
  END IF;

  v_grand_total := v_subtotal + v_tax;

  -- Create Phase 2B commercial invoice
  INSERT INTO public.invoices (
    company_id, branch_id, customer_id, site_id,
    invoice_date, due_date, currency, subtotal,
    taxable_amount, tax_amount, grand_total,
    status, notes, created_by, created_at, updated_at
  ) VALUES (
    v_contract.company_id, v_contract.branch_id, v_contract.customer_id, v_contract.site_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'INR', v_subtotal,
    v_subtotal, v_tax, v_grand_total,
    'draft', 'Billing for Rental Contract ' || v_contract.contract_number,
    auth.uid(), v_now, v_now
  )
  RETURNING id, invoice_number INTO v_inv_id, v_inv_number;

  -- Create invoice lines
  FOR v_charge IN
    SELECT id, charge_type, description, amount, tax_amount, total_amount
    FROM public.rental_charges
    WHERE rental_contract_id = p_contract_id AND is_invoiced = false
  LOOP
    INSERT INTO public.invoice_lines (
      invoice_id, line_type, description, quantity, unit_price,
      subtotal, tax_rate, tax_amount, total_amount
    ) VALUES (
      v_inv_id, 'service', v_charge.description, 1.0000, v_charge.amount,
      v_charge.amount, 5.00, v_charge.tax_amount, v_charge.total_amount
    );

    UPDATE public.rental_charges
    SET is_invoiced = true, invoice_id = v_inv_id
    WHERE id = v_charge.id;
  END LOOP;

  -- If contract was returned, mark as completed
  IF v_contract.status = 'returned' THEN
    UPDATE public.rental_contracts
    SET status = 'completed', updated_at = v_now
    WHERE id = p_contract_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'grand_total', v_grand_total,
    'charges_billed', v_charge_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 18. RPC: get_rental_fleet_utilization()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rental_fleet_utilization(
  p_company_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_assets integer := 0;
  v_active_rentals integer := 0;
  v_overdue_rentals integer := 0;
  v_maintenance_assets integer := 0;
  v_available_assets integer := 0;
  v_period_days integer;
  v_total_fleet_days integer;
  v_total_rented_days integer := 0;
  v_utilization_pct numeric(5,2) := 0.00;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end_date cannot be earlier than start_date' USING ERRCODE = '22000';
  END IF;

  v_period_days := (p_end_date - p_start_date) + 1;

  SELECT COUNT(*) INTO v_total_assets
  FROM public.rental_assets
  WHERE company_id = p_company_id AND is_active = true;

  SELECT
    COUNT(*) FILTER (WHERE rental_status = 'out_for_rental'),
    COUNT(*) FILTER (WHERE rental_status IN ('maintenance', 'damaged')),
    COUNT(*) FILTER (WHERE rental_status = 'available')
  INTO v_active_rentals, v_maintenance_assets, v_available_assets
  FROM public.rental_assets
  WHERE company_id = p_company_id AND is_active = true;

  SELECT COUNT(*) INTO v_overdue_rentals
  FROM public.rental_contracts
  WHERE company_id = p_company_id
    AND status = 'active'
    AND expected_return_date < CURRENT_DATE;

  -- Calculate rented days in period across contract lines
  SELECT COALESCE(SUM(
    GREATEST(0, (LEAST(p_end_date, COALESCE(rc.actual_return_date, rc.expected_return_date)) -
                 GREATEST(p_start_date, rc.start_date) + 1))
  ), 0)
  INTO v_total_rented_days
  FROM public.rental_contracts rc
  WHERE rc.company_id = p_company_id
    AND rc.status IN ('active', 'returned', 'completed', 'overdue')
    AND rc.start_date <= p_end_date
    AND COALESCE(rc.actual_return_date, rc.expected_return_date) >= p_start_date;

  v_total_fleet_days := v_total_assets * v_period_days;
  IF v_total_fleet_days > 0 THEN
    v_utilization_pct := round((v_total_rented_days::numeric / v_total_fleet_days::numeric) * 100.0, 2);
  END IF;

  RETURN jsonb_build_object(
    'total_assets', v_total_assets,
    'available_assets', v_available_assets,
    'active_rentals', v_active_rentals,
    'maintenance_assets', v_maintenance_assets,
    'overdue_rentals', v_overdue_rentals,
    'period_days', v_period_days,
    'total_rented_days', v_total_rented_days,
    'utilization_percentage', v_utilization_pct
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 19. Multi-Tenant Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rental_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_damage_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_security_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_location_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY rental_extensions_tenant_isolation ON public.rental_extensions
  FOR ALL TO authenticated
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY rental_damage_tenant_isolation ON public.rental_damage_assessments
  FOR ALL TO authenticated
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY rental_deposits_tenant_isolation ON public.rental_security_deposits
  FOR ALL TO authenticated
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY rental_movements_tenant_isolation ON public.rental_location_movements
  FOR ALL TO authenticated
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
