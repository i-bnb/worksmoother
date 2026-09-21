-- =============================================================================
-- Migration 017: Work Orders, Lines, Multi-Trip Visits & Technician Crew
-- Maintenance Management ERP — Phase 1 Core Operations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: work_orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_orders (
  id                      uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               uuid                        REFERENCES public.branches(id) ON DELETE SET NULL,
  work_order_number       text                        NOT NULL,
  customer_id             uuid                        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id                 uuid                        NOT NULL REFERENCES public.customer_sites(id) ON DELETE RESTRICT,
  asset_id                uuid                        REFERENCES public.customer_assets(id) ON DELETE SET NULL,
  service_request_id      uuid                        REFERENCES public.service_requests(id) ON DELETE SET NULL,
  service_type_id         uuid                        REFERENCES public.service_types(id) ON DELETE SET NULL,
  priority                public.work_order_priority  NOT NULL DEFAULT 'medium',
  status                  public.work_order_status    NOT NULL DEFAULT 'new',
  source                  public.work_order_source    NOT NULL DEFAULT 'internal',
  description             text                        NOT NULL,
  sla_policy_id           uuid                        REFERENCES public.sla_policies(id) ON DELETE SET NULL,
  assigned_supervisor_id  uuid                        REFERENCES public.employees(id) ON DELETE SET NULL,
  scheduled_start         timestamptz,
  scheduled_end           timestamptz,
  due_at                  timestamptz,
  total_estimated_cost    numeric(12,2)               DEFAULT 0.00,
  customer_po_number      text,
  notes                   text,
  created_by              uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz                 NOT NULL DEFAULT now(),
  updated_at              timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_work_orders_number ON public.work_orders (company_id, work_order_number);
CREATE INDEX idx_work_orders_customer ON public.work_orders (customer_id, status);
CREATE INDEX idx_work_orders_site     ON public.work_orders (site_id);
CREATE INDEX idx_work_orders_asset    ON public.work_orders (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_work_orders_status   ON public.work_orders (company_id, status, priority);
CREATE INDEX idx_work_orders_schedule ON public.work_orders (company_id, scheduled_start, scheduled_end);

CREATE TRIGGER set_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.work_orders IS 'Primary work order entity tracking maintenance execution through its lifecycle.';

-- Link service_requests back to work_orders
ALTER TABLE public.service_requests
  ADD CONSTRAINT fk_service_requests_converted_wo
  FOREIGN KEY (converted_work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. Trigger Function: Auto-populate Work Order Number
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_work_order_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.work_order_number IS NULL OR trim(NEW.work_order_number) = '' THEN
    NEW.work_order_number := public.generate_document_number(
      NEW.company_id,
      'WO'::public.document_type,
      NEW.branch_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_order_auto_fields
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_work_order_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Table: work_order_lines (Services, Parts & Labor Estimation)
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_lines (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id uuid          NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  line_type     text          NOT NULL DEFAULT 'service',
  item_code     text,
  description   text          NOT NULL,
  quantity      numeric(10,2) NOT NULL DEFAULT 1.00 CHECK (quantity > 0),
  unit_price    numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  total_price   numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  is_billable   boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_order_lines_wo ON public.work_order_lines (work_order_id);

CREATE TRIGGER set_work_order_lines_updated_at
  BEFORE UPDATE ON public.work_order_lines
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.work_order_lines IS 'Line items estimating and tracking labor, spare parts, and service charges.';

-- ---------------------------------------------------------------------------
-- 4. Table: visits (Multi-Trip Execution & First-Time-Fix Tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE public.visits (
  id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id           uuid                REFERENCES public.branches(id) ON DELETE SET NULL,
  work_order_id       uuid                NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_number        integer             NOT NULL DEFAULT 1 CHECK (visit_number >= 1),
  scheduled_start     timestamptz,
  scheduled_end       timestamptz,
  dispatched_at       timestamptz,
  dispatch_notes      text,
  status              public.visit_status NOT NULL DEFAULT 'scheduled',
  check_in_at         timestamptz,
  check_in_lat        numeric(10,7),
  check_in_lng        numeric(10,7),
  check_out_at        timestamptz,
  check_out_lat       numeric(10,7),
  check_out_lng       numeric(10,7),
  is_first_time_fix   boolean,
  notes               text,
  created_by          uuid                REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz         NOT NULL DEFAULT now(),
  updated_at          timestamptz         NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_visits_wo_number ON public.visits (work_order_id, visit_number);
CREATE INDEX idx_visits_company_status ON public.visits (company_id, status, scheduled_start);
CREATE INDEX idx_visits_work_order     ON public.visits (work_order_id);

CREATE TRIGGER set_visits_updated_at
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.visits IS 'Physical trips to customer sites. A single work order may span multiple visits to capture First-Time-Fix rate.';

-- ---------------------------------------------------------------------------
-- 5. Table: work_order_assignments (Supervisor / Crew Lead Linkage)
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id uuid        NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  employee_id   uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role_in_job   text        NOT NULL DEFAULT 'lead',
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_wo_assignments_active
  ON public.work_order_assignments (work_order_id, employee_id)
  WHERE is_active = true;

CREATE INDEX idx_wo_assignments_employee ON public.work_order_assignments (employee_id, is_active);
CREATE INDEX idx_wo_assignments_wo       ON public.work_order_assignments (work_order_id);

COMMENT ON TABLE public.work_order_assignments IS 'Assigns field engineering staff to a work order.';

-- ---------------------------------------------------------------------------
-- 6. Table: visit_technicians (Trip-Specific Crew & En Route State)
-- ---------------------------------------------------------------------------
CREATE TABLE public.visit_technicians (
  id                uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  visit_id          uuid                          NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  employee_id       uuid                          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role_in_visit     text                          NOT NULL DEFAULT 'lead',
  status            public.technician_visit_status NOT NULL DEFAULT 'assigned',
  status_updated_at timestamptz                   NOT NULL DEFAULT now(),
  notes             text,
  created_at        timestamptz                   NOT NULL DEFAULT now(),
  updated_at        timestamptz                   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_visit_technicians_scope ON public.visit_technicians (visit_id, employee_id);
CREATE INDEX idx_visit_technicians_emp ON public.visit_technicians (employee_id, status);

CREATE TRIGGER set_visit_technicians_updated_at
  BEFORE UPDATE ON public.visit_technicians
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.visit_technicians IS 'Technicians deployed on an individual visit, tracking en route/working/done states.';

-- ---------------------------------------------------------------------------
-- 7. Table: work_order_status_history (Immutable State Transition Audit Log)
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_order_status_history (
  id            uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                      NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_order_id uuid                      NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  from_status   public.work_order_status  NOT NULL,
  to_status     public.work_order_status  NOT NULL,
  changed_by    uuid                      REFERENCES auth.users(id) ON DELETE SET NULL,
  reason        text,
  created_at    timestamptz               NOT NULL DEFAULT now()
);

CREATE INDEX idx_wo_status_history_wo ON public.work_order_status_history (work_order_id, created_at DESC);

COMMENT ON TABLE public.work_order_status_history IS 'Audit trail recording each valid lifecycle state transition for work orders.';

-- Attach audit triggers
SELECT public.attach_audit_trigger('work_orders');
SELECT public.attach_audit_trigger('work_order_lines');
SELECT public.attach_audit_trigger('visits');
SELECT public.attach_audit_trigger('work_order_assignments');
SELECT public.attach_audit_trigger('visit_technicians');
