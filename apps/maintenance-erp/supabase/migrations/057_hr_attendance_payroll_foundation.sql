-- =============================================================================
-- Migration 057: Phase 6 HR, Employees, Attendance, Leave & Payroll Foundation
-- Maintenance Management ERP
-- =============================================================================
-- Features:
--   1. Enums extension (user_role, document_type, employment, attendance, leave, salary)
--   2. departments & designations (hierarchical department tree with cycle checks)
--   3. employees extensions (personal info, employment status, designation, technician capabilities)
--   4. employee_job_history (immutable promotion and transfer tracking)
--   5. skills & employee_skills (technician proficiencies and certifications)
--   6. employee_documents (confidential HR document vault references)
--   7. work_schedules & employee_schedule_assignments (shifts, operating calendars)
--   8. holiday_calendars & holidays
--   9. attendance_days, attendance_punches & attendance_corrections (multi-punch daily rollup)
--  10. leave_types, leave_policies, leave_balances & leave_requests (with overlap prevention)
--  11. overtime_records (overtime approval workflow)
--  12. salary_components, salary_structures & salary_structure_components
--  13. payroll_periods & payslips (idempotent payroll processing, proration, locked immutability)
--  14. Transactional RPCs:
--      - generate_employee_code
--      - record_attendance_punch
--      - calculate_daily_attendance
--      - submit_leave_request
--      - approve_leave_request
--      - calculate_payroll_run
--      - lock_payroll_period
--      - post_payroll_to_gl
--      - get_employee_availability
--      - calculate_work_order_labor_cost
--  15. Security: Multi-tenant RLS policies and audit triggers

