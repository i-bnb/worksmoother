-- =============================================================================
-- Migration 049: Equipment Rental Subsystem, Reservations & Billing
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. rental_assets (Connected to items catalogue, serial numbers & locations)
--   2. rental_contracts (RNT-YYYY-XXXX) with rate structures & deposit handling
--   3. rental_reservations with database trigger preventing double-booking overlaps
--   4. rental_deliveries (Inspection, meter reading, digital sign-off)
--   5. rental_returns (Return inspection, meter difference, damage & extra day charges)
--   6. rental_charges integrated into Phase 2B commercial invoices engine

-- ---------------------------------------------------------------------------
-- 1. Table: rental_assets
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_assets (
  id                    uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                      REFERENCES public.branches(id) ON DELETE SET NULL,
  asset_code            text                      NOT NULL, -- 'RNT-GEN-01', 'RNT-SCAF-01'
  name                  text                      NOT NULL,
  category              text,                     -- 'Generators', 'Scaffolding', 'Dehumidifiers'
  item_id               uuid                      REFERENCES public.items(id) ON DELETE SET NULL,
  serial_number_id      uuid                      REFERENCES public.serial_numbers(id) ON DELETE SET NULL,
  serial_number         text,
  rental_status         public.rental_asset_status NOT NULL DEFAULT 'available',
  current_location_id   uuid                      REFERENCES public.locations(id) ON DELETE RESTRICT,
  current_customer_id   uuid                      REFERENCES public.customers(id) ON DELETE SET NULL,
  current_site_id       uuid                      REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  daily_rate            numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (daily_rate >= 0),
  weekly_rate           numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (weekly_rate >= 0),
  monthly_rate          numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (monthly_rate >= 0),
  deposit_amount        numeric(14,3)             NOT NULL DEFAULT 0.000 CHECK (deposit_amount >= 0),
  condition             text                      NOT NULL DEFAULT 'good',
  meter_reading         numeric(12,2)             NOT NULL DEFAULT 0.00 CHECK (meter_reading >= 0),
  metadata              jsonb                     NOT NULL DEFAULT '{}'::jsonb,
  is_active             boolean                   NOT NULL DEFAULT true,
  created_at            timestamptz               NOT NULL DEFAULT now(),
  updated_at            timestamptz               NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_rental_assets_code ON public.rental_assets (company_id, asset_code);
CREATE INDEX idx_rental_assets_status     ON public.rental_assets (company_id, rental_status);
CREATE INDEX idx_rental_assets_location   ON public.rental_assets (current_location_id);

CREATE TRIGGER set_rental_assets_updated_at
  BEFORE UPDATE ON public.rental_assets
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.rental_assets IS 'Rental equipment registry linked to inventory catalogue and physical serial tracking.';

-- ---------------------------------------------------------------------------
-- 2. Table: rental_contracts
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_contracts (
  id                    uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                        REFERENCES public.branches(id) ON DELETE SET NULL,
  contract_number       text                        NOT NULL,
  customer_id           uuid                        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id               uuid                        REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  start_date            date                        NOT NULL,
  expected_return_date  date                        NOT NULL,
  actual_return_date    date,
  billing_frequency     text                        NOT NULL DEFAULT 'monthly', -- 'daily', 'weekly', 'monthly', 'upfront', 'on_return'
  deposit_amount        numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (deposit_amount >= 0),
  subtotal              numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  tax_amount            numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total           numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  terms_and_conditions  text,
  status                public.rental_contract_status NOT NULL DEFAULT 'draft',
  notes                 text,
  created_by            uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by           uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  created_at            timestamptz                 NOT NULL DEFAULT now(),
  updated_at            timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_rental_contract_dates CHECK (expected_return_date >= start_date)
);

CREATE UNIQUE INDEX uq_rental_contracts_number ON public.rental_contracts (company_id, contract_number);
CREATE INDEX idx_rental_contracts_customer     ON public.rental_contracts (customer_id, status);

CREATE TRIGGER set_rental_contracts_updated_at
  BEFORE UPDATE ON public.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Rental Contract Number (RNT-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_rental_contract_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.contract_number IS NULL OR trim(NEW.contract_number) = '' THEN
    NEW.contract_number := public.generate_document_number(
      NEW.company_id,
      'RNT'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rental_contract_auto_fields
  BEFORE INSERT ON public.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION public.handle_rental_contract_before_insert();

COMMENT ON TABLE public.rental_contracts IS 'Commercial equipment rental agreements.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('rental_contracts');

-- ---------------------------------------------------------------------------
-- 3. Table: rental_contract_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_contract_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_contract_id  uuid          NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  rental_asset_id     uuid          NOT NULL REFERENCES public.rental_assets(id) ON DELETE RESTRICT,
  start_date          date          NOT NULL,
  end_date            date          NOT NULL,
  rate_type           text          NOT NULL DEFAULT 'daily', -- 'daily', 'weekly', 'monthly'
  unit_rate           numeric(14,3) NOT NULL CHECK (unit_rate >= 0),
  quantity            integer       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 5.00,
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000,
  line_total          numeric(14,3) NOT NULL CHECK (line_total >= 0),
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_rental_line_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_rental_contract_lines_contract ON public.rental_contract_lines (rental_contract_id);

-- ---------------------------------------------------------------------------
-- 4. Table: rental_reservations & Database Overlap Guard Trigger
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_reservations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rental_asset_id     uuid        NOT NULL REFERENCES public.rental_assets(id) ON DELETE CASCADE,
  rental_contract_id  uuid        NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  start_date          date        NOT NULL,
  end_date            date        NOT NULL,
  status              text        NOT NULL DEFAULT 'confirmed', -- 'confirmed', 'cancelled', 'fulfilled'
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_reservation_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_rental_reservations_asset ON public.rental_reservations (rental_asset_id, start_date, end_date);

-- Trigger to physically reject overlapping reservations for the same asset
CREATE OR REPLACE FUNCTION public.trg_prevent_overlapping_rental_reservations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_overlap_count integer;
  v_asset_code text;
BEGIN
  IF NEW.status = 'confirmed' THEN
    SELECT COUNT(*), max(ra.asset_code)
    INTO v_overlap_count, v_asset_code
    FROM public.rental_reservations rr
    JOIN public.rental_assets ra ON ra.id = rr.rental_asset_id
    WHERE rr.rental_asset_id = NEW.rental_asset_id
      AND rr.status = 'confirmed'
      AND rr.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (NEW.start_date <= rr.end_date AND NEW.end_date >= rr.start_date);

    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Double-booking rejected: Rental asset % is already reserved between % and %',
        v_asset_code, NEW.start_date, NEW.end_date USING ERRCODE = '22000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_reservation_overlap
  BEFORE INSERT OR UPDATE ON public.rental_reservations
  FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_overlapping_rental_reservations();

COMMENT ON TABLE public.rental_reservations IS 'Asset bookings with database-enforced non-overlapping constraints.';

-- ---------------------------------------------------------------------------
-- 5. Table: rental_deliveries
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_deliveries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_contract_id      uuid        NOT NULL REFERENCES public.rental_contracts(id) ON DELETE RESTRICT,
  rental_asset_id         uuid        NOT NULL REFERENCES public.rental_assets(id) ON DELETE RESTRICT,
  delivery_date           timestamptz NOT NULL DEFAULT now(),
  meter_reading           numeric(12,2) NOT NULL DEFAULT 0.00,
  condition               text        NOT NULL DEFAULT 'good',
  delivered_by            uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  customer_signature_url  text,
  photos                  text[]      DEFAULT ARRAY[]::text[],
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_deliveries_contract ON public.rental_deliveries (rental_contract_id);

-- ---------------------------------------------------------------------------
-- 6. Table: rental_returns
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_returns (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_contract_id  uuid          NOT NULL REFERENCES public.rental_contracts(id) ON DELETE RESTRICT,
  rental_asset_id     uuid          NOT NULL REFERENCES public.rental_assets(id) ON DELETE RESTRICT,
  return_date         timestamptz   NOT NULL DEFAULT now(),
  meter_reading       numeric(12,2) NOT NULL DEFAULT 0.00,
  meter_difference    numeric(12,2) NOT NULL DEFAULT 0.00,
  condition           text          NOT NULL DEFAULT 'good',
  damage_notes        text,
  damage_charge       numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (damage_charge >= 0),
  cleaning_charge     numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (cleaning_charge >= 0),
  extra_day_charge    numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (extra_day_charge >= 0),
  total_extra_charges numeric(14,3) GENERATED ALWAYS AS (damage_charge + cleaning_charge + extra_day_charge) STORED,
  received_by         uuid          REFERENCES public.employees(id) ON DELETE SET NULL,
  photos              text[]        DEFAULT ARRAY[]::text[],
  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_returns_contract ON public.rental_returns (rental_contract_id);

-- ---------------------------------------------------------------------------
-- 7. Table: rental_charges
-- ---------------------------------------------------------------------------
CREATE TABLE public.rental_charges (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_contract_id  uuid          NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  charge_type         text          NOT NULL, -- 'rental_fee', 'deposit', 'damage', 'cleaning', 'extra_days'
  description         text          NOT NULL,
  amount              numeric(14,3) NOT NULL CHECK (amount >= 0),
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  total_amount        numeric(14,3) GENERATED ALWAYS AS (amount + tax_amount) STORED,
  is_invoiced         boolean       NOT NULL DEFAULT false,
  invoice_id          uuid          REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_charges_contract ON public.rental_charges (rental_contract_id, is_invoiced);

-- ---------------------------------------------------------------------------
-- 8. Transactional RPC: reserve_rental_asset()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_rental_asset(
  p_contract_id uuid,
  p_asset_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_asset RECORD;
  v_reservation_id uuid;
BEGIN
  SELECT id, company_id, status INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id, asset_code, rental_status INTO v_asset
  FROM public.rental_assets
  WHERE id = p_asset_id;

  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION 'Rental asset % not found', p_asset_id USING ERRCODE = 'P0002';
  END IF;

  -- Insert reservation (trigger will enforce no overlap)
  INSERT INTO public.rental_reservations (
    company_id, rental_asset_id, rental_contract_id, start_date, end_date, status
  ) VALUES (
    v_contract.company_id, p_asset_id, p_contract_id, p_start_date, p_end_date, 'confirmed'
  )
  RETURNING id INTO v_reservation_id;

  -- Update asset status to reserved
  UPDATE public.rental_assets
  SET rental_status = 'reserved', updated_at = now()
  WHERE id = p_asset_id;

  -- Update contract status to reserved if still draft
  IF v_contract.status = 'draft' THEN
    UPDATE public.rental_contracts
    SET status = 'reserved', updated_at = now()
    WHERE id = p_contract_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'asset_code', v_asset.asset_code,
    'status', 'reserved'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Transactional RPC: deliver_rental_asset()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deliver_rental_asset(
  p_contract_id uuid,
  p_asset_id uuid,
  p_meter_reading numeric,
  p_condition text DEFAULT 'good',
  p_signature_url text DEFAULT NULL,
  p_photos text[] DEFAULT ARRAY[]::text[],
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract RECORD;
  v_delivery_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id, company_id, customer_id, site_id INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Rental contract % not found', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.rental_deliveries (
    rental_contract_id, rental_asset_id, delivery_date, meter_reading,
    condition, customer_signature_url, photos, notes
  ) VALUES (
    p_contract_id, p_asset_id, v_now, p_meter_reading,
    p_condition, p_signature_url, p_photos, p_notes
  )
  RETURNING id INTO v_delivery_id;

  -- Update asset status to out_for_rental
  UPDATE public.rental_assets
  SET
    rental_status = 'out_for_rental',
    current_customer_id = v_contract.customer_id,
    current_site_id = v_contract.site_id,
    meter_reading = p_meter_reading,
    condition = p_condition,
    updated_at = v_now
  WHERE id = p_asset_id;

  -- Transition contract to active
  UPDATE public.rental_contracts
  SET status = 'active', updated_at = v_now
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', v_delivery_id,
    'status', 'out_for_rental'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Transactional RPC: return_rental_asset()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_rental_asset(
  p_contract_id uuid,
  p_asset_id uuid,
  p_meter_reading numeric,
  p_condition text DEFAULT 'good',
  p_damage_charge numeric DEFAULT 0.000,
  p_cleaning_charge numeric DEFAULT 0.000,
  p_extra_day_charge numeric DEFAULT 0.000,
  p_damage_notes text DEFAULT NULL,
  p_photos text[] DEFAULT ARRAY[]::text[],
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_meter_diff numeric(12,2);
  v_return_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id, meter_reading INTO v_asset
  FROM public.rental_assets
  WHERE id = p_asset_id;

  v_meter_diff := GREATEST(p_meter_reading - v_asset.meter_reading, 0.00);

  INSERT INTO public.rental_returns (
    rental_contract_id, rental_asset_id, return_date, meter_reading,
    meter_difference, condition, damage_notes, damage_charge,
    cleaning_charge, extra_day_charge, photos, notes
  ) VALUES (
    p_contract_id, p_asset_id, v_now, p_meter_reading,
    v_meter_diff, p_condition, p_damage_notes, p_damage_charge,
    p_cleaning_charge, p_extra_day_charge, p_photos, p_notes
  )
  RETURNING id INTO v_return_id;

  -- Record extra charges if present
  IF p_damage_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'damage', COALESCE(p_damage_notes, 'Equipment damage charge'), p_damage_charge);
  END IF;

  IF p_cleaning_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'cleaning', 'Equipment cleaning charge', p_cleaning_charge);
  END IF;

  IF p_extra_day_charge > 0 THEN
    INSERT INTO public.rental_charges (rental_contract_id, charge_type, description, amount)
    VALUES (p_contract_id, 'extra_days', 'Overdue extra days rental fee', p_extra_day_charge);
  END IF;

  -- Update asset status: under_inspection or maintenance if damaged
  UPDATE public.rental_assets
  SET
    rental_status = CASE WHEN p_damage_charge > 0 OR p_condition = 'needs_repair' THEN 'under_inspection'::public.rental_asset_status ELSE 'available'::public.rental_asset_status END,
    current_customer_id = NULL,
    current_site_id = NULL,
    meter_reading = p_meter_reading,
    condition = p_condition,
    updated_at = v_now
  WHERE id = p_asset_id;

  -- Fulfill reservation
  UPDATE public.rental_reservations
  SET status = 'fulfilled'
  WHERE rental_contract_id = p_contract_id AND rental_asset_id = p_asset_id;

  -- Update contract return date and status
  UPDATE public.rental_contracts
  SET
    actual_return_date = CURRENT_DATE,
    status = 'returned',
    updated_at = v_now
  WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'meter_difference', v_meter_diff,
    'total_extra_charges', (p_damage_charge + p_cleaning_charge + p_extra_day_charge)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Transactional RPC: bill_rental_contract()
-- ---------------------------------------------------------------------------
-- Spawns commercial invoice in Phase 2B invoices table for uninvoiced rental charges
CREATE OR REPLACE FUNCTION public.bill_rental_contract(
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

  -- If contract subtotal has not been charged yet, create rental_fee charge
  IF NOT EXISTS (
    SELECT 1 FROM public.rental_charges
    WHERE rental_contract_id = p_contract_id AND charge_type = 'rental_fee'
  ) AND v_contract.subtotal > 0 THEN
    INSERT INTO public.rental_charges (
      rental_contract_id, charge_type, description, amount, tax_amount
    ) VALUES (
      p_contract_id, 'rental_fee', 'Contract Rental Fee ' || v_contract.contract_number,
      v_contract.subtotal, v_contract.tax_amount
    );
  END IF;

  -- Calculate uninvoiced charges
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

  -- Create commercial invoice in Phase 2B invoices engine
  INSERT INTO public.invoices (
    company_id, branch_id, customer_id, site_id,
    invoice_date, due_date, currency, subtotal,
    taxable_amount, tax_amount, grand_total,
    status, notes, created_by, created_at, updated_at
  ) VALUES (
    v_contract.company_id, v_contract.branch_id, v_contract.customer_id, v_contract.site_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'AED', v_subtotal,
    v_subtotal, v_tax, v_grand_total,
    'draft', 'Billing for Rental Contract ' || v_contract.contract_number,
    auth.uid(), v_now, v_now
  )
  RETURNING id, invoice_number INTO v_inv_id, v_inv_number;

  -- Create invoice lines for each charge
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

    -- Mark charge as invoiced
    UPDATE public.rental_charges
    SET is_invoiced = true, invoice_id = v_inv_id
    WHERE id = v_charge.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'grand_total', v_grand_total,
    'charges_billed', v_charge_count
  );
END;
$$;
