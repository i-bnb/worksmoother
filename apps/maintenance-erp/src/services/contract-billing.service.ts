import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface CalculatedInstallment {
  installmentNumber: number;
  periodLabel: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  billingDate: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  idempotencyKey: string;
}

export class ContractBillingService {
  /**
   * Pure calculation of recurring billing installments with Decimal precision.
   */
  static calculateInstallments(
    contractValue: number,
    taxAmount: number = 0,
    startDateInput: string | Date,
    endDateInput: string | Date,
    billingFrequency: string = 'quarterly',
    contractId: string = 'CONTRACT'
  ): CalculatedInstallment[] {
    const start = typeof startDateInput === 'string' ? new Date(startDateInput) : startDateInput;
    const end = typeof endDateInput === 'string' ? new Date(endDateInput) : endDateInput;

    let numInstallments = 4;
    let monthStep = 3;

    if (billingFrequency === 'annual_upfront' || billingFrequency === 'fixed') {
      numInstallments = 1;
      monthStep = 12;
    } else if (billingFrequency === 'semi_annual') {
      numInstallments = 2;
      monthStep = 6;
    } else if (billingFrequency === 'monthly') {
      numInstallments = 12;
      monthStep = 1;
    } else {
      // Default quarterly
      numInstallments = 4;
      monthStep = 3;
    }

    const val = new Decimal(contractValue);
    const tax = new Decimal(taxAmount);

    const baseInstallment = val.dividedBy(numInstallments).round(3);
    const taxInstallment = tax.dividedBy(numInstallments).round(3);

    const installments: CalculatedInstallment[] = [];
    let currentPeriodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

    for (let i = 1; i <= numInstallments; i++) {
      let currentPeriodEnd = new Date(
        Date.UTC(currentPeriodStart.getUTCFullYear(), currentPeriodStart.getUTCMonth() + monthStep, currentPeriodStart.getUTCDate() - 1)
      );

      // Clamp period end to contract end date on final installment
      if (i === numInstallments || currentPeriodEnd > end) {
        currentPeriodEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      }

      const pStartStr = currentPeriodStart.toISOString().slice(0, 10);
      const pEndStr = currentPeriodEnd.toISOString().slice(0, 10);
      const billingDateStr = pStartStr; // Bill at start of period
      const periodLabel = `Installment #${i} (${pStartStr} to ${pEndStr})`;
      const idempotencyKey = `BILL-${contractId}-${pStartStr}-${pEndStr}`;

      installments.push({
        installmentNumber: i,
        periodLabel,
        billingPeriodStart: pStartStr,
        billingPeriodEnd: pEndStr,
        billingDate: billingDateStr,
        amount: baseInstallment.toNumber(),
        taxAmount: taxInstallment.toNumber(),
        totalAmount: baseInstallment.plus(taxInstallment).toNumber(),
        idempotencyKey,
      });

      // Advance for next installment
      currentPeriodStart = new Date(Date.UTC(currentPeriodEnd.getUTCFullYear(), currentPeriodEnd.getUTCMonth(), currentPeriodEnd.getUTCDate() + 1));
    }

    return installments;
  }

  /**
   * Generates and stores contract billing schedules in the database.
   */
  static async generateBillingSchedule(client: SupabaseClient, contractId: string) {
    const { data: contract, error: cErr } = await client
      .from('amc_contracts')
      .select('id, company_id, contract_value, tax_amount, start_date, end_date, billing_frequency')
      .eq('id', contractId)
      .single();

    if (cErr || !contract) throw new Error(`Contract not found: ${contractId}`);

    const installments = this.calculateInstallments(
      Number(contract.contract_value),
      Number(contract.tax_amount || 0),
      contract.start_date,
      contract.end_date,
      contract.billing_frequency,
      contract.id
    );

    const rows = installments.map((ins) => ({
      company_id: contract.company_id,
      contract_id: contract.id,
      installment_number: ins.installmentNumber,
      billing_period_start: ins.billingPeriodStart,
      billing_period_end: ins.billingPeriodEnd,
      billing_date: ins.billingDate,
      amount: ins.amount,
      tax_amount: ins.taxAmount,
      period_label: ins.periodLabel,
      status: 'unbilled',
      idempotency_key: ins.idempotencyKey,
    }));

    const { data, error } = await client
      .from('contract_billing_schedules')
      .upsert(rows, { onConflict: 'contract_id,billing_period_start,billing_period_end' })
      .select();

    if (error) throw new Error(`Failed to generate billing schedule: ${error.message}`);
    return data;
  }

  /**
   * Lists billing schedules for a contract.
   */
  static async listBillingSchedules(client: SupabaseClient, contractId: string) {
    const { data, error } = await client
      .from('contract_billing_schedules')
      .select('*, invoice:invoices(id, invoice_number, status, grand_total)')
      .eq('contract_id', contractId)
      .order('installment_number', { ascending: true });

    if (error) throw new Error(`Failed to list billing schedules: ${error.message}`);
    return data;
  }

  /**
   * Generates recurring invoices for schedules due up to asOfDate via transactional RPC.
   */
  static async generateDueInvoices(client: SupabaseClient, asOfDate?: string) {
    const targetDate = asOfDate || new Date().toISOString().slice(0, 10);
    const { data, error } = await client.rpc('generate_recurring_contract_invoices', {
      p_date: targetDate,
    });

    if (error) throw new Error(`Failed to generate recurring contract invoices: ${error.message}`);
    return data;
  }
}
