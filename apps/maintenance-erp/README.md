# Maintenance Management ERP — Backend & Operations (Phases 0, 1, 2A, 2B & 3)

Production-ready, multi-tenant backend foundation, field service operational engine, transactional inventory & purchasing system, sales & billing engine, and **in-house double-entry finance, equipment rental, and annual maintenance contract (AMC)** subsystem for a Maintenance Management ERP built on **Supabase (PostgreSQL + Auth + Row Level Security + Storage + Queues + Realtime)**.

Designed as a clean **modular monolith** centered around PostgreSQL transactional integrity, immutable financial/stock ledgers, and strict tenant isolation.

---

## 1. Database Architecture & Operational Flow

```
Customer
  ├── Contacts (1:N)
  └── Customer Sites (1:N, with GPS Coordinates)
        └── Customer Assets (1:N, Hierarchical Equipment Tree with parent_asset_id)
              └── Service Requests (1:N, Phone/WhatsApp/Portal with SLA deadlining)
                    └── Work Orders (1:N, Strict Status Lifecycle Machine)
                          ├── Work Order Lines (1:N, Billable Services, Parts & Labor)
                          ├── Work Order Assignments (1:N, Crew / Lead Technicians)
                          ├── Status History (1:N, Immutable Transition Auditing)
                          └── Visits (1:N, Multi-Trip Execution & First-Time-Fix Tracking)
                                ├── Visit Technicians (Crew tracking: Assigned -> En Route -> Working -> Done)
                                ├── Check-In / Check-Out (GPS & Verified Timestamps)
                                ├── Job Activities (Inspected, Replaced, Gas-Charged, Tested)
                                ├── Timesheets (Server-side duration calculation)
                                ├── Checklist Responses (Dynamic pass/fail/numeric questions)
                                ├── Asset Readings (Suction/discharge pressures, voltages, temperatures)
                                ├── Refrigerant Logs (Gas type, cylinder, kg charged/recovered)
                                ├── Job Material Movements (Integrated with Inventory Ledger)
                                ├── Attachments (Photos & docs in private Supabase Storage)
                                ├── Customer Signatures (Digital sign-off)
                                └── Atomic Completion RPC (complete_job)

Inventory & Purchasing Subsystem (Phase 2A)
  ├── UOMs & Hierarchical Categories (Parts, Consumables, Services)
  ├── Item Master (SKUs, Serial/Batch tracking, decimal validation, standard & sale pricing)
  ├── Unified Storage Locations:
  │     ├── Central Warehouses
  │     ├── Mobile Technician Vans (Linked 1:1 to Field Technicians)
  │     ├── Quarantine Yards (Defective components under test/warranty)
  │     └── Scrap Yards (Decommissioned parts awaiting disposal)
  ├── Purchasing & Goods Receipt:
  │     ├── Suppliers (Vendor master with payment terms)
  │     ├── Purchase Requests & Purchase Orders (PO-YYYY-XXXX with approval limits)
  │     └── Goods Receipt Notes (GRN-YYYY-XXXX, partial receiving, weighted average cost recalculation)
  ├── Transactional Stock Engine:
  │     ├── Stock Ledger (Strictly immutable, append-only financial & quantity movement history)
  │     ├── Stock Balances (Materialized on-hand, reservations, available stock, valuation)
  │     └── Serial Numbers (PO -> Warehouse -> Van -> Customer Asset lifecycle tracking)
  ├── Inter-Location Transfers (TRN-YYYY-XXXX balanced two-legged transfer_out + transfer_in)
  └── Physical Stocktakes & Reorder Thresholds (Cycle counts, automated variance adjustments)

Sales, Invoicing & Payments Subsystem (Phase 2B)
  ├── Tax Engine & India GST Architecture:
  │     ├── Place of Supply (POS) rules comparing Supplier State vs Customer State
  │     ├── Intra-state: Split equally into CGST (Rate / 2) + SGST (Rate / 2)
  │     ├── Inter-state: Applied as IGST (Full Rate)
  │     ├── Tax-Exempt transactions & HSN/SAC classification codes
  │     └── Arbitrary-precision Decimal arithmetic (Decimal.ts, zero floating point inaccuracies)
  ├── Quotations (QUO-YYYY-XXXX):
  │     ├── Multi-version revision control (v1, v2, v3 with immutable revision archiving)
  │     ├── QuotationCalculationService (Server-side deterministic line & header recalculations)
  │     ├── State machine: DRAFT -> SENT -> ACCEPTED (activates line immutability)
  │     └── Atomic conversion: convert_quotation_to_invoice() with quotation_line_id lineage
  ├── Sales Orders (SO-YYYY-XXXX):
  │     ├── Line tracking (ordered_quantity, fulfilled_quantity, remaining_quantity)
  │     └── Authoritative inventory fulfillment via record_stock_movement (customer_sale)
  ├── Invoicing Engine (INV-YYYY-XXXX):
  │     ├── Work order direct billing (only billable labor and materials, duplicate billing prevention)
  │     ├── Status lifecycle (draft -> issued -> partially_paid -> paid -> overdue -> void -> cancelled)
  │     ├── Hard database immutability triggers (issued lines & totals locked against UPDATE/DELETE)
  │     ├── Controlled invoice voiding via void_invoice() (prohibited if payments are collected)
  │     └── InvoiceCalculationService (deterministic balance_due maintenance)
  ├── Customer Payments & Allocations (PAY-YYYY-XXXX):
  │     ├── Multi-method payments (bank transfer, cash, card, UPI, cheque)
  │     ├── Partial payments, overpayment rejection guard (chk_invoice_paid_bounds)
  │     ├── Payment reversals via reverse_payment() (unallocates and restores invoice balances)
  │     └── Customer billing summary via get_customer_billing_summary()
  └── Application & REST API Layer:
        ├── Domain services: QuotationService, InvoiceService, PaymentService, DocumentNumberService
        ├── Validation schemas & serializers: QuotationCreate, InvoiceCreate, PaymentCreate
        └── Modular REST API route controllers (/api/v1/quotations, /api/v1/invoices, /api/v1/payments)

Double-Entry Finance, Rental & AMC Subsystem (Phase 3)
  ├── General Ledger Engine:
  │     ├── Chart of Accounts (Hierarchical groups, 5-pillar taxonomy, control accounts)
  │     ├── Accounting Periods (Open, Locked, Closed control)
  │     ├── Journal System (JRN-YYYY-XXXX, Total Debit = Total Credit, line bounds)
  │     ├── Central Posting RPC (post_journal_entry) & Reversal Engine (reverse_journal_entry)
  │     ├── Automated Subsystem Postings:
  │     │     ├── Invoice Posting (Dr AR, Cr Revenue, Cr Output Tax)
  │     │     ├── Payment Posting (Dr Bank/Cash, Cr AR)
  │     │     ├── Credit Note Posting (Dr Revenue Adjustment, Dr Tax, Cr AR)
  │     │     └── Inventory COGS (Dr COGS, Cr Inventory Asset based on stock ledger valuation)
  │     ├── Accounts Payable:
  │     │     ├── Supplier Bills (BILL-YYYY-XXXX, Dr Inventory/Expense, Dr Input Tax, Cr AP)
  │     │     └── Supplier Payments (SPAY-YYYY-XXXX, Dr AP, Cr Bank/Cash)
  │     ├── Operational & Job Expenses (EXP-YYYY-XXXX, receipts, approvals, Dr Expense, Cr Bank)
  │     └── Financial Statements & Export:
  │           ├── view_trial_balance & validate_trial_balance()
  │           ├── view_general_ledger & view_job_profitability (Revenue vs Mat + Lab + Exp)
  │           ├── view_profit_and_loss & view_balance_sheet
  │           └── export_accounting_vouchers() (Format-agnostic Tally/Zoho export abstraction)
  ├── Equipment Rental Subsystem:
  │     ├── Rental Assets (Linked to items, serial numbers, locations, rates & meter readings)
  │     ├── Rental Reservations (Database trigger trg_prevent_overlapping_rental_reservations)
  │     ├── Rental Contracts (RNT-YYYY-XXXX, daily/weekly/monthly billing, deposit liabilities)
  │     ├── Delivery & Return Inspections (Meter difference, damage charges, extra day charges)
  │     └── Rental Billing (Direct integration into Phase 2B commercial invoices engine)
  └── Annual Maintenance Contracts (AMC) Subsystem:
        ├── AMC Contracts (AMC-YYYY-XXXX, SLA hours, visit frequencies, coverage limits)
        ├── Covered Equipment (Linked 1:1 with customer_assets registry)
        ├── Recurring Schedules (Idempotent PM visit generation: Q1, Q2, Q3, Q4)
        ├── Field Dispatch Integration (generate_amc_work_order spawns real Phase 1 Work Orders)
        ├── Recurring Installment Billing (bill_amc_contract spawns Phase 2B invoices)
        └── AMC Renewal Engine (Historical renewal preserving audit trail)
```

