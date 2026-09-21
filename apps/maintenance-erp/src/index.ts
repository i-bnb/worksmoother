export * from './lib/decimal.js';

// Phase 2B Services & Schemas
export * from './services/tax.service.js';
export * from './services/quotation-calculation.service.js';
export * from './services/invoice-calculation.service.js';
export * from './services/document-number.service.js';
export * from './services/quotation.service.js';
export * from './services/invoice.service.js';
export * from './services/payment.service.js';
export * from './schemas/quotation.schema.js';
export * from './schemas/invoice.schema.js';
export * from './schemas/payment.schema.js';
export * from './api/quotations.js';
export * from './api/invoices.js';
export * from './api/payments.js';
export * from './api/billing.js';

// Phase 3A Accounting Foundation Services
export * from './services/accounting-settings.service.js';
export * from './services/financial-period.service.js';
export * from './services/chart-of-accounts.service.js';
export * from './services/category-mapping.service.js';
export * from './services/journal-posting.service.js';
export * from './services/expense.service.js';
export * from './services/receivable.service.js';
export * from './services/payable.service.js';
export * from './services/financial-reporting.service.js';

// Phase 3A Schemas
export * from './schemas/accounting-settings.schema.js';
export * from './schemas/account.schema.js';
export * from './schemas/expense.schema.js';
export * from './schemas/statement.schema.js';

// Phase 3A API Controllers
export * from './api/accounting-settings.js';
export * from './api/accounting-journals.js';
export * from './api/accounting-expenses.js';
export * from './api/accounting-statements.js';
export * from './api/accounting-reports.js';

// Phase 4 AMC & Recurring Maintenance Services
export * from './services/service-contract.service.js';
export * from './services/contract-asset.service.js';
export * from './services/contract-entitlement.service.js';
export * from './services/contract-coverage.service.js';
export * from './services/maintenance-schedule.service.js';
export * from './services/contract-billing.service.js';
export * from './services/contract-renewal.service.js';
export * from './services/sla.service.js';
export * from './services/contract-reporting.service.js';

// Phase 4 Schemas
export * from './schemas/contract.schema.js';
export * from './schemas/maintenance-schedule.schema.js';
export * from './schemas/contract-billing.schema.js';

// Phase 4 API Controllers
export * from './api/contracts.js';
export * from './api/contract-schedules.js';
export * from './api/contract-billing.js';

// Phase 5 Equipment Rental Management Services
export * from './services/rental-asset.service.js';
export * from './services/rental-availability.service.js';
export * from './services/rental-contract.service.js';
export * from './services/rental-handover.service.js';
export * from './services/rental-extension.service.js';
export * from './services/rental-damage.service.js';
export * from './services/rental-deposit.service.js';
export * from './services/rental-billing.service.js';
export * from './services/rental-reporting.service.js';

// Phase 5 Schemas
export * from './schemas/rental-asset.schema.js';
export * from './schemas/rental-contract.schema.js';
export * from './schemas/rental-operation.schema.js';

// Phase 5 API Controllers
export * from './api/rental-assets.js';
export * from './api/rental-contracts.js';
export * from './api/rental-operations.js';

// Phase 6 HR, Attendance, Leave & Payroll Foundation Services
export * from './services/employee.service.js';
export * from './services/department.service.js';
export * from './services/attendance.service.js';
export * from './services/leave.service.js';
export * from './services/salary-structure.service.js';
export * from './services/payroll-calculation.service.js';
export * from './services/payroll-accounting.service.js';
export * from './services/labor-cost.service.js';
export * from './services/hr-reporting.service.js';

// Phase 6 Schemas
export * from './schemas/employee.schema.js';
export * from './schemas/attendance-leave.schema.js';
export * from './schemas/payroll.schema.js';

// Phase 6 API Controllers
export * from './api/employees.js';
export * from './api/departments.js';
export * from './api/attendance-leave.js';
export * from './api/payroll.js';

// Phase 7 Field Service Management & Dispatch Services
export * from './services/service-territory.service.js';
export * from './services/service-appointment.service.js';
export * from './services/scheduling-engine.service.js';
export * from './services/skill-matching.service.js';
export * from './services/technician-capacity.service.js';
export * from './services/dispatch-board.service.js';
export * from './services/service-visit.service.js';
export * from './services/service-report.service.js';
export * from './services/parts-readiness.service.js';
export * from './services/sla-monitoring.service.js';

