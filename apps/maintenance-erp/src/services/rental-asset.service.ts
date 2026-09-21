import { SupabaseClient } from '@supabase/supabase-js';

export type RentalAssetStatus =
  | 'available'
  | 'reserved'
  | 'out_for_rental'
  | 'return_pending'
  | 'returned'
  | 'under_inspection'
  | 'maintenance'
  | 'damaged'
  | 'lost'
  | 'retired';

export type OwnershipType = 'owned' | 'leased' | 'third_party';

export interface RentalAsset {
  id: string;
  companyId: string;
  branchId?: string | null;
  assetCode: string;
  name: string;
  category?: string | null;
  itemId?: string | null;
  serialNumberId?: string | null;
  serialNumber?: string | null;
  rentalStatus: RentalAssetStatus;
  currentLocationId?: string | null;
  currentCustomerId?: string | null;
  currentSiteId?: string | null;
  ownershipType: OwnershipType;
  registrationNumber?: string | null;
  customerAssetId?: string | null;
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  depositAmount: number;
  condition: string;
  meterReading: number;
  meterUnit: string;
  meterRatePerUnit: number;
  includedUnitsPerDay: number;
  maintenanceIntervalUnits?: number | null;
  lastMaintenanceMeter: number;
  turnaroundBufferDays: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRentalAssetDTO {
  companyId: string;
  branchId?: string;
  assetCode: string;
  name: string;
  category?: string;
  itemId?: string;
  serialNumberId?: string;
  serialNumber?: string;
  currentLocationId?: string;
  ownershipType?: OwnershipType;
  registrationNumber?: string;
  customerAssetId?: string;
  dailyRate: number;
  weeklyRate?: number;
  monthlyRate?: number;
  depositAmount?: number;
  condition?: string;
  meterReading?: number;
  meterUnit?: string;
  meterRatePerUnit?: number;
  includedUnitsPerDay?: number;
  maintenanceIntervalUnits?: number;
  turnaroundBufferDays?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateRentalAssetDTO {
  name?: string;
  category?: string;
  currentLocationId?: string;
  dailyRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  depositAmount?: number;
  condition?: string;
  meterReading?: number;
  meterRatePerUnit?: number;
  includedUnitsPerDay?: number;
  maintenanceIntervalUnits?: number;
  turnaroundBufferDays?: number;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

const VALID_ASSET_TRANSITIONS: Record<RentalAssetStatus, RentalAssetStatus[]> = {
  available: ['reserved', 'out_for_rental', 'maintenance', 'retired'],
  reserved: ['available', 'out_for_rental', 'maintenance'],
  out_for_rental: ['return_pending', 'returned', 'lost'],
  return_pending: ['returned', 'lost'],
  returned: ['under_inspection', 'available', 'maintenance', 'damaged'],
  under_inspection: ['available', 'maintenance', 'damaged', 'retired'],
  maintenance: ['available', 'under_inspection', 'retired'],
  damaged: ['under_inspection', 'maintenance', 'retired'],
  lost: ['available', 'retired'], // If recovered or written off
  retired: [], // Terminal
};

export class RentalAssetService {
  /**
   * Pure domain validation of asset status lifecycle transitions.
   */
  static validateStatusTransition(currentStatus: RentalAssetStatus, newStatus: RentalAssetStatus): boolean {
    if (currentStatus === newStatus) return true;
    const allowed = VALID_ASSET_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(newStatus) : false;
  }

  /**
   * Checks whether the asset requires preventive maintenance based on accrued meter units.
   */
  static needsMaintenance(asset: {
    meterReading: number;
    lastMaintenanceMeter: number;
    maintenanceIntervalUnits?: number | null;
  }): boolean {
    if (!asset.maintenanceIntervalUnits || asset.maintenanceIntervalUnits <= 0) {
      return false;
    }
    const accrued = asset.meterReading - asset.lastMaintenanceMeter;
    return accrued >= asset.maintenanceIntervalUnits;
  }

  /**
   * Register a new rental asset.
   */
  static async createAsset(client: SupabaseClient, dto: CreateRentalAssetDTO): Promise<RentalAsset> {
    const payload: Record<string, unknown> = {
      company_id: dto.companyId,
      branch_id: dto.branchId || null,
      asset_code: dto.assetCode,
      name: dto.name,
      category: dto.category || null,
      item_id: dto.itemId || null,
      serial_number_id: dto.serialNumberId || null,
      serial_number: dto.serialNumber || null,
      current_location_id: dto.currentLocationId || null,
      ownership_type: dto.ownershipType || 'owned',
      registration_number: dto.registrationNumber || null,
      customer_asset_id: dto.customerAssetId || null,
      daily_rate: dto.dailyRate,
      weekly_rate: dto.weeklyRate ?? dto.dailyRate * 5,
      monthly_rate: dto.monthlyRate ?? dto.dailyRate * 20,
      deposit_amount: dto.depositAmount ?? 0,
      condition: dto.condition || 'good',
      meter_reading: dto.meterReading ?? 0,
      meter_unit: dto.meterUnit || 'hours',
      meter_rate_per_unit: dto.meterRatePerUnit ?? 0,
      included_units_per_day: dto.includedUnitsPerDay ?? 8.0,
      maintenance_interval_units: dto.maintenanceIntervalUnits || null,
      turnaround_buffer_days: dto.turnaroundBufferDays ?? 1,
      rental_status: 'available',
      metadata: dto.metadata || {},
    };

    const { data, error } = await client
      .from('rental_assets')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return this.mapRowToAsset(data);
  }

  /**
   * Retrieve rental asset by ID.
   */
  static async getAssetById(client: SupabaseClient, id: string): Promise<RentalAsset | null> {
    const { data, error } = await client
      .from('rental_assets')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return this.mapRowToAsset(data);
  }

  /**
   * Update rental asset attributes.
   */
  static async updateAsset(client: SupabaseClient, id: string, dto: UpdateRentalAssetDTO): Promise<RentalAsset> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.currentLocationId !== undefined) patch.current_location_id = dto.currentLocationId;
    if (dto.dailyRate !== undefined) patch.daily_rate = dto.dailyRate;
    if (dto.weeklyRate !== undefined) patch.weekly_rate = dto.weeklyRate;
    if (dto.monthlyRate !== undefined) patch.monthly_rate = dto.monthlyRate;
    if (dto.depositAmount !== undefined) patch.deposit_amount = dto.depositAmount;
    if (dto.condition !== undefined) patch.condition = dto.condition;
    if (dto.meterReading !== undefined) patch.meter_reading = dto.meterReading;
    if (dto.meterRatePerUnit !== undefined) patch.meter_rate_per_unit = dto.meterRatePerUnit;
    if (dto.includedUnitsPerDay !== undefined) patch.included_units_per_day = dto.includedUnitsPerDay;
    if (dto.maintenanceIntervalUnits !== undefined) patch.maintenance_interval_units = dto.maintenanceIntervalUnits;
    if (dto.turnaroundBufferDays !== undefined) patch.turnaround_buffer_days = dto.turnaroundBufferDays;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (dto.metadata !== undefined) patch.metadata = dto.metadata;

    const { data, error } = await client
      .from('rental_assets')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRowToAsset(data);
  }

  /**
   * Transition asset status with state machine enforcement.
   */
  static async transitionStatus(
    client: SupabaseClient,
    id: string,
    newStatus: RentalAssetStatus
  ): Promise<RentalAsset> {
    const asset = await this.getAssetById(client, id);
    if (!asset) throw new Error(`Rental asset ${id} not found`);

    if (!this.validateStatusTransition(asset.rentalStatus, newStatus)) {
      throw new Error(`Invalid status transition from '${asset.rentalStatus}' to '${newStatus}'`);
    }

    const { data, error } = await client
      .from('rental_assets')
      .update({ rental_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRowToAsset(data);
  }

  private static mapRowToAsset(row: Record<string, unknown>): RentalAsset {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      branchId: row.branch_id as string | null,
      assetCode: row.asset_code as string,
      name: row.name as string,
      category: row.category as string | null,
      itemId: row.item_id as string | null,
      serialNumberId: row.serial_number_id as string | null,
      serialNumber: row.serial_number as string | null,
      rentalStatus: row.rental_status as RentalAssetStatus,
      currentLocationId: row.current_location_id as string | null,
      currentCustomerId: row.current_customer_id as string | null,
      currentSiteId: row.current_site_id as string | null,
      ownershipType: (row.ownership_type as OwnershipType) || 'owned',
      registrationNumber: row.registration_number as string | null,
      customerAssetId: row.customer_asset_id as string | null,
      dailyRate: Number(row.daily_rate ?? 0),
      weeklyRate: Number(row.weekly_rate ?? 0),
      monthlyRate: Number(row.monthly_rate ?? 0),
      depositAmount: Number(row.deposit_amount ?? 0),
      condition: (row.condition as string) || 'good',
      meterReading: Number(row.meter_reading ?? 0),
      meterUnit: (row.meter_unit as string) || 'hours',
      meterRatePerUnit: Number(row.meter_rate_per_unit ?? 0),
      includedUnitsPerDay: Number(row.included_units_per_day ?? 8.0),
      maintenanceIntervalUnits: row.maintenance_interval_units ? Number(row.maintenance_interval_units) : null,
      lastMaintenanceMeter: Number(row.last_maintenance_meter ?? 0),
      turnaroundBufferDays: Number(row.turnaround_buffer_days ?? 1),
      isActive: Boolean(row.is_active ?? true),
      metadata: (row.metadata as Record<string, unknown>) || {},
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