---

## 2. Directory Structure

```
apps/maintenance-erp/
├── supabase/
│   ├── migrations/
│   │   ├── 001_extensions.sql                # Extensions (uuid-ossp, pgcrypto, moddatetime) & ENUMs
│   │   ├── 002_organizations.sql             # companies & branches
│   │   ├── 003_profiles_roles.sql            # profiles, user_roles, employees, teams & auth trigger
│   │   ├── 004_security_helpers.sql          # RLS helper functions & JWT claim hook
│   │   ├── 005_rls.sql                       # Strict Row Level Security policies
│   │   ├── 006_audit.sql                     # Generic audit_log trigger & immutable policies
│   │   ├── 007_settings.sql                  # Centralized company settings & dynamic AI models
│   │   ├── 008_number_series.sql             # Concurrency-safe document numbering (FOR UPDATE)
│   │   ├── 009_storage.sql                   # Private storage buckets (photos, invoices, signatures)
│   │   ├── 010_notifications.sql             # Multi-channel notification queue & message templates
│   │   ├── 011_automation.sql                # Event-Condition-Action automation engine schema
│   │   ├── 012_queue_foundation.sql          # Asynchronous queue jobs & transactional enqueue RPC
│   │   ├── 013_core_operations_types.sql     # Phase 1 ENUMs (customers, assets, status, activities)
│   │   ├── 014_customers_and_assets.sql      # customers, sites, contacts, hierarchical assets
│   │   ├── 015_service_types_and_sla.sql     # Multilingual service types & SLA calculation
│   │   ├── 016_service_requests.sql          # service_requests intake & SLA auto-deadlining
│   │   ├── 017_work_orders_and_visits.sql    # work_orders, visits, crew, and status history
│   │   ├── 018_technician_operations.sql     # activities, timesheets, checklists, readings, materials
│   │   ├── 019_operational_rpcs.sql          # transition_status, check_in, check_out, complete_job
│   │   ├── 020_operational_rls.sql           # Comprehensive RLS across all operational tables
│   │   ├── 021_dispatch_and_reporting_views.sql # Dispatch board, workload, summary, SLA & FTF
│   │   ├── 022_realtime_broadcast.sql        # Supabase Realtime publication & pg_notify triggers
│   │   ├── 023_inventory_types.sql           # Phase 2A ENUMs (items, locations, movements, serials, PO)
│   │   ├── 024_item_master.sql               # uoms, item_categories, items, decimal validation
│   │   ├── 025_inventory_locations.sql       # Unified locations (warehouses, mobile vans, scrap, quarantine)
│   │   ├── 026_stock_ledger_and_balances.sql # Append-only ledger, balances, serials, negative stock guard
│   │   ├── 027_stock_transfers.sql           # stock_transfers & stock_transfer_lines
│   │   ├── 028_purchasing_and_goods_receipt.sql # suppliers, purchase_orders, goods_receipts (GRN)
│   │   ├── 029_stocktakes_and_reorder.sql    # reorder_rules, stocktakes, count variance generation
│   │   ├── 030_inventory_rpcs.sql            # receive_goods_receipt, transfer_stock, issue_stock_to_job
│   │   ├── 031_inventory_rls.sql             # Strict multi-tenant RLS for storekeeper, van tech & accountant
│   │   ├── 032_inventory_views.sql           # Current stock, van stock, low stock alerts, serial trace
│   │   ├── 033_sales_types.sql               # Phase 2B ENUMs & document series (SO, CN, PAY)
│   │   ├── 034_tax_engine.sql                # tax_codes, approval thresholds, calculate_tax_breakdown()
│   │   ├── 035_quotations.sql                # quotations, lines, revisions, immutability trigger
│   │   ├── 036_sales_orders.sql              # sales_orders, sales_order_lines, fulfillment tracking
│   │   ├── 037_invoices.sql                  # invoices, lines, issued immutability triggers
│   │   ├── 038_credit_notes.sql              # credit_notes, lines, over-crediting boundary guard
│   │   ├── 039_payments_and_allocations.sql  # payment_methods, payments, allocations, gateway abstraction
│   │   ├── 040_sales_and_billing_rpcs.sql    # Quotation, SO, Invoice, CN & Payment allocation RPCs
│   │   ├── 041_sales_rls.sql                 # Multi-tenant RLS for sales, billing, and customer portal
│   │   ├── 042_financial_views.sql           # Balances, aging buckets, pipeline, summary, collections
│   │   ├── 043_finance_types.sql             # Phase 3 ENUMs (accounts, journals, periods, rental, AMC)
│   │   ├── 044_chart_of_accounts.sql         # COA, account_groups, periods, cost_centers, bank_accounts
│   │   ├── 045_general_ledger.sql            # journal_entries, journal_lines, database immutability triggers
│   │   ├── 046_posting_and_reversal_engine.sql # post_journal_entry, reverse_journal_entry, validate_trial_balance
│   │   ├── 047_accounts_payable_and_expenses.sql # supplier_bills, supplier_payments, expenses, GL postings
│   │   ├── 048_financial_reporting_and_exports.sql # Trial Balance, General Ledger, P&L, BS, Job Profitability, Tally/Zoho export
│   │   ├── 049_rental_module.sql             # rental_assets, contracts, overlap guard, deliveries, returns, billing
│   │   ├── 050_amc_module.sql                # amc_contracts, covered assets, schedules, WO dispatch, billing, renewals
│   │   ├── 051_finance_rental_amc_rls.sql    # Comprehensive RLS for Accountant, Ops Manager, Storekeeper, Tech, Customer
│   │   └── 052_finance_views_and_notifications.sql # Bank reconciliation staging, expiry alerts queue triggers
│   ├── seed/
│   │   ├── seed.sql                          # Full enterprise seed data (Phases 0, 1, 2A, 2B, 3)
│   │   └── seed.ts                           # TypeScript Auth Admin provisioner (with production guards)
│   └── functions/
│       └── _shared/                          # Edge function utilities (server-side only)
├── tests/
│   └── security/
│       ├── helpers.ts                        # Test fixtures and authenticated client factories
│       ├── auth.test.ts                      # Unauthenticated access rejection
│       ├── tenant-isolation.test.ts          # Company A vs Company B barrier
│       ├── roles.test.ts                     # RBAC boundaries (tech vs accountant vs customer)
│       ├── branch-isolation.test.ts          # Branch restriction enforcement
│       ├── audit.test.ts                     # Audit trigger capture & immutability tests
│       ├── number-series.test.ts             # High-concurrency generation (zero duplicates)
│       ├── storage.test.ts                   # Storage isolation & upload permissions
│       ├── operations-customer-isolation.test.ts # Customer portal multi-tenant isolation
│       ├── operations-technician-isolation.test.ts # Technician job & assignment isolation
│       ├── work-order-lifecycle.test.ts      # State machine enforcement & status history
│       ├── visit-checkin-checkout.test.ts    # GPS check-in/out, timesheets, idempotency
│       ├── job-completion-rpc.test.ts        # Atomic complete_job, checklists, signature, FTF
│       ├── inventory-receipt-costing.test.ts # Partial GRN receipts & weighted average costing
│       ├── inventory-transfers.test.ts       # Multi-legged inter-location transfers
│       ├── inventory-negative-stock-guard.test.ts # Negative stock protection & settings toggle
│       ├── inventory-concurrency-locks.test.ts # Row-level locks (FOR UPDATE) & race protection
│       ├── inventory-serial-tracking.test.ts # Serial number lifecycle & asset installation
│       ├── inventory-job-material-integration.test.ts # Van issue integration with job_material_movements
│       ├── inventory-ledger-immutability.test.ts # Append-only trigger immutability guard
│       ├── sales-quotation-lifecycle.test.ts # Quotation status transitions, revisions, approvals
│       ├── sales-order-inventory-fulfillment.test.ts # SO fulfillment via stock ledger movement
│       ├── invoicing-lifecycle-immutability.test.ts # Strict immutability of issued invoices
│       ├── work-order-billing.test.ts        # WO to Invoice generation & duplicate billing prevention
│       ├── credit-notes.test.ts              # Credit note creation & over-crediting boundary guard
│       ├── payments-and-allocations.test.ts  # Atomic multi-invoice allocation & unallocation
│       ├── financial-security-and-concurrency.test.ts # Concurrency locks (FOR UPDATE) & RLS barriers
│       ├── general-ledger-double-entry.test.ts # Double-entry balancing, posting, immutability & reversals
│       ├── trial-balance-validation.test.ts  # validate_trial_balance RPC and financial statements
│       ├── sales-invoice-gl-integration.test.ts # Commercial invoice & payment posting to GL
│       ├── credit-note-gl-integration.test.ts # Credit note posting & receivable adjustment
│       ├── procurement-inventory-cogs-gl.test.ts # AP bills, disbursements & inventory COGS posting
│       ├── job-profitability.test.ts         # Direct costs (materials, labor, expenses) vs invoiced revenue
│       ├── tally-zoho-export.test.ts         # Structured export abstraction for Tally & Zoho Books
│       ├── rental-lifecycle-and-billing.test.ts # Rental assets, overlap reservation guard, returns & billing
│       ├── amc-lifecycle-scheduling-billing.test.ts # AMC contract, recurring PM schedules, WO dispatch & renewals
│       └── finance-rental-amc-security-rls.test.ts # Multi-tenant isolation & RBAC boundaries
├── .env.example                              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. Financial & Accounting Invariants (Phase 3)

### 1. Strict Double-Entry Balancing
Every journal entry posted to the General Ledger strictly enforces:
$$\sum \text{Debits} = \sum \text{Credits} \quad \text{and} \quad \sum \text{Debits} > 0$$
Journals must contain at least two lines. Unbalanced transactions are rejected at the database level with explicit exceptions.

### 2. General Ledger Immutability & Reversals
Once a journal entry transitions to `posted` or `reversed`:
- Direct `UPDATE` of financial columns (`total_debit`, `total_credit`, `journal_date`, `period_id`, `currency`, `exchange_rate`) is blocked by `trg_journal_immutability`.
- Direct `DELETE` of posted journals is prohibited.
- Modifying lines in `journal_lines` on posted journals is blocked by `trg_journal_lines_immutability`.
- Historical corrections must be executed via `reverse_journal_entry()`, which posts an exact opposite balancing journal and links `reversal_of_journal_id`.

### 3. Non-Overlapping Rental Reservations
The database trigger `trg_prevent_overlapping_rental_reservations` enforces that an active rental asset cannot have overlapping confirmed reservation dates. Concurrent or conflicting reservations are rejected at the PostgreSQL transaction level.

### 4. Direct AMC Field Dispatch Integration
AMC recurring preventive maintenance schedules link directly into the Phase 1 operational engine via `generate_amc_work_order()`, creating official `work_orders` records that dispatch into field technician visits, mobile checklists, and job reports without duplicate technician workflows.

### 5. Automated Subsystem Billing & COGS Reconciliation
- Rental charges and AMC installment billing spawn standard commercial invoices in Phase 2B `invoices` engine, with full duplicate billing prevention.
- Outbound inventory movements from `stock_ledger` derive exact weighted average cost at movement time, which `post_inventory_cogs_to_gl()` consumes for Cost of Goods Sold.

---

## 4. Phase 3 Transactional RPCs

1. **General Ledger & Accounting**:
   - `post_journal_entry(p_journal_id)`: Validates period status, active accounts, debit=credit balance, and sets status to `posted`.
   - `reverse_journal_entry(p_journal_id, p_reason)`: Generates and posts an atomic inverse balancing journal.
   - `validate_trial_balance(p_company_id)`: Verifies system-wide equality between Total Debits and Total Credits.
   - `post_invoice_to_gl(p_invoice_id)`: Dr AR, Cr Revenue, Cr Tax.
   - `post_payment_to_gl(p_payment_id)`: Dr Bank/Cash, Cr AR.
   - `post_credit_note_to_gl(p_credit_note_id)`: Dr Sales Return, Dr Tax, Cr AR.
   - `post_inventory_cogs_to_gl(p_stock_ledger_id)`: Dr COGS, Cr Inventory Asset.
   - `post_supplier_bill_to_gl(p_bill_id)`: Dr Inventory/Expense, Dr Input Tax, Cr AP.
   - `post_supplier_payment_to_gl(p_payment_id)`: Dr AP, Cr Bank/Cash.
   - `post_expense_to_gl(p_expense_id)`: Dr Expense Account, Cr Bank/Cash.
   - `export_accounting_vouchers(p_company_id, p_start_date, p_end_date, p_format)`: Structured export output (JSON/CSV) for Tally Prime and Zoho Books.

2. **Rental Management**:
   - `reserve_rental_asset(p_contract_id, p_asset_id, p_start_date, p_end_date)`: Creates booking protected by overlap guard.
   - `deliver_rental_asset(p_contract_id, p_asset_id, p_meter_reading, ...)`: Updates status to `out_for_rental`.
   - `return_rental_asset(p_contract_id, p_asset_id, p_meter_reading, ...)`: Computes meter difference and damage/cleaning extra charges.
   - `bill_rental_contract(p_contract_id)`: Consolidates charges into Phase 2B commercial invoice.

3. **Annual Maintenance Contracts (AMC)**:
   - `generate_amc_schedule(p_contract_id)`: Generates periodic preventive maintenance visit dates (idempotent).
   - `generate_amc_work_order(p_schedule_id)`: Generates Phase 1 `work_order` for scheduled trip.
   - `bill_amc_contract(p_contract_id, p_period_label)`: Generates installment invoice in Phase 2B.
   - `renew_amc_contract(p_contract_id)`: Creates renewal contract preserving historical linkage.

---

## 5. Running Automated Tests

```bash
cd apps/maintenance-erp
npm test
```

### Complete Test Suites (40 Total):
- **Phase 0 Foundation (7 suites)**: `auth`, `tenant-isolation`, `roles`, `branch-isolation`, `audit`, `number-series`, `storage`.
- **Phase 1 Core Operations (5 suites)**: `operations-customer-isolation`, `operations-technician-isolation`, `work-order-lifecycle`, `visit-checkin-checkout`, `job-completion-rpc`.
- **Phase 2A Inventory & Purchasing (7 suites)**: `inventory-receipt-costing`, `inventory-transfers`, `inventory-negative-stock-guard`, `inventory-concurrency-locks`, `inventory-serial-tracking`, `inventory-job-material-integration`, `inventory-ledger-immutability`.
- **Phase 2B Sales & Billing (11 suites)**:
  - `sales-quotation-lifecycle.test.ts`: Quotation state machine and approval limits.
  - `sales-order-inventory-fulfillment.test.ts`: Commercial orders and stock movement fulfillment.
  - `invoicing-lifecycle-immutability.test.ts`: Invoice draft -> issued immutability locks.
  - `work-order-billing.test.ts`: Billed work order labor and materials.
  - `credit-notes.test.ts`: Adjustment notes and balance bounds.
  - `payments-and-allocations.test.ts`: Payments and multi-invoice allocations.
  - `financial-security-and-concurrency.test.ts`: Concurrent payment safety and RLS.
  - `sales-calculation-gst.test.ts`: Fixed-point Decimal precision and India GST engine (Intra-state vs Inter-state).
  - `quotation-to-invoice-flow.test.ts`: Controlled conversion flow and duplicate prevention.
  - `payment-reversal-and-partial.test.ts`: Partial payments, overpayment rejection, reversals, and voiding.
  - `sales-services-api.test.ts`: TypeScript service layer and REST API route controllers.
- **Phase 3 Finance, Rental & AMC (10 suites)**:
  - `general-ledger-double-entry.test.ts`: Balanced journal, unbalanced rejection, immutability & reversals.
  - `trial-balance-validation.test.ts`: `validate_trial_balance()` and financial statements.
  - `sales-invoice-gl-integration.test.ts`: Commercial invoice & payment posting to GL.
  - `credit-note-gl-integration.test.ts`: Credit note posting & receivable adjustment.
  - `procurement-inventory-cogs-gl.test.ts`: AP bills, disbursements & inventory COGS posting.
  - `job-profitability.test.ts`: Direct costs (materials, labor, expenses) vs invoiced revenue.
  - `tally-zoho-export.test.ts`: Structured export abstraction for Tally & Zoho Books.
  - `rental-lifecycle-and-billing.test.ts`: Rental assets, overlap reservation guard, returns & billing.
  - `amc-lifecycle-scheduling-billing.test.ts`: AMC contract, recurring PM schedules, WO dispatch & renewals.
  - `finance-rental-amc-security-rls.test.ts`: Multi-tenant isolation & RBAC boundaries.
- **Phase 3A Accounting Foundation & Financial Controls (5 suites, 50 tests)**:
  - `financial-periods-fiscal-year.test.ts`: Dynamic fiscal year calculation (India April start, calendar year, custom mid-year), period status validation & closing/locking.
  - `chart-of-accounts-hierarchy.test.ts`: COA validation, recursive account tree generator (`buildAccountTree`), circular parent detection, system account protection, operational category mappings.
  - `financial-statements-ar-ap.test.ts`: Real-time chronological AR & AP statements with opening balance, transaction lines, running balances, and closing balance; overdue tracking.
  - `expense-approval-workflow.test.ts`: Operational expense lifecycle (`draft` -> `submitted` -> `approved` -> `paid`), payment validation, database self-approval security guard.
  - `accounting-rest-apis.test.ts`: REST API route controllers, schema validations, and error handling for settings, periods, journals, expenses, statements, and reports.
- **Phase 4 AMC / Service Contracts / Recurring Maintenance (7 suites, 75 tests)**:
  - `contract-lifecycle.test.ts`: State machine transitions (`draft` -> `quoted` -> `pending_approval` -> `approved` -> `active` <-> `suspended` -> `expiring` -> `expired` -> `renewed` / `cancelled`), transition guards, creation validations.
  - `contract-assets-coverage.test.ts`: Multi-asset equipment coverage, coverage classification engine (`full_service`, `parts_only`, `labor_only`, `preventive_only`, `breakdown_only`), partial coverage and billable excess.
  - `contract-entitlements-utilization.test.ts`: Quotas for visits, labor hours, and parts caps; Decimal-precision utilization tracking and limit actions (`convert_to_billable`, `reject_coverage`).
  - `maintenance-schedule-generation.test.ts`: Rolling horizon schedule calculation across frequencies (`quarterly`, `monthly`, `bi_monthly`, `semi_annual`, `annual`, custom days interval), work order dispatching.
  - `contract-recurring-billing.test.ts`: Installment billing engine (`quarterly`, `monthly`, `annual_upfront`), Decimal rounding without drift, idempotency keys.
  - `contract-renewal-and-sla.test.ts`: Contract renewal versioning, percentage price adjustments, configurable service calendar business hours SLA deadline calculation (Mon-Sat, operating windows, overnight carryover, holidays, 24x7 emergency), breach detection.
  - `contract-rest-apis.test.ts`: REST API route controllers, schema validations, and error responses for contracts, covered assets, entitlements, schedules, and billing installments.

- **Phase 5 Equipment Rental Management (7 suites, 44 tests)**:
  - `rental-availability-overlap.test.ts`: Pure overlap detection with turnaround buffer days, non-rentable status rejections, and live RPC check.
  - `rental-contract-lifecycle.test.ts`: Contract creation schema validation, date bounds, progressive state machine transitions, and Decimal-precision totals.
  - `rental-handover-return.test.ts`: Dispatch checklist & meter validation, check-in return calculations (meter difference, excess meter surcharges, overdue extra days, cleaning charges).
  - `rental-extension-management.test.ts`: Rental duration extension schema validations, rate recalculation with Decimal precision, and approval/rejection workflows.
  - `rental-damage-assessment.test.ts`: Damage logging schemas, severity classifications, asset status progression (`returned` -> `under_inspection` -> `damaged` -> `maintenance`), and preventive maintenance threshold detection.
  - `rental-deposit-billing.test.ts`: Security deposit escrow lifecycle (receipt, held balance, partial/full refund, damage deductions, rent adjustments) and rate optimization (daily vs weekly vs monthly pricing).
  - `rental-rest-apis-utilization.test.ts`: REST API route controller validations and fleet utilization metrics calculation (utilization percentage).

---

## 6. Stop Condition

All requested capabilities for **Phase 5 — Equipment Rental / Asset Rental Management** have been completed cleanly with zero regressions. In accordance with architectural boundaries, HR, payroll, attendance, WhatsApp, AI/Gemini, and advanced BI dashboards are excluded and reserved for future modules.


