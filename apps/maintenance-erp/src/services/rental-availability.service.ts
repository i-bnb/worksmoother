import { SupabaseClient } from '@supabase/supabase-js';

export interface DateRange {
  start: string | Date;
  end: string | Date;
}

export interface AvailabilityCheckResult {
  isAvailable: boolean;
  assetId: string;
  assetCode?: string;
  startDate: string;
  endDate: string;
  bufferDays: number;
  reason?: string;
}

export class RentalAvailabilityService {
  /**
   * Pure algorithm checking whether two date intervals overlap, factoring in turnaround buffer days.
   */
  static checkOverlap(
    rangeA: DateRange,
    rangeB: DateRange,
    bufferDays: number = 0
  ): boolean {
    const startA = typeof rangeA.start === 'string' ? new Date(rangeA.start) : rangeA.start;
    const endA = typeof rangeA.end === 'string' ? new Date(rangeA.end) : rangeA.end;
    const startB = typeof rangeB.start === 'string' ? new Date(rangeB.start) : rangeB.start;
    const endB = typeof rangeB.end === 'string' ? new Date(rangeB.end) : rangeB.end;

    // Expand rangeB by bufferDays on either side
    const bufferMs = bufferDays * 24 * 60 * 60 * 1000;
    const bufferedStartB = new Date(startB.getTime() - bufferMs);
    const bufferedEndB = new Date(endB.getTime() + bufferMs);

    return startA <= bufferedEndB && endA >= bufferedStartB;
  }

  /**
   * Pure evaluation of an asset's availability given its current status, reservations, and requested window.
   */
  static evaluateAvailability(
    asset: {
      id: string;
      assetCode?: string;
      rentalStatus: string;
      turnaroundBufferDays?: number;
    },
    reservations: Array<{
      id?: string;
      startDate: string | Date;
      endDate: string | Date;
      status: string;
    }>,
    requestedRange: DateRange,
    bufferOverride?: number
  ): AvailabilityCheckResult {
    const start = typeof requestedRange.start === 'string' ? requestedRange.start : requestedRange.start.toISOString().split('T')[0];
    const end = typeof requestedRange.end === 'string' ? requestedRange.end : requestedRange.end.toISOString().split('T')[0];
    const buffer = bufferOverride ?? asset.turnaroundBufferDays ?? 1;

    // 1. Check operational status
    const nonRentableStatuses = ['maintenance', 'damaged', 'retired', 'lost'];
    if (nonRentableStatuses.includes(asset.rentalStatus)) {
      return {
        isAvailable: false,
        assetId: asset.id,
        assetCode: asset.assetCode,
        startDate: start,
        endDate: end,
        bufferDays: buffer,
        reason: `Asset is currently in non-rentable status: ${asset.rentalStatus}`,
      };
    }

    // 2. Check confirmed reservations
    const confirmedReservations = reservations.filter((r) => r.status === 'confirmed');
    for (const res of confirmedReservations) {
      if (this.checkOverlap(requestedRange, { start: res.startDate, end: res.endDate }, buffer)) {
        return {
          isAvailable: false,
          assetId: asset.id,
          assetCode: asset.assetCode,
          startDate: start,
          endDate: end,
          bufferDays: buffer,
          reason: `Asset has conflicting confirmed reservation from ${res.startDate} to ${res.endDate} with ${buffer} day(s) buffer`,
        };
      }
    }

    return {
      isAvailable: true,
      assetId: asset.id,
      assetCode: asset.assetCode,
      startDate: start,
      endDate: end,
      bufferDays: buffer,
    };
  }

  /**
   * Queries database RPC to check live availability.
   */
  static async checkAvailabilityLive(
    client: SupabaseClient,
    assetId: string,
    startDate: string,
    endDate: string,
    bufferDays?: number
  ): Promise<AvailabilityCheckResult> {
    const { data, error } = await client.rpc('check_rental_asset_availability', {
      p_asset_id: assetId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_buffer_days: bufferDays ?? null,
    });

    if (error) throw error;

    return {
      isAvailable: Boolean(data?.is_available),
      assetId: assetId,
      assetCode: data?.asset_code,
      startDate: startDate,
      endDate: endDate,
      bufferDays: data?.buffer_days ?? bufferDays ?? 1,
      reason: data?.reason,
    };
  }

  /**
   * Search for all rentable assets matching filters and available in the given date range.
   */
  static async searchAvailableFleet(
    client: SupabaseClient,
    params: {
      companyId: string;
      category?: string;
      startDate: string;
      endDate: string;
      bufferDays?: number;
    }
  ): Promise<string[]> {
    let query = client
      .from('rental_assets')
      .select('id, asset_code, rental_status, turnaround_buffer_days')
      .eq('company_id', params.companyId)
      .eq('is_active', true)
      .not('rental_status', 'in', '("maintenance","damaged","retired","lost")');

    if (params.category) {
      query = query.eq('category', params.category);
    }

    const { data: assets, error } = await query;
    if (error) throw error;
    if (!assets || assets.length === 0) return [];

    const availableAssetIds: string[] = [];

    for (const a of assets) {
      const { data: reservations } = await client
        .from('rental_reservations')
        .select('start_date, end_date, status')
        .eq('rental_asset_id', a.id)
        .eq('status', 'confirmed');

      const evalResult = this.evaluateAvailability(
        {
          id: a.id,
          assetCode: a.asset_code,
          rentalStatus: a.rental_status,
          turnaroundBufferDays: a.turnaround_buffer_days,
        },
        (reservations || []).map((r) => ({
          startDate: r.start_date,
          endDate: r.end_date,
          status: r.status,
        })),
        { start: params.startDate, end: params.endDate },
        params.bufferDays
      );

      if (evalResult.isAvailable) {
        availableAssetIds.push(a.id);
      }
    }

    return availableAssetIds;
  }
}