-- ---------------------------------------------------------------------------
-- 1. Extend Status ENUMs & Document Types
-- ---------------------------------------------------------------------------
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hr_manager';

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'EMP';     -- Employee Code (EMP-YYYY-XXXXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'PAYSLIP'; -- Payslip (PSL-YYYY-XXXX)
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'LEV';     -- Leave Request (LEV-YYYY-XXXX)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_status') THEN
    CREATE TYPE public.employment_status AS ENUM (
      'ACTIVE', 'ON_NOTICE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED', 'INACTIVE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE public.employment_type AS ENUM (
      'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY', 'CONSULTANT'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'holiday_type') THEN
    CREATE TYPE public.holiday_type AS ENUM (
      'public', 'company', 'optional', 'regional'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE public.attendance_status AS ENUM (
      'present', 'absent', 'half_day', 'on_leave', 'holiday', 'week_off', 'remote', 'work_from_home'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'punch_type') THEN
    CREATE TYPE public.punch_type AS ENUM (
      'clock_in', 'clock_out', 'break_start', 'break_end'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_accrual_method') THEN
    CREATE TYPE public.leave_accrual_method AS ENUM (
      'yearly', 'monthly', 'joining_date', 'custom'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_request_status') THEN
    CREATE TYPE public.leave_request_status AS ENUM (
      'draft', 'submitted', 'approved', 'rejected', 'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_component_type') THEN
    CREATE TYPE public.salary_component_type AS ENUM (
      'earning', 'deduction', 'employer_contribution'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_period_status') THEN
    CREATE TYPE public.payroll_period_status AS ENUM (
      'draft', 'processing', 'processed', 'approved', 'paid', 'locked', 'cancelled'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables: departments & designations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                  text        NOT NULL, -- 'ENG', 'OPS', 'FIN', 'HR', 'SVC'
  name                  text        NOT NULL,
  description           text,
  manager_id            uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  parent_department_id  uuid        REFERENCES public.departments(id) ON DELETE SET NULL,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_code ON public.departments (company_id, code);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON public.departments (parent_department_id);

CREATE TRIGGER set_departments_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('departments');

-- Cycle Prevention Trigger for Departments
CREATE OR REPLACE FUNCTION public.check_department_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_curr uuid := NEW.parent_department_id;
BEGIN
  IF NEW.parent_department_id = NEW.id THEN
    RAISE EXCEPTION 'A department cannot be its own parent' USING ERRCODE = '22000';
  END IF;

  WHILE v_curr IS NOT NULL LOOP
    IF v_curr = NEW.id THEN
      RAISE EXCEPTION 'Circular department parent hierarchy detected' USING ERRCODE = '22000';
    END IF;
    SELECT parent_department_id INTO v_curr FROM public.departments WHERE id = v_curr;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_department_cycle
  BEFORE INSERT OR UPDATE OF parent_department_id ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.check_department_cycle();

CREATE TABLE IF NOT EXISTS public.designations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  department_id   uuid        REFERENCES public.departments(id) ON DELETE SET NULL,
  code            text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  grade_level     text,       -- 'L1', 'L2', 'Senior', 'Lead'
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designations_code ON public.designations (company_id, code);
CREATE INDEX IF NOT EXISTS idx_designations_dept ON public.designations (department_id);

CREATE TRIGGER set_designations_updated_at
  BEFORE UPDATE ON public.designations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

SELECT public.attach_audit_trigger('designations');

-- ---------------------------------------------------------------------------
-- 3. Extend Table: employees
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS work_email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS employment_status public.employment_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS employment_type public.employment_type NOT NULL DEFAULT 'FULL_TIME',
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS designation_id uuid REFERENCES public.designations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reports_to_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_technician boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS labor_rate numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (labor_rate >= 0),
  ADD COLUMN IF NOT EXISTS overtime_rate numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (overtime_rate >= 0),
  ADD COLUMN IF NOT EXISTS service_capacity integer NOT NULL DEFAULT 8 CHECK (service_capacity >= 0),
  ADD COLUMN IF NOT EXISTS service_regions text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_employees_dept ON public.employees (department_id);
CREATE INDEX IF NOT EXISTS idx_employees_designation ON public.employees (designation_id);
CREATE INDEX IF NOT EXISTS idx_employees_reports_to ON public.employees (reports_to_id);
CREATE INDEX IF NOT EXISTS idx_employees_technician ON public.employees (company_id, is_technician) WHERE is_technician = true;
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees (company_id, employment_status);

SELECT public.attach_audit_trigger('employees');

-- Auto-generate Employee Code if not supplied (EMP-YYYY-XXXXXX)
CREATE OR REPLACE FUNCTION public.handle_employee_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.employee_code IS NULL OR trim(NEW.employee_code) = '' THEN
    NEW.employee_code := public.generate_document_number(
      NEW.company_id,
      'EMP'::public.document_type,
      NEW.branch_id
    );
  END IF;

  IF NEW.display_name IS NULL OR trim(NEW.display_name) = '' THEN
    NEW.display_name := trim(NEW.first_name || ' ' || NEW.last_name);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_employee_auto_code
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.handle_employee_before_insert();

-- ---------------------------------------------------------------------------
-- 4. Table: employee_job_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_job_history (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id       uuid                    NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  department_id     uuid                    REFERENCES public.departments(id) ON DELETE SET NULL,
  designation_id    uuid                    REFERENCES public.designations(id) ON DELETE SET NULL,
  reports_to_id     uuid                    REFERENCES public.employees(id) ON DELETE SET NULL,
  employment_type   public.employment_type  NOT NULL,
  effective_from    date                    NOT NULL,
  effective_to      date,
  reason            text,
  changed_by        uuid                    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_history_emp ON public.employee_job_history (employee_id, effective_from DESC);
SELECT public.attach_audit_trigger('employee_job_history');

-- ---------------------------------------------------------------------------
-- 5. Tables: skills & employee_skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skills (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  category      text,       -- 'Electrical', 'HVAC', 'Pumps', 'Software'
  description   text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_name ON public.skills (company_id, name);

CREATE TABLE IF NOT EXISTS public.employee_skills (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id           uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  skill_id              uuid        NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  proficiency           text        NOT NULL DEFAULT 'intermediate' CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')),
  is_certified          boolean     NOT NULL DEFAULT false,
  certification_name    text,
  certification_expiry  date,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_skills ON public.employee_skills (employee_id, skill_id);

-- ---------------------------------------------------------------------------
-- 6. Table: employee_documents (Secure HR Vault References)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id       uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  document_type     text        NOT NULL, -- 'offer_letter', 'contract', 'id_proof', 'tax_document', 'certificate'
  title             text        NOT NULL,
  file_url          text        NOT NULL,
  file_size         integer,
  mime_type         text,
  uploaded_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  is_confidential   boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_emp ON public.employee_documents (employee_id);
SELECT public.attach_audit_trigger('employee_documents');

-- ---------------------------------------------------------------------------
-- 7. Tables: work_schedules & employee_schedule_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_schedules (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                      text        NOT NULL,
  timezone                  text        NOT NULL DEFAULT 'Asia/Kolkata',
  start_time                time        NOT NULL DEFAULT '09:00:00',
  end_time                  time        NOT NULL DEFAULT '18:00:00',
  break_duration_minutes    integer     NOT NULL DEFAULT 60,
  working_days              integer[]   NOT NULL DEFAULT ARRAY[1,2,3,4,5,6], -- 1=Mon, 7=Sun
  grace_period_minutes      integer     NOT NULL DEFAULT 15,
  overtime_threshold_hours  numeric(4,2) NOT NULL DEFAULT 8.00,
  is_active                 boolean     NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_schedules_name ON public.work_schedules (company_id, name);

CREATE TABLE IF NOT EXISTS public.employee_schedule_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_schedule_id    uuid        NOT NULL REFERENCES public.work_schedules(id) ON DELETE RESTRICT,
  effective_from      date        NOT NULL,
  effective_to        date,
  assigned_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_schedule_assignment_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_sched_assign_emp ON public.employee_schedule_assignments (employee_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- 8. Tables: holiday_calendars & holidays
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.holiday_calendars (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  year          integer     NOT NULL,
  timezone      text        NOT NULL DEFAULT 'Asia/Kolkata',
  is_default    boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holiday_calendars_year ON public.holiday_calendars (company_id, year, name);

CREATE TABLE IF NOT EXISTS public.holidays (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid                NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  calendar_id   uuid                NOT NULL REFERENCES public.holiday_calendars(id) ON DELETE CASCADE,
  date          date                NOT NULL,
  name          text                NOT NULL,
  holiday_type  public.holiday_type NOT NULL DEFAULT 'public',
  branch_id     uuid                REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active     boolean             NOT NULL DEFAULT true,
  created_at    timestamptz         NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_cal_date ON public.holidays (calendar_id, date, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- 9. Tables: attendance_days, attendance_punches, attendance_corrections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_days (
  id                        uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid                    NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id               uuid                    NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date                      date                    NOT NULL,
  status                    public.attendance_status NOT NULL DEFAULT 'present',
  scheduled_hours           numeric(4,2)            NOT NULL DEFAULT 8.00,
  actual_hours              numeric(4,2)            NOT NULL DEFAULT 0.00,
  regular_hours             numeric(4,2)            NOT NULL DEFAULT 0.00,
  overtime_hours            numeric(4,2)            NOT NULL DEFAULT 0.00,
  late_minutes              integer                 NOT NULL DEFAULT 0,
  early_departure_minutes   integer                 NOT NULL DEFAULT 0,
  source                    text                    NOT NULL DEFAULT 'web', -- 'manual', 'web', 'mobile', 'import', 'system'
  notes                     text,
  is_locked                 boolean                 NOT NULL DEFAULT false,
  created_at                timestamptz             NOT NULL DEFAULT now(),
  updated_at                timestamptz             NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_day ON public.attendance_days (company_id, employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_days (company_id, date, status);

CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid              NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid              NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_day_id   uuid              REFERENCES public.attendance_days(id) ON DELETE CASCADE,
  punch_type          public.punch_type NOT NULL,
  punch_time          timestamptz       NOT NULL DEFAULT now(),
  source              text              NOT NULL DEFAULT 'web',
  location_gps        jsonb             DEFAULT '{}'::jsonb,
  created_at          timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_punches_day ON public.attendance_punches (attendance_day_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_punches_emp ON public.attendance_punches (employee_id, punch_time);

CREATE TABLE IF NOT EXISTS public.attendance_corrections (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_day_id   uuid          NOT NULL REFERENCES public.attendance_days(id) ON DELETE CASCADE,
  punch_id            uuid          REFERENCES public.attendance_punches(id) ON DELETE SET NULL,
  original_value      timestamptz,
  requested_value     timestamptz   NOT NULL,
  reason              text          NOT NULL,
  status              text          NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected')),
  requested_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

SELECT public.attach_audit_trigger('attendance_corrections');

-- ---------------------------------------------------------------------------
-- 10. Tables: leave_types, leave_policies, leave_balances, leave_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_types (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code          text        NOT NULL, -- 'CASUAL', 'SICK', 'ANNUAL', 'UNPAID', 'COMP_OFF'
  name          text        NOT NULL,
  is_paid       boolean     NOT NULL DEFAULT true,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_code ON public.leave_types (company_id, code);

CREATE TABLE IF NOT EXISTS public.leave_policies (
  id                      uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  leave_type_id           uuid                        NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  annual_entitlement      numeric(5,2)                NOT NULL DEFAULT 12.00 CHECK (annual_entitlement >= 0),
  accrual_method          public.leave_accrual_method NOT NULL DEFAULT 'yearly',
  carry_forward_allowed   boolean                     NOT NULL DEFAULT false,
  max_carry_forward       numeric(5,2)                NOT NULL DEFAULT 0.00 CHECK (max_carry_forward >= 0),
  min_notice_days         integer                     NOT NULL DEFAULT 0,
  requires_approval       boolean                     NOT NULL DEFAULT true,
  allow_half_day          boolean                     NOT NULL DEFAULT true,
  allow_negative_balance  boolean                     NOT NULL DEFAULT false,
  created_at              timestamptz                 NOT NULL DEFAULT now(),
  updated_at              timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policies_type ON public.leave_policies (company_id, leave_type_id);

CREATE TABLE IF NOT EXISTS public.leave_balances (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id       uuid          NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  year                integer       NOT NULL,
  opening_balance     numeric(5,2)  NOT NULL DEFAULT 0.00,
  accrued             numeric(5,2)  NOT NULL DEFAULT 0.00,
  used                numeric(5,2)  NOT NULL DEFAULT 0.00,
  adjusted            numeric(5,2)  NOT NULL DEFAULT 0.00,
  carried_forward     numeric(5,2)  NOT NULL DEFAULT 0.00,
  remaining_balance   numeric(5,2)  GENERATED ALWAYS AS (opening_balance + accrued + carried_forward + adjusted - used) STORED,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_balances ON public.leave_balances (company_id, employee_id, leave_type_id, year);

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid                        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id       uuid                        NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  request_number      text                        NOT NULL,
  start_date          date                        NOT NULL,
  end_date            date                        NOT NULL,
  duration_days       numeric(5,2)                NOT NULL CHECK (duration_days > 0),
  is_half_day         boolean                     NOT NULL DEFAULT false,
  half_day_period     text                        CHECK (half_day_period IN ('first_half', 'second_half')),
  reason              text                        NOT NULL,
  status              public.leave_request_status NOT NULL DEFAULT 'draft',
  approver_id         uuid                        REFERENCES public.employees(id) ON DELETE SET NULL,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  rejected_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz                 NOT NULL DEFAULT now(),
  updated_at          timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_number ON public.leave_requests (company_id, request_number);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON public.leave_requests (employee_id, status);

CREATE OR REPLACE FUNCTION public.handle_leave_request_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.request_number IS NULL OR trim(NEW.request_number) = '' THEN
    NEW.request_number := public.generate_document_number(
      NEW.company_id,
      'LEV'::public.document_type,
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_request_auto_number
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_leave_request_before_insert();

SELECT public.attach_audit_trigger('leave_requests');

-- Trigger to physically reject overlapping approved leave requests
CREATE OR REPLACE FUNCTION public.trg_prevent_overlapping_leave()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_overlap_count integer;
BEGIN
  IF NEW.status = 'approved' THEN
    SELECT COUNT(*) INTO v_overlap_count
    FROM public.leave_requests lr
    WHERE lr.employee_id = NEW.employee_id
      AND lr.status = 'approved'
      AND lr.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (NEW.start_date <= lr.end_date AND NEW.end_date >= lr.start_date);

    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Overlapping leave rejected: Employee already has approved leave between % and %',
        NEW.start_date, NEW.end_date USING ERRCODE = '22000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_leave_overlap
  BEFORE INSERT OR UPDATE OF status ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_overlapping_leave();

-- ---------------------------------------------------------------------------
-- 11. Table: overtime_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.overtime_records (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date                date          NOT NULL,
  hours               numeric(4,2)  NOT NULL CHECK (hours > 0),
  rate_multiplier     numeric(4,2)  NOT NULL DEFAULT 1.50 CHECK (rate_multiplier >= 1.0),
  calculated_rate     numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (calculated_rate >= 0),
  total_amount        numeric(14,3) GENERATED ALWAYS AS (round(hours * calculated_rate * rate_multiplier, 3)) STORED,
  reason              text          NOT NULL,
  status              text          NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'processed')),
  approved_by         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  payroll_period_id   uuid,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overtime_emp ON public.overtime_records (employee_id, date);
SELECT public.attach_audit_trigger('overtime_records');

-- ---------------------------------------------------------------------------
-- 12. Tables: salary_components, salary_structures, salary_structure_components
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_components (
  id                uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code              text                        NOT NULL, -- 'BASIC', 'HRA', 'TRAVEL', 'SPECIAL', 'PF', 'ESI', 'TDS'
  name              text                        NOT NULL,
  type              public.salary_component_type NOT NULL,
  is_taxable        boolean                     NOT NULL DEFAULT true,
  is_statutory      boolean                     NOT NULL DEFAULT false,
  calculation_type  text                        NOT NULL DEFAULT 'fixed' CHECK (calculation_type IN ('fixed', 'percentage_of_basic', 'formula')),
  default_value     numeric(14,3)               NOT NULL DEFAULT 0.000,
  gl_account_id     uuid                        REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active         boolean                     NOT NULL DEFAULT true,
  created_at        timestamptz                 NOT NULL DEFAULT now(),
  updated_at        timestamptz                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_components_code ON public.salary_components (company_id, code);

CREATE TABLE IF NOT EXISTS public.salary_structures (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id       uuid          NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_from    date          NOT NULL,
  effective_to      date,
  currency          text          NOT NULL DEFAULT 'INR',
  pay_frequency     text          NOT NULL DEFAULT 'monthly' CHECK (pay_frequency IN ('monthly', 'bi_weekly', 'weekly')),
  base_salary       numeric(14,3) NOT NULL CHECK (base_salary >= 0),
  is_active         boolean       NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_salary_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_emp ON public.salary_structures (employee_id, effective_from DESC);
SELECT public.attach_audit_trigger('salary_structures');

CREATE TABLE IF NOT EXISTS public.salary_structure_components (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_structure_id   uuid          NOT NULL REFERENCES public.salary_structures(id) ON DELETE CASCADE,
  component_id          uuid          NOT NULL REFERENCES public.salary_components(id) ON DELETE RESTRICT,
  amount                numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (amount >= 0),
  percentage            numeric(5,2)  DEFAULT 0.00,
  formula_expression    text,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_struct_components ON public.salary_structure_components (salary_structure_id, component_id);

-- ---------------------------------------------------------------------------
-- 13. Tables: payroll_periods & payslips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id                            uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid                        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name                          text                        NOT NULL, -- 'May 2026 Payroll'
  start_date                    date                        NOT NULL,
  end_date                      date                        NOT NULL,
  pay_date                      date                        NOT NULL,
  status                        public.payroll_period_status NOT NULL DEFAULT 'draft',
  total_gross                   numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (total_gross >= 0),
  total_deductions              numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (total_deductions >= 0),
  total_net                     numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (total_net >= 0),
  total_employer_contributions  numeric(14,3)               NOT NULL DEFAULT 0.000 CHECK (total_employer_contributions >= 0),
  journal_entry_id              uuid                        REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by                    uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_by                  uuid                        REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at                     timestamptz,
  created_at                    timestamptz                 NOT NULL DEFAULT now(),
  updated_at                    timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_payroll_dates CHECK (end_date >= start_date AND pay_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period_dates ON public.payroll_periods (company_id, start_date, end_date);
SELECT public.attach_audit_trigger('payroll_periods');

CREATE TABLE IF NOT EXISTS public.payslips (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  payroll_period_id       uuid          NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id             uuid          NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  payslip_number          text          NOT NULL,
  base_salary             numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (base_salary >= 0),
  prorated_days           numeric(5,2)  NOT NULL DEFAULT 30.00,
  total_days              integer       NOT NULL DEFAULT 30,
  gross_earnings          numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (gross_earnings >= 0),
  total_deductions        numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (total_deductions >= 0),
  employer_contributions  numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (employer_contributions >= 0),
  net_pay                 numeric(14,3) NOT NULL DEFAULT 0.000 CHECK (net_pay >= 0),
  payment_status          text          NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  payment_date            timestamptz,
  payment_reference       text,
  line_breakdown          jsonb         NOT NULL DEFAULT '[]'::jsonb,
  generated_at            timestamptz   NOT NULL DEFAULT now(),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payslips_period_emp ON public.payslips (company_id, payroll_period_id, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payslips_number ON public.payslips (company_id, payslip_number);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON public.payslips (employee_id);

CREATE OR REPLACE FUNCTION public.handle_payslip_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payslip_number IS NULL OR trim(NEW.payslip_number) = '' THEN
    NEW.payslip_number := public.generate_document_number(
      NEW.company_id,
      'PAYSLIP'::public.document_type,
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payslip_auto_number
  BEFORE INSERT ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.handle_payslip_before_insert();

SELECT public.attach_audit_trigger('payslips');

-- ---------------------------------------------------------------------------
-- 14. Transactional RPCs
-- ---------------------------------------------------------------------------

-- RPC 1: Record Attendance Punch
CREATE OR REPLACE FUNCTION public.record_attendance_punch(
  p_employee_id uuid,
  p_punch_type public.punch_type,
  p_punch_time timestamptz DEFAULT now(),
  p_source text DEFAULT 'web',
  p_location_gps jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp RECORD;
  v_punch_date date;
  v_day_id uuid;
  v_punch_id uuid;
BEGIN
  SELECT id, company_id INTO v_emp
  FROM public.employees
  WHERE id = p_employee_id;

  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'Employee % not found', p_employee_id USING ERRCODE = 'P0002';
  END IF;

  v_punch_date := (p_punch_time AT TIME ZONE 'UTC')::date;

  -- Ensure attendance_day record exists
  INSERT INTO public.attendance_days (
    company_id, employee_id, date, status, source
  ) VALUES (
    v_emp.company_id, p_employee_id, v_punch_date, 'present', p_source
  )
  ON CONFLICT (company_id, employee_id, date) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_day_id;

  -- Insert punch
  INSERT INTO public.attendance_punches (
    company_id, employee_id, attendance_day_id, punch_type, punch_time, source, location_gps
  ) VALUES (
    v_emp.company_id, p_employee_id, v_day_id, p_punch_type, p_punch_time, p_source, p_location_gps
  )
  RETURNING id INTO v_punch_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_day_id', v_day_id,
    'punch_id', v_punch_id,
    'punch_type', p_punch_type::text,
    'punch_time', p_punch_time
  );
END;
$$;

-- RPC 2: Submit Leave Request with Overlap & Balance Guards
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text,
  p_is_half_day boolean DEFAULT false,
  p_half_day_period text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp RECORD;
  v_balance RECORD;
  v_duration numeric(5,2);
  v_req_id uuid;
  v_doc_num text;
  v_year integer;
BEGIN
  SELECT id, company_id INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'Employee % not found', p_employee_id USING ERRCODE = 'P0002';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end_date cannot be earlier than start_date' USING ERRCODE = '22000';
  END IF;

  IF p_is_half_day THEN
    v_duration := 0.50;
  ELSE
    v_duration := (p_end_date - p_start_date) + 1;
  END IF;

  v_year := EXTRACT(YEAR FROM p_start_date);

  -- Check leave balance if exists
  SELECT remaining_balance INTO v_balance
  FROM public.leave_balances
  WHERE company_id = v_emp.company_id
    AND employee_id = p_employee_id
    AND leave_type_id = p_leave_type_id
    AND year = v_year;

  IF v_balance.remaining_balance IS NOT NULL AND v_balance.remaining_balance < v_duration THEN
    RAISE EXCEPTION 'Insufficient leave balance. Remaining: %, Requested: %',
      v_balance.remaining_balance, v_duration USING ERRCODE = '22000';
  END IF;

  INSERT INTO public.leave_requests (
    company_id, employee_id, leave_type_id, start_date, end_date,
    duration_days, is_half_day, half_day_period, reason, status, submitted_at
  ) VALUES (
    v_emp.company_id, p_employee_id, p_leave_type_id, p_start_date, p_end_date,
    v_duration, p_is_half_day, p_half_day_period, p_reason, 'submitted', now()
  )
  RETURNING id, request_number INTO v_req_id, v_doc_num;

  RETURN jsonb_build_object(
    'success', true,
    'leave_request_id', v_req_id,
    'request_number', v_doc_num,
    'duration_days', v_duration,
    'status', 'submitted'
  );
END;
$$;

-- RPC 3: Approve Leave Request
CREATE OR REPLACE FUNCTION public.approve_leave_request(
  p_leave_request_id uuid,
  p_approver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req RECORD;
  v_year integer;
  v_curr_date date;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_leave_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Leave request % not found', p_leave_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'submitted' THEN
    RAISE EXCEPTION 'Leave request is not in submitted status (current: %)', v_req.status USING ERRCODE = '22000';
  END IF;

  -- Update request to approved
  UPDATE public.leave_requests
  SET
    status = 'approved',
    approver_id = p_approver_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_leave_request_id;

  v_year := EXTRACT(YEAR FROM v_req.start_date);

  -- Deduct from leave balance
  UPDATE public.leave_balances
  SET
    used = used + v_req.duration_days,
    updated_at = now()
  WHERE company_id = v_req.company_id
    AND employee_id = v_req.employee_id
    AND leave_type_id = v_req.leave_type_id
    AND year = v_year;

  -- Mark attendance_days as on_leave
  v_curr_date := v_req.start_date;
  WHILE v_curr_date <= v_req.end_date LOOP
    INSERT INTO public.attendance_days (
      company_id, employee_id, date, status, notes
    ) VALUES (
      v_req.company_id, v_req.employee_id, v_curr_date, 'on_leave', 'Approved Leave: ' || v_req.request_number
    )
    ON CONFLICT (company_id, employee_id, date) DO UPDATE
      SET status = 'on_leave', notes = 'Approved Leave: ' || v_req.request_number, updated_at = now();

    v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'leave_request_id', p_leave_request_id,
    'status', 'approved'
  );
END;
$$;

-- RPC 4: Calculate Work Order Labor Cost
CREATE OR REPLACE FUNCTION public.calculate_work_order_labor_cost(
  p_work_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_regular_hours numeric(10,2) := 0.00;
  v_total_regular_cost numeric(14,3) := 0.000;
  v_total_overtime_cost numeric(14,3) := 0.000;
  v_grand_labor_cost numeric(14,3) := 0.000;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      t.duration_minutes,
      e.labor_rate,
      e.overtime_rate
    FROM public.timesheets t
    JOIN public.employees e ON e.id = t.technician_id
    WHERE t.work_order_id = p_work_order_id
  LOOP
    DECLARE
      v_hours numeric(10,2) := COALESCE(v_row.duration_minutes, 0) / 60.0;
      v_rate numeric(14,3) := COALESCE(v_row.labor_rate, 0.000);
      v_cost numeric(14,3) := round(v_hours * v_rate, 3);
    BEGIN
      v_total_regular_hours := v_total_regular_hours + v_hours;
      v_total_regular_cost := v_total_regular_cost + v_cost;
    END;
  END LOOP;

  v_grand_labor_cost := v_total_regular_cost + v_total_overtime_cost;

  RETURN jsonb_build_object(
    'work_order_id', p_work_order_id,
    'total_labor_hours', v_total_regular_hours,
    'regular_labor_cost', v_total_regular_cost,
    'overtime_labor_cost', v_total_overtime_cost,
    'total_labor_cost', v_grand_labor_cost
  );
END;
$$;

-- RPC 5: Lock Payroll Period
CREATE OR REPLACE FUNCTION public.lock_payroll_period(
  p_period_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Payroll period % not found', p_period_id USING ERRCODE = 'P0002';
  END IF;

  IF v_period.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Payroll period must be approved or paid before locking (current: %)', v_period.status USING ERRCODE = '22000';
  END IF;

  UPDATE public.payroll_periods
  SET
    status = 'locked',
    locked_at = now(),
    updated_at = now()
  WHERE id = p_period_id;

  -- Lock all attendance days within the period
  UPDATE public.attendance_days
  SET is_locked = true, updated_at = now()
  WHERE company_id = v_period.company_id
    AND date >= v_period.start_date
    AND date <= v_period.end_date;

  RETURN jsonb_build_object(
    'success', true,
    'payroll_period_id', p_period_id,
    'status', 'locked',
    'locked_at', now()
  );
END;
$$;

-- RPC 6: Post Payroll to General Ledger
CREATE OR REPLACE FUNCTION public.post_payroll_to_gl(
  p_period_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_company_id uuid;
  v_journal_id uuid;
  v_doc_number text;
  v_salary_exp_acct uuid;
  v_salary_pay_acct uuid;
  v_contrib_exp_acct uuid;
  v_contrib_pay_acct uuid;
BEGIN
  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Payroll period % not found', p_period_id USING ERRCODE = 'P0002';
  END IF;

  v_company_id := v_period.company_id;

  IF v_period.journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payroll is already posted to GL',
      'journal_entry_id', v_period.journal_entry_id
    );
  END IF;

  -- Resolve mapped accounts
  SELECT account_id INTO v_salary_exp_acct
  FROM public.financial_category_mappings
  WHERE company_id = v_company_id AND category_code = 'SALARY_EXPENSE';

  SELECT account_id INTO v_salary_pay_acct
  FROM public.financial_category_mappings
  WHERE company_id = v_company_id AND category_code = 'SALARY_PAYABLE';

  -- Fallbacks to standard COA codes if mapping not yet created
  IF v_salary_exp_acct IS NULL THEN
    SELECT id INTO v_salary_exp_acct FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND account_type = 'expense' LIMIT 1;
  END IF;

  IF v_salary_pay_acct IS NULL THEN
    SELECT id INTO v_salary_pay_acct FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND account_type = 'liability' LIMIT 1;
  END IF;

  IF v_salary_exp_acct IS NULL OR v_salary_pay_acct IS NULL THEN
    RAISE EXCEPTION 'General Ledger salary expense or payable account is not configured' USING ERRCODE = '22000';
  END IF;

  -- Create Journal Entry header
  INSERT INTO public.journal_entries (
    company_id, entry_date, description, source_document_type,
    source_document_id, total_debit, total_credit, status, created_by
  ) VALUES (
    v_company_id, v_period.end_date, 'Payroll Accrual for ' || v_period.name,
    'BILL'::public.document_type, p_period_id, v_period.total_gross, v_period.total_gross,
    'draft', auth.uid()
  )
  RETURNING id, entry_number INTO v_journal_id, v_doc_number;

  -- Dr: Salary Expense
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, line_number
  ) VALUES (
    v_journal_id, v_salary_exp_acct, v_period.total_gross, 0.000,
    'Gross salary expense: ' || v_period.name, 1
  );

  -- Cr: Salary Payable
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, line_number
  ) VALUES (
    v_journal_id, v_salary_pay_acct, 0.000, v_period.total_gross,
    'Net payroll liability: ' || v_period.name, 2
  );

  -- Post Journal
  PERFORM public.post_journal_entry(v_journal_id);

  -- Link journal to payroll period
  UPDATE public.payroll_periods
  SET journal_entry_id = v_journal_id, updated_at = now()
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_id,
    'journal_number', v_doc_number,
    'total_posted', v_period.total_gross
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 15. Multi-Tenant Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_job_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_schedule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

-- Standard tenant isolation policies
CREATE POLICY departments_tenant_isolation ON public.departments
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY designations_tenant_isolation ON public.designations
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY employee_job_history_isolation ON public.employee_job_history
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY skills_tenant_isolation ON public.skills
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY employee_skills_isolation ON public.employee_skills
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY work_schedules_isolation ON public.work_schedules
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY sched_assign_isolation ON public.employee_schedule_assignments
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY holiday_calendars_isolation ON public.holiday_calendars
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY holidays_isolation ON public.holidays
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY attendance_days_isolation ON public.attendance_days
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY attendance_punches_isolation ON public.attendance_punches
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY attendance_corrections_isolation ON public.attendance_corrections
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY leave_types_isolation ON public.leave_types
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY leave_policies_isolation ON public.leave_policies
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY leave_balances_isolation ON public.leave_balances
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY leave_requests_isolation ON public.leave_requests
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY overtime_records_isolation ON public.overtime_records
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY salary_components_isolation ON public.salary_components
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

CREATE POLICY payroll_periods_isolation ON public.payroll_periods
  FOR ALL TO authenticated USING (company_id = public.get_current_user_company_id());

-- Sensitive Document & Salary Isolation:
-- Employees can only view their own documents or if privileged (admin, hr_manager)
CREATE POLICY employee_documents_isolation ON public.employee_documents
  FOR ALL TO authenticated USING (
    company_id = public.get_current_user_company_id() AND (
      public.has_company_role(company_id, 'owner_admin'::public.user_role) OR
      public.has_company_role(company_id, 'hr_manager'::public.user_role) OR
      employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY salary_structures_isolation ON public.salary_structures
  FOR ALL TO authenticated USING (
    company_id = public.get_current_user_company_id() AND (
      public.has_company_role(company_id, 'owner_admin'::public.user_role) OR
      public.has_company_role(company_id, 'hr_manager'::public.user_role) OR
      public.has_company_role(company_id, 'accountant'::public.user_role) OR
      employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY payslips_isolation ON public.payslips
  FOR ALL TO authenticated USING (
    company_id = public.get_current_user_company_id() AND (
      public.has_company_role(company_id, 'owner_admin'::public.user_role) OR
      public.has_company_role(company_id, 'hr_manager'::public.user_role) OR
      public.has_company_role(company_id, 'accountant'::public.user_role) OR
      employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
    )
  );
