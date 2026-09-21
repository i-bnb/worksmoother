import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export type RentalContractStatus =
  | 'draft'
  | 'quoted'
  | 'approved'
  | 'reserved'
  | 'active'
  | 'extension_requested'
  | 'extended'
  | 'return_pending'
  | 'returned'
  | 'completed'
  | 'closed'
  | 'overdue'
  | 'cancelled';

export interface RentalContractLineDTO {
  rentalAssetId: string;
  startDate: string;
  endDate: string;
  rateType?: 'daily' | 'weekly' | 'monthly';
  unitRate: number;
  quantity?: number;
  taxRate?: number;
  meterIncludedUnits?: number;
  meterRatePerUnit?: number;
  depositAmount?: number;
}

export interface CreateRentalContractDTO {
  companyId: string;
  branchId?: string;
  customerId: string;
  siteId?: string;
  quotationId?: string;
  startDate: string;
  expectedReturnDate: string;
  billingFrequency?: 'upfront' | 'daily' | 'weekly' | 'monthly' | 'on_return';
  depositAmount?: number;
  pricingTier?: string;
  termsAndConditions?: string;
  notes?: string;
  lines: RentalContractLineDTO[];
}

const VALID_CONTRACT_TRANSITIONS: Record<RentalContractStatus, RentalContractStatus[]> = {
  draft: ['quoted', 'approved', 'reserved', 'cancelled'],
  quoted: ['approved', 'reserved', 'cancelled'],
  approved: ['reserved', 'active', 'cancelled'],
  reserved: ['active', 'cancelled'],
  active: ['extension_requested', 'extended', 'return_pending', 'returned', 'overdue'],
  extension_requested: ['active', 'extended', 'overdue'],
  extended: ['extension_requested', 'return_pending', 'returned', 'overdue'],
  overdue: ['extension_requested', 'return_pending', 'returned'],
  return_pending: ['returned'],
  returned: ['completed', 'closed'],
  completed: [], // Terminal
  closed: [], // Terminal
  cancelled: [], // Terminal
};

export class RentalContractService {
  /**
   * Pure state machine transition validation for rental contracts.
   */
  static validateContractTransition(
    currentStatus: RentalContractStatus,
    nextStatus: RentalContractStatus
  ): boolean {
    if (currentStatus === nextStatus) return true;
    const allowed = VALID_CONTRACT_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(nextStatus) : false;
  }

  /**
   * Calculate contract subtotal and tax with Decimal precision.
   */
  static calculateTotals(lines: RentalContractLineDTO[]): {
    subtotal: number;
    taxAmount: number;
    grandTotal: number;
    totalDeposit: number;
  } {
    let subtotalDec = Decimal.zero();
    let taxDec = Decimal.zero();
    let depositDec = Decimal.zero();

    for (const line of lines) {
      const qty = new Decimal(line.quantity ?? 1);
      const rate = new Decimal(line.unitRate);
      const lineSubtotal = rate.times(qty);
      const taxRate = new Decimal(line.taxRate ?? 5.0).dividedBy(100);
      const lineTax = lineSubtotal.times(taxRate).round(3);

      subtotalDec = subtotalDec.plus(lineSubtotal);
      taxDec = taxDec.plus(lineTax);

      if (line.depositAmount) {
        depositDec = depositDec.plus(new Decimal(line.depositAmount));
      }
    }

    const grandTotalDec = subtotalDec.plus(taxDec);

    return {
      subtotal: subtotalDec.toNumber(),
      taxAmount: taxDec.toNumber(),
      grandTotal: grandTotalDec.toNumber(),
      totalDeposit: depositDec.toNumber(),
    };
  }