// Phase 7 Schemas
export * from './schemas/service-territory.schema.js';
export * from './schemas/service-appointment.schema.js';
export * from './schemas/service-visit.schema.js';
export * from './schemas/dispatch.schema.js';

// Phase 7 API Controllers
export * from './api/service-territories.js';
export * from './api/service-appointments.js';
export * from './api/dispatch-board.js';
export * from './api/service-visits.js';

// Phase 8 Notifications, Communication, Reminders & Event-Driven Messaging Services
export * from './services/template-engine.service.js';
export * from './services/retry-policy.service.js';
export * from './services/communication-provider.service.js';
export * from './services/notification-preference.service.js';
export * from './services/recipient-resolver.service.js';
export * from './services/notification-rule.service.js';
export * from './services/in-app-notification.service.js';
export * from './services/event-dispatcher.service.js';
export * from './services/reminder-engine.service.js';
export * from './services/communication-history.service.js';

// Phase 8 Schemas
export * from './schemas/domain-event.schema.js';
export * from './schemas/notification.schema.js';
export * from './schemas/communication-settings.schema.js';
export * from './schemas/message-template.schema.js';
export * from './schemas/notification-rule.schema.js';

// Phase 8 API Controllers
export * from './api/notifications.js';
export * from './api/notification-preferences.js';
export * from './api/message-templates.js';
export * from './api/notification-rules.js';
export * from './api/communications.js';

// Phase 9 Customer Portal Services
export * from './services/customer-portal-auth.service.js';
export * from './services/customer-dashboard.service.js';
export * from './services/customer-profile.service.js';
export * from './services/customer-asset-portal.service.js';
export * from './services/customer-service-request.service.js';
export * from './services/customer-work-order.service.js';
export * from './services/customer-appointment.service.js';
export * from './services/customer-quotation.service.js';
export * from './services/customer-payment.service.js';
export * from './services/customer-contracts-rental.service.js';
export * from './services/customer-feedback.service.js';

// Phase 9 Customer Portal Schemas
export * from './schemas/customer-portal-auth.schema.js';
export * from './schemas/customer-service-request.schema.js';
export * from './schemas/customer-payment.schema.js';
export * from './schemas/customer-feedback.schema.js';

// Phase 9 Customer Portal API Controllers
export * from './api/customer-portal-profile.js';
export * from './api/customer-portal-assets.js';
export * from './api/customer-portal-operations.js';
export * from './api/customer-portal-finance.js';
export * from './api/customer-portal-contracts-feedback.js';

// Phase 10 Supplier, Procurement & Accounts Payable Services
export * from './services/supplier.service.js';
export * from './services/purchase-request.service.js';
export * from './services/supplier-quotation.service.js';
export * from './services/procurement-order.service.js';
export * from './services/goods-receipt.service.js';
export * from './services/three-way-matching.service.js';
export * from './services/accounts-payable-payment.service.js';
export * from './services/procurement-reporting.service.js';

// Phase 10 Supplier, Procurement & Accounts Payable Schemas
export * from './schemas/supplier.schema.js';
export * from './schemas/procurement-request.schema.js';
export * from './schemas/procurement-order.schema.js';
export * from './schemas/procurement-receipt.schema.js';
export * from './schemas/accounts-payable.schema.js';

// Phase 10 Supplier, Procurement & Accounts Payable API Controllers
export * from './api/suppliers.js';
export * from './api/purchase-requests.js';
export * from './api/purchase-orders.js';
export * from './api/goods-receipts.js';
export * from './api/accounts-payable.js';

// Phase 11 Advanced Finance, Banking, Reconciliation & GST Services
export * from './services/bank-account.service.js';
export * from './services/bank-statement-import.service.js';
export * from './services/bank-reconciliation.service.js';
export * from './services/bank-transfer.service.js';
export * from './services/credit-debit-note.service.js';
export * from './services/financial-refund.service.js';
export * from './services/payment-allocation.service.js';
export * from './services/tax-profile.service.js';
export * from './services/ar-ap-reconciliation.service.js';

// Phase 11 Advanced Finance Schemas
export * from './schemas/banking.schema.js';
export * from './schemas/credit-debit-note.schema.js';
export * from './schemas/refund.schema.js';
export * from './schemas/tax-profile.schema.js';

// Phase 11 Advanced Finance API Controllers
export * from './api/banking.js';
export * from './api/credit-debit-notes.js';
export * from './api/refunds.js';
export * from './api/tax-profiles.js';
export * from './api/finance-reports.js';

