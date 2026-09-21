-- =============================================================================
-- Migration 047: Accounts Payable (Supplier Bills & Payments) and Expenses
-- Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
-- =============================================================================
-- Features:
--   1. supplier_bills (AP Vendor Invoices) linked to Purchase Orders & GRNs
--   2. supplier_payments (Vendor Disbursements)
--   3. expenses (Job-specific and operational expenses with approval workflow)
--   4. Double-entry GL posting procedures for bills, vendor payments, and expenses

-- ---------------------------------------------------------------------------
-- 1. Table: supplier_bills (Accounts Payable Invoices)
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_bills (
  id                    uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid                NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id             uuid                REFERENCES public.branches(id) ON DELETE SET NULL,
  supplier_id           uuid                NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  po_id                 uuid                REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  goods_receipt_id      uuid                REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  bill_number           text                NOT NULL,
  vendor_invoice_number text,
  bill_date             date                NOT NULL DEFAULT CURRENT_DATE,
  due_date              date                NOT NULL,
  currency              text                NOT NULL DEFAULT 'AED',
  subtotal              numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (subtotal >= 0),
  tax_amount            numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (tax_amount >= 0),
  grand_total           numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (grand_total >= 0),
  amount_paid           numeric(14,3)       NOT NULL DEFAULT 0.000 CHECK (amount_paid >= 0),
  amount_due            numeric(14,3)       GENERATED ALWAYS AS (grand_total - amount_paid) STORED,
  status                public.bill_status  NOT NULL DEFAULT 'draft',
  notes                 text,
  is_posted_to_gl       boolean             NOT NULL DEFAULT false,
  gl_posted_at          timestamptz,
  gl_journal_entry_id   uuid                REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by            uuid                REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by           uuid                REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  created_at            timestamptz         NOT NULL DEFAULT now(),
  updated_at            timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_bills_due_date CHECK (due_date >= bill_date),
  CONSTRAINT chk_supplier_bills_paid_bounds CHECK (amount_paid <= grand_total)
);

CREATE UNIQUE INDEX uq_supplier_bills_company_number ON public.supplier_bills (company_id, bill_number);
CREATE INDEX idx_supplier_bills_supplier ON public.supplier_bills (supplier_id, status);
CREATE INDEX idx_supplier_bills_po       ON public.supplier_bills (po_id);
CREATE INDEX idx_supplier_bills_grn      ON public.supplier_bills (goods_receipt_id);