  /**
   * Creates a rental contract with its line items atomically.
   */
  static async createContract(
    client: SupabaseClient,
    dto: CreateRentalContractDTO,
    userId?: string
  ): Promise<string> {
    if (new Date(dto.expectedReturnDate) < new Date(dto.startDate)) {
      throw new Error('expectedReturnDate cannot be before startDate');
    }

    if (!dto.lines || dto.lines.length === 0) {
      throw new Error('Rental contract must include at least one asset line');
    }

    const { subtotal, taxAmount, grandTotal, totalDeposit } = this.calculateTotals(dto.lines);
    const finalDeposit = dto.depositAmount ?? totalDeposit;

    // 1. Insert header
    const { data: contract, error: contractErr } = await client
      .from('rental_contracts')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        customer_id: dto.customerId,
        site_id: dto.siteId || null,
        quotation_id: dto.quotationId || null,
        start_date: dto.startDate,
        expected_return_date: dto.expectedReturnDate,
        billing_frequency: dto.billingFrequency || 'monthly',
        deposit_amount: finalDeposit,
        subtotal: subtotal,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        pricing_tier: dto.pricingTier || 'standard',
        terms_and_conditions: dto.termsAndConditions || null,
        notes: dto.notes || null,
        status: 'draft',
        created_by: userId || null,
      })
      .select('id')
      .single();

    if (contractErr) throw contractErr;
    const contractId = contract.id;

    // 2. Insert lines
    const lineInserts = dto.lines.map((l) => {
      const qty = l.quantity ?? 1;
      const rate = l.unitRate;
      const lineSub = rate * qty;
      const taxRate = l.taxRate ?? 5.0;
      const lineTax = (lineSub * taxRate) / 100;
      return {
        rental_contract_id: contractId,
        rental_asset_id: l.rentalAssetId,
        start_date: l.startDate,
        end_date: l.endDate,
        rate_type: l.rateType || 'daily',
        unit_rate: rate,
        quantity: qty,
        tax_rate: taxRate,
        tax_amount: lineTax,
        line_total: lineSub + lineTax,
        meter_included_units: l.meterIncludedUnits ?? 0,
        meter_rate_per_unit: l.meterRatePerUnit ?? 0,
        deposit_amount: l.depositAmount ?? 0,
      };
    });

    const { error: linesErr } = await client.from('rental_contract_lines').insert(lineInserts);
    if (linesErr) throw linesErr;

    return contractId;
  }

  /**
   * Approve a rental contract.
   */
  static async approveContract(
    client: SupabaseClient,
    contractId: string,
    approvedBy?: string
  ): Promise<void> {
    const { data: contract, error: fetchErr } = await client
      .from('rental_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (fetchErr) throw fetchErr;

    if (!this.validateContractTransition(contract.status as RentalContractStatus, 'approved')) {
      throw new Error(`Cannot approve contract in status '${contract.status}'`);
    }

    const { error: updateErr } = await client
      .from('rental_contracts')
      .update({
        status: 'approved',
        approved_by: approvedBy || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId);

    if (updateErr) throw updateErr;
  }

  /**
   * Cancel a rental contract and release associated reservations.
   */
  static async cancelContract(
    client: SupabaseClient,
    contractId: string,
    reason?: string
  ): Promise<void> {
    const { data: contract, error: fetchErr } = await client
      .from('rental_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (fetchErr) throw fetchErr;

    if (!this.validateContractTransition(contract.status as RentalContractStatus, 'cancelled')) {
      throw new Error(`Cannot cancel contract in status '${contract.status}'`);
    }

    // Cancel contract
    const { error: cancelErr } = await client
      .from('rental_contracts')
      .update({
        status: 'cancelled',
        notes: reason ? `Cancelled: ${reason}` : 'Cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId);

    if (cancelErr) throw cancelErr;

    // Release reservations
    await client
      .from('rental_reservations')
      .update({ status: 'cancelled' })
      .eq('rental_contract_id', contractId);
  }

  /**
   * Convert an accepted Quotation to a Rental Contract.
   */
  static async convertQuotationToRentalContract(
    client: SupabaseClient,
    quotationId: string,
    userId?: string
  ): Promise<string> {
    const { data: quo, error: quoErr } = await client
      .from('quotations')
      .select('*, quotation_lines(*)')
      .eq('id', quotationId)
      .single();

    if (quoErr) throw quoErr;
    if (quo.status !== 'accepted') {
      throw new Error(`Quotation must be in 'accepted' status to convert to rental contract (current: ${quo.status})`);
    }

    // Map quotation lines to rental contract lines
    const lines: RentalContractLineDTO[] = (quo.quotation_lines || []).map((ql: Record<string, unknown>) => ({
      rentalAssetId: (ql.item_id as string) || '00000000-0000-0000-0000-000000000000',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      unitRate: Number(ql.unit_price ?? 0),
      quantity: Number(ql.quantity ?? 1),
      taxRate: Number(ql.tax_rate ?? 5.0),
    }));

    return this.createContract(
      client,
      {
        companyId: quo.company_id,
        branchId: quo.branch_id,
        customerId: quo.customer_id,
        siteId: quo.site_id,
        quotationId: quo.id,
        startDate: new Date().toISOString().split('T')[0],
        expectedReturnDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        billingFrequency: 'monthly',
        depositAmount: 0,
        notes: `Converted from Quotation ${quo.quotation_number}`,
        lines: lines,
      },
      userId
    );
  }
}
