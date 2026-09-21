/**
 * =============================================================================
 * Customer AMC Contracts & Equipment Rental Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  AmcRenewalRequestDto,
  RentalReturnOrExtensionDto,
  CustomerSafeAmcContractDto,
  CustomerSafeRentalDto,
} from '../schemas/customer-feedback.schema.js';

export class CustomerContractsRentalService {
  /**
   * Lists customer AMC service contracts.
   */
  static async listContracts(
    client: SupabaseClient,
    customerId: string
  ): Promise<CustomerSafeAmcContractDto[]> {
    if (!customerId) throw new Error('customerId is required');

    const { data: contracts, error } = await client
      .from('amc_contracts')
      .select(`
        id,
        contract_number,
        name,
        start_date,
        end_date,
        status,
        billing_frequency,
        total_preventive_visits,
        completed_preventive_visits,
        amc_contract_assets (
          asset_id,
          customer_assets (
            id,
            name,
            asset_code,
            customer_sites (name)
          )
        )
      `)
      .eq('customer_id', customerId)
      .not('status', 'eq', 'draft')
      .order('end_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to list AMC contracts: ${error.message}`);
    }

    return (contracts || []).map((c: any) => {
      const rawAssets = (c.amc_contract_assets as any[]) || [];
      const coveredAssets = rawAssets
        .filter((ca) => ca.customer_assets)
        .map((ca) => {
          const a = ca.customer_assets;
          const site = a.customer_sites as any;
          return {
            assetId: a.id,
            assetName: a.name,
            assetCode: a.asset_code,
            siteName: site?.name,
          };
        });

      const totalVisits = Number(c.total_preventive_visits || 0);
      const completedVisits = Number(c.completed_preventive_visits || 0);
      const remainingVisits = Math.max(0, totalVisits - completedVisits);

      return {
        id: c.id,
        contractNumber: c.contract_number,
        contractName: c.name || `AMC Contract ${c.contract_number}`,
        startDate: c.start_date,
        endDate: c.end_date,
        status: c.status,
        billingFrequency: c.billing_frequency || 'quarterly',
        totalPreventiveVisits: totalVisits,
        completedVisits,
        remainingVisits,
        coveredAssetsCount: coveredAssets.length,
        coveredAssets,
      };
    });
  }

  /**
   * Retrieves single AMC contract detail for the customer.
   */
  static async getContractDetail(
    client: SupabaseClient,
    customerId: string,
    contractId: string
  ): Promise<CustomerSafeAmcContractDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!contractId) throw new Error('contractId is required');

    const { data: c, error } = await client
      .from('amc_contracts')
      .select(`
        id,
        contract_number,
        name,
        start_date,
        end_date,
        status,
        billing_frequency,
        total_preventive_visits,
        completed_preventive_visits,
        amc_contract_assets (
          asset_id,
          customer_assets (
            id,
            name,
            asset_code,
            customer_sites (name)
          )
        )
      `)
      .eq('id', contractId)
      .eq('customer_id', customerId)
      .single();

    if (error || !c) {
      throw new Error('AMC contract not found or does not belong to your account');
    }

    const rawAssets = (c.amc_contract_assets as any[]) || [];
    const coveredAssets = rawAssets
      .filter((ca) => ca.customer_assets)
      .map((ca) => {
        const a = ca.customer_assets;
        const site = a.customer_sites as any;
        return {
          assetId: a.id,
          assetName: a.name,
          assetCode: a.asset_code,
          siteName: site?.name,
        };
      });

    const totalVisits = Number(c.total_preventive_visits || 0);
    const completedVisits = Number(c.completed_preventive_visits || 0);

    return {
      id: c.id,
      contractNumber: c.contract_number,
      contractName: c.name || `AMC Contract ${c.contract_number}`,
      startDate: c.start_date,
      endDate: c.end_date,
      status: c.status,
      billingFrequency: c.billing_frequency || 'quarterly',
      totalPreventiveVisits: totalVisits,
      completedVisits,
      remainingVisits: Math.max(0, totalVisits - completedVisits),
      coveredAssetsCount: coveredAssets.length,
      coveredAssets,
    };
  }

  /**
   * Submits a customer request to renew an AMC contract.
   */
  static async requestRenewal(
    client: SupabaseClient,
    dto: AmcRenewalRequestDto,
    userId?: string
  ): Promise<{ success: boolean; contractNumber: string }> {
    const contract = await this.getContractDetail(client, dto.customerId, dto.contractId);

    // Emit domain event for renewal request
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'PORTAL_AMC_RENEWAL_REQUESTED',
        entity_type: 'amc_contract',
        entity_id: dto.contractId,
        actor_id: userId || null,
        payload: {
          contract_number: contract.contractNumber,
          customer_id: dto.customerId,
          notes: dto.notes || 'Customer requested renewal via portal',
        },
      });
    } catch {
      // ignore
    }

    return {
      success: true,
      contractNumber: contract.contractNumber,
    };
  }

  /**
   * Lists active and past equipment rentals for the customer.
   */
  static async listRentals(
    client: SupabaseClient,
    customerId: string
  ): Promise<CustomerSafeRentalDto[]> {
    if (!customerId) throw new Error('customerId is required');

    const { data: rentals, error } = await client
      .from('rental_contracts')
      .select(`
        id,
        contract_number,
        status,
        start_date,
        end_date,
        rental_contract_lines (
          id,
          daily_rate,
          quantity,
          rental_assets (
            id,
            name,
            serial_number
          )
        )
      `)
      .eq('customer_id', customerId)
      .order('end_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to list equipment rentals: ${error.message}`);
    }

    return (rentals || []).map((r: any) => {
      const lines = (r.rental_contract_lines as any[]) || [];
      const items = lines.map((l) => {
        const asset = l.rental_assets as any;
        return {
          assetName: asset?.name || 'Rented Equipment',
          serialNumber: asset?.serial_number || null,
          dailyRate: Number(l.daily_rate || 0),
          quantity: Number(l.quantity || 1),
        };
      });

      const start = new Date(r.start_date).getTime();
      const end = new Date(r.end_date).getTime();
      const totalDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));

      return {
        id: r.id,
        contractNumber: r.contract_number,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
        totalDays,
        itemsCount: items.length,
        items,
      };
    });
  }

  /**
   * Requests a rental extension or return pickup.
   */
  static async requestRentalExtensionOrReturn(
    client: SupabaseClient,
    dto: RentalReturnOrExtensionDto,
    userId?: string
  ): Promise<{ success: boolean; action: string }> {
    const { data: rental, error } = await client
      .from('rental_contracts')
      .select('id, contract_number, status')
      .eq('id', dto.rentalContractId)
      .eq('customer_id', dto.customerId)
      .single();

    if (error || !rental) {
      throw new Error('Rental contract not found or does not belong to your account');
    }

    const eventType =
      dto.action === 'extend'
        ? 'PORTAL_RENTAL_EXTENSION_REQUESTED'
        : 'PORTAL_RENTAL_RETURN_PICKUP_REQUESTED';

    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: eventType,
        entity_type: 'rental_contract',
        entity_id: dto.rentalContractId,
        actor_id: userId || null,
        payload: {
          contract_number: rental.contract_number,
          customer_id: dto.customerId,
          action: dto.action,
          requested_end_date: dto.requestedEndDate || null,
          pickup_address: dto.pickupAddress || null,
          notes: dto.notes || null,
        },
      });
    } catch {
      // ignore
    }

    return {
      success: true,
      action: dto.action,
    };
  }
}