CREATE TRIGGER set_supplier_bills_updated_at
  BEFORE UPDATE ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Bill Number (BILL-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_supplier_bill_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.bill_number IS NULL OR trim(NEW.bill_number) = '' THEN
    NEW.bill_number := public.generate_document_number(
      NEW.company_id,
      'BILL'::public.document_type,
      NEW.branch_id
    );
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := NEW.bill_date + INTERVAL '30 days';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_bill_auto_fields
  BEFORE INSERT ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.handle_supplier_bill_before_insert();

COMMENT ON TABLE public.supplier_bills IS 'Accounts Payable vendor bills for purchased equipment and materials.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('supplier_bills');

-- ---------------------------------------------------------------------------
-- 2. Table: supplier_bill_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_bill_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id             uuid          NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  item_id             uuid          REFERENCES public.items(id) ON DELETE SET NULL,
  description         text          NOT NULL,
  quantity            numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price          numeric(14,3) NOT NULL CHECK (unit_price >= 0),
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 5.00,
  tax_amount          numeric(14,3) NOT NULL DEFAULT 0.000,
  line_total          numeric(14,3) NOT NULL CHECK (line_total >= 0),
  expense_account_id  uuid          REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  cost_center_id      uuid          REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_bill_lines_bill ON public.supplier_bill_lines (bill_id);

-- ---------------------------------------------------------------------------
-- 3. Table: supplier_payments (Vendor Disbursements)
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_payments (
  id                  uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id           uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  payment_number      text                  NOT NULL,
  supplier_id         uuid                  NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  bill_id             uuid                  REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
  payment_date        date                  NOT NULL DEFAULT CURRENT_DATE,
  currency            text                  NOT NULL DEFAULT 'AED',
  amount              numeric(14,3)         NOT NULL CHECK (amount > 0),
  payment_method_id   uuid                  REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  bank_account_id     uuid                  REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  reference_number    text,
  status              public.payment_status NOT NULL DEFAULT 'received',
  is_posted_to_gl     boolean               NOT NULL DEFAULT false,
  gl_posted_at        timestamptz,
  gl_journal_entry_id uuid                  REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes               text,
  created_by          uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz           NOT NULL DEFAULT now(),
  updated_at          timestamptz           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_supplier_payments_company_number ON public.supplier_payments (company_id, payment_number);
CREATE INDEX idx_supplier_payments_supplier ON public.supplier_payments (supplier_id);
CREATE INDEX idx_supplier_payments_bill     ON public.supplier_payments (bill_id);

CREATE TRIGGER set_supplier_payments_updated_at
  BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Supplier Payment Number (SPAY-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_supplier_payment_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payment_number IS NULL OR trim(NEW.payment_number) = '' THEN
    NEW.payment_number := public.generate_document_number(
      NEW.company_id,
      'SPAY'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_payment_auto_fields
  BEFORE INSERT ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_supplier_payment_before_insert();

COMMENT ON TABLE public.supplier_payments IS 'Vendor disbursements and payments against Accounts Payable bills.';

-- ---------------------------------------------------------------------------
-- 4. Table: expenses (Operational, Job & Employee Expenses)
-- ---------------------------------------------------------------------------
CREATE TABLE public.expenses (
  id                      uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid                  NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id               uuid                  REFERENCES public.branches(id) ON DELETE SET NULL,
  expense_number          text                  NOT NULL,
  employee_id             uuid                  REFERENCES public.employees(id) ON DELETE SET NULL,
  work_order_id           uuid                  REFERENCES public.work_orders(id) ON DELETE SET NULL,
  cost_center_id          uuid                  REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  amount                  numeric(14,3)         NOT NULL CHECK (amount > 0),
  currency                text                  NOT NULL DEFAULT 'AED',
  category                text                  NOT NULL, -- 'travel', 'fuel', 'materials', 'tools', 'permits', 'rent'
  expense_date            date                  NOT NULL DEFAULT CURRENT_DATE,
  description             text                  NOT NULL,
  receipt_url             text,
  status                  public.expense_status NOT NULL DEFAULT 'draft',
  approved_by             uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  gl_expense_account_id   uuid                  REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_posted_to_gl         boolean               NOT NULL DEFAULT false,
  gl_posted_at            timestamptz,
  gl_journal_entry_id     uuid                  REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by              uuid                  REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz           NOT NULL DEFAULT now(),
  updated_at              timestamptz           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_expenses_company_number ON public.expenses (company_id, expense_number);
CREATE INDEX idx_expenses_work_order ON public.expenses (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX idx_expenses_employee   ON public.expenses (employee_id);
CREATE INDEX idx_expenses_category   ON public.expenses (company_id, category);

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-generate Expense Number (EXP-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.handle_expense_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.expense_number IS NULL OR trim(NEW.expense_number) = '' THEN
    NEW.expense_number := public.generate_document_number(
      NEW.company_id,
      'EXP'::public.document_type,
      NEW.branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expense_auto_fields
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_expense_before_insert();

COMMENT ON TABLE public.expenses IS 'Operational and field job expenses linked to work orders and cost centers.';

-- Attach audit trigger
SELECT public.attach_audit_trigger('expenses');

-- ---------------------------------------------------------------------------
-- 5. RPC: post_supplier_bill_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_supplier_bill_to_gl(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill RECORD;
  v_ap_account uuid;
  v_inv_account uuid;
  v_tax_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_bill
  FROM public.supplier_bills
  WHERE id = p_bill_id
  FOR UPDATE;

  IF v_bill.id IS NULL THEN
    RAISE EXCEPTION 'Supplier bill % not found', p_bill_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bill.is_posted_to_gl AND v_bill.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_bill.gl_journal_entry_id);
  END IF;

  v_ap_account := public.get_default_gl_account(v_bill.company_id, 'ap');
  v_inv_account := public.get_default_gl_account(v_bill.company_id, 'inventory');
  v_tax_account := public.get_default_gl_account(v_bill.company_id, 'tax_input');

  IF v_ap_account IS NULL OR v_inv_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post bill: Accounts Payable or Inventory Asset account not configured'
      USING ERRCODE = '22000';
  END IF;

  -- Create journal
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_bill.company_id, v_bill.branch_id, v_bill.bill_date, 'supplier_bill', v_bill.id,
    'Supplier Bill ' || v_bill.bill_number, v_bill.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Inventory Asset (Subtotal)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, supplier_id
  ) VALUES (
    v_journal_id, v_inv_account, v_bill.subtotal, 0.000,
    'Goods/Spares purchased: ' || v_bill.bill_number, v_bill.supplier_id
  );

  -- Line 2: Dr Input Tax (Tax Amount)
  IF v_bill.tax_amount > 0 THEN
    IF v_tax_account IS NULL THEN
      RAISE EXCEPTION 'Cannot post bill: Input Tax account not configured' USING ERRCODE = '22000';
    END IF;

    INSERT INTO public.journal_lines (
      journal_entry_id, account_id, debit, credit, description, supplier_id
    ) VALUES (
      v_journal_id, v_tax_account, v_bill.tax_amount, 0.000,
      'Input VAT: ' || v_bill.bill_number, v_bill.supplier_id
    );
  END IF;

  -- Line 3: Cr Accounts Payable (Grand Total)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, supplier_id
  ) VALUES (
    v_journal_id, v_ap_account, 0.000, v_bill.grand_total,
    'AP Liability: ' || v_bill.bill_number, v_bill.supplier_id
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  UPDATE public.supplier_bills
  SET
    status = 'posted',
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'success', true,
    'bill_id', p_bill_id,
    'journal_id', v_journal_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: post_supplier_payment_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_supplier_payment_to_gl(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_spay RECORD;
  v_ap_account uuid;
  v_bank_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_spay
  FROM public.supplier_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_spay.id IS NULL THEN
    RAISE EXCEPTION 'Supplier payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_spay.is_posted_to_gl AND v_spay.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_spay.gl_journal_entry_id);
  END IF;

  v_ap_account := public.get_default_gl_account(v_spay.company_id, 'ap');

  IF v_spay.bank_account_id IS NOT NULL THEN
    SELECT gl_account_id INTO v_bank_account
    FROM public.bank_accounts
    WHERE id = v_spay.bank_account_id;
  END IF;

  IF v_bank_account IS NULL THEN
    v_bank_account := public.get_default_gl_account(v_spay.company_id, 'bank');
  END IF;

  IF v_ap_account IS NULL OR v_bank_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post vendor payment: AP or Bank account not configured' USING ERRCODE = '22000';
  END IF;

  -- Create journal
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_spay.company_id, v_spay.branch_id, v_spay.payment_date, 'supplier_payment', v_spay.id,
    'Vendor Disbursement ' || v_spay.payment_number, v_spay.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Accounts Payable
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, supplier_id
  ) VALUES (
    v_journal_id, v_ap_account, v_spay.amount, 0.000,
    'Disbursement to vendor ' || v_spay.payment_number, v_spay.supplier_id
  );

  -- Line 2: Cr Bank Account
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description, supplier_id
  ) VALUES (
    v_journal_id, v_bank_account, 0.000, v_spay.amount,
    'Bank Wire ' || v_spay.payment_number, v_spay.supplier_id
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  -- Settle against bill if specified
  IF v_spay.bill_id IS NOT NULL THEN
    UPDATE public.supplier_bills
    SET
      amount_paid = amount_paid + v_spay.amount,
      status = CASE
        WHEN amount_paid + v_spay.amount >= grand_total THEN 'paid'::public.bill_status
        ELSE 'partially_paid'::public.bill_status
      END,
      updated_at = v_now
    WHERE id = v_spay.bill_id;
  END IF;

  UPDATE public.supplier_payments
  SET
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'supplier_payment_id', p_payment_id,
    'journal_id', v_journal_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: post_expense_to_gl()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_expense_to_gl(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exp RECORD;
  v_expense_account uuid;
  v_bank_account uuid;
  v_journal_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.is_posted_to_gl AND v_exp.gl_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_id', v_exp.gl_journal_entry_id);
  END IF;

  v_expense_account := v_exp.gl_expense_account_id;
  IF v_expense_account IS NULL THEN
    -- Fallback to general operating expense
    SELECT id INTO v_expense_account
    FROM public.chart_of_accounts
    WHERE company_id = v_exp.company_id AND account_type = 'expense'
    ORDER BY account_code DESC LIMIT 1;
  END IF;

  v_bank_account := public.get_default_gl_account(v_exp.company_id, 'bank');

  IF v_expense_account IS NULL OR v_bank_account IS NULL THEN
    RAISE EXCEPTION 'Cannot post expense: Expense or Bank account not configured' USING ERRCODE = '22000';
  END IF;

  -- Create journal
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_date, reference_type, reference_id,
    description, currency, status, created_by, created_at, updated_at
  ) VALUES (
    v_exp.company_id, v_exp.branch_id, v_exp.expense_date, 'expense', v_exp.id,
    'Expense ' || v_exp.expense_number || ': ' || v_exp.description, v_exp.currency, 'draft',
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_journal_id;

  -- Line 1: Dr Operating/Job Expense
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description,
    employee_id, work_order_id, cost_center_id
  ) VALUES (
    v_journal_id, v_expense_account, v_exp.amount, 0.000,
    v_exp.category || ' expense: ' || v_exp.description,
    v_exp.employee_id, v_exp.work_order_id, v_exp.cost_center_id
  );

  -- Line 2: Cr Bank / Cash Disbursement
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit, description,
    employee_id, work_order_id, cost_center_id
  ) VALUES (
    v_journal_id, v_bank_account, 0.000, v_exp.amount,
    'Expense reimbursement: ' || v_exp.expense_number,
    v_exp.employee_id, v_exp.work_order_id, v_exp.cost_center_id
  );

  -- Post the journal
  PERFORM public.post_journal_entry(v_journal_id);

  UPDATE public.expenses
  SET
    status = 'posted',
    is_posted_to_gl = true,
    gl_posted_at = v_now,
    gl_journal_entry_id = v_journal_id,
    updated_at = v_now
  WHERE id = p_expense_id;

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', p_expense_id,
    'journal_id', v_journal_id
  );
END;
$$;
