import { SupabaseClient } from '@supabase/supabase-js';
import { ContractCreateDto } from '../schemas/contract.schema.js';

export type ContractStatus =
  | 'draft'
  | 'quoted'
  | 'pending_approval'
  | 'approved'
  | 'active'
  | 'suspended'
  | 'expiring'
  | 'expired'
  | 'renewed'
  | 'cancelled';

export class ServiceContractService {
  /**
   * Permitted state transitions for contract lifecycle.
   */
  static readonly VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
    draft: ['quoted', 'pending_approval', 'approved', 'active', 'cancelled'],
    quoted: ['pending_approval', 'approved', 'cancelled'],
    pending_approval: ['approved', 'draft', 'cancelled'],
    approved: ['active', 'cancelled'],
    active: ['suspended', 'expiring', 'expired', 'renewed', 'cancelled'],
    suspended: ['active', 'cancelled'],
    expiring: ['expired', 'renewed', 'cancelled'],
    expired: ['renewed'],
    renewed: [],
    cancelled: [],
  };

  /**
   * Verifies if status transition is valid according to state machine rules.
   */
  static isValidTransition(current: ContractStatus, next: ContractStatus): boolean {
    const allowed = this.VALID_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  /**
   * Creates a draft service contract.
   */
  static async createContract(client: SupabaseClient, dto: ContractCreateDto) {
    const { data, error } = await client
      .from('amc_contracts')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        customer_id: dto.customerId,
        site_id: dto.siteId || null,
        contract_type: dto.contractType || 'amc',
        start_date: dto.startDate,
        end_date: dto.endDate,
        contract_value: dto.contractValue,
        tax_amount: dto.taxAmount || 0,
        billing_frequency: dto.billingFrequency || 'quarterly',
        service_frequency: dto.serviceFrequency || 'quarterly',
        currency: dto.currency || 'INR',
        description: dto.description || null,
        terms_and_conditions: dto.termsAndConditions || null,
        renewal_settings: dto.renewalSettings || {},
        notes: dto.notes || null,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw new Error(`Contract creation failed: ${error.message}`);
    return data;
  }

  /**
   * Retrieves single contract details with covered assets and entitlements.
   */
  static async getContract(client: SupabaseClient, contractId: string) {
    const { data, error } = await client
      .from('amc_contracts')
      .select(
        `*,
        customer:customers(id, name, code),
        site:customer_sites(id, name),
        covered_assets:amc_contract_assets(*, asset:customer_assets(id, name, serial_number)),
        entitlements:contract_entitlements(*),
        billing_schedules:contract_billing_schedules(*),
        sla:contract_slas(*)`
      )
      .eq('id', contractId)
      .single();

    if (error) throw new Error(`Contract fetch failed: ${error.message}`);
    return data;
  }

  /**
   * Lists contracts with optional filtering.
   */
  static async listContracts(
    client: SupabaseClient,
    companyId: string,
    filters: { customerId?: string; status?: string; contractType?: string } = {}
  ) {
    let query = client
      .from('amc_contracts')
      .select('*, customer:customers(id, name, code)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (filters.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.contractType) query = query.eq('contract_type', filters.contractType);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list contracts: ${error.message}`);
    return data;
  }

  /**
   * Approves a contract.
   */
  static async approveContract(client: SupabaseClient, contractId: string, approverId?: string) {
    const { data: current, error: cErr } = await client
      .from('amc_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (cErr || !current) throw new Error(`Contract not found: ${contractId}`);
    if (!this.isValidTransition(current.status as ContractStatus, 'approved')) {
      throw new Error(`Cannot approve contract in status '${current.status}'`);
    }

    const { data, error } = await client
      .from('amc_contracts')
      .update({
        status: 'approved',
        approved_by: approverId || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();

    if (error) throw new Error(`Contract approval failed: ${error.message}`);
    return data;
  }

  /**
   * Activates an approved or draft contract.
   */
  static async activateContract(client: SupabaseClient, contractId: string) {
    const { data: current, error: cErr } = await client
      .from('amc_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (cErr || !current) throw new Error(`Contract not found: ${contractId}`);
    if (!this.isValidTransition(current.status as ContractStatus, 'active')) {
      throw new Error(`Cannot activate contract in status '${current.status}'`);
    }

    const { data, error } = await client
      .from('amc_contracts')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();

    if (error) throw new Error(`Contract activation failed: ${error.message}`);
    return data;
  }

  /**
   * Suspends an active contract.
   */
  static async suspendContract(
    client: SupabaseClient,
    contractId: string,
    reason: string,
    userId?: string
  ) {
    const { data: current, error: cErr } = await client
      .from('amc_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (cErr || !current) throw new Error(`Contract not found: ${contractId}`);
    if (!this.isValidTransition(current.status as ContractStatus, 'suspended')) {
      throw new Error(`Cannot suspend contract in status '${current.status}'`);
    }

    const { data, error } = await client
      .from('amc_contracts')
      .update({
        status: 'suspended',
        suspended_at: new Date().toISOString(),
        suspended_by: userId || null,
        suspension_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();

    if (error) throw new Error(`Contract suspension failed: ${error.message}`);
    return data;
  }

  /**
   * Resumes a suspended contract.
   */
  static async resumeContract(client: SupabaseClient, contractId: string) {
    const { data: current, error: cErr } = await client
      .from('amc_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (cErr || !current) throw new Error(`Contract not found: ${contractId}`);
    if (!this.isValidTransition(current.status as ContractStatus, 'active')) {
      throw new Error(`Cannot resume contract in status '${current.status}'`);
    }

    const { data, error } = await client
      .from('amc_contracts')
      .update({
        status: 'active',
        resumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();

    if (error) throw new Error(`Contract resumption failed: ${error.message}`);
    return data;
  }

  /**
   * Cancels a contract preserving historical records.
   */
  static async cancelContract(
    client: SupabaseClient,
    contractId: string,
    reason: string,
    userId?: string
  ) {
    const { data: current, error: cErr } = await client
      .from('amc_contracts')
      .select('status')
      .eq('id', contractId)
      .single();

    if (cErr || !current) throw new Error(`Contract not found: ${contractId}`);
    if (!this.isValidTransition(current.status as ContractStatus, 'cancelled')) {
      throw new Error(`Cannot cancel contract in status '${current.status}'`);
    }

    const { data, error } = await client
      .from('amc_contracts')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId || null,
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();

    if (error) throw new Error(`Contract cancellation failed: ${error.message}`);
    return data;
  }

  /**
   * Converts an accepted quotation to a service contract via RPC.
   */
  static async convertQuotationToContract(
    client: SupabaseClient,
    quotationId: string,
    options: { contractType?: string; billingFrequency?: string; serviceFrequency?: string } = {}
  ) {
    const { data, error } = await client.rpc('convert_quotation_to_contract', {
      p_quotation_id: quotationId,
      p_contract_type: options.contractType || 'amc',
      p_billing_frequency: options.billingFrequency || 'quarterly',
      p_service_frequency: options.serviceFrequency || 'quarterly',
    });

    if (error) throw new Error(`Quotation conversion failed: ${error.message}`);
    return data;
  }
}
