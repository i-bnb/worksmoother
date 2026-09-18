import { AvailabilitySlot, SlotHoldRequest, SlotHoldResult } from '@doctorcare/shared';

export interface ConfirmSlotRequest {
  slot_key: string;
  idempotency_key: string;
}

export interface ReleaseSlotRequest {
  slot_key: string;
  idempotency_key: string;
}

interface SlotRow {
  slot_key: string;
  doctor_id: string;
  start_time_utc: string;
  end_time_utc: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED';
  patient_id: string | null;
  idempotency_key: string | null;
  hold_expires_at: number | null;
  created_at: number;
}

/**
 * SlotDurableObject
 * Cloudflare Workers Durable Object sharded per doctor-day ({doctorId}:{dateUtc}).
 * Single-threads all booking mutations to eliminate database race conditions.
 * Uses native SQLite storage and setAlarm() for automatic 10-minute hold release.
 */
export class SlotDurableObject {
  private ctx: DurableObjectState;
  private env: unknown;
  private hasSql: boolean;
  // In-memory fallback map if SQL is simulated or mocked
  private memorySlots: Map<string, SlotRow> = new Map();

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
    this.hasSql = Boolean(this.ctx.storage && (this.ctx.storage as any).sql);

    if (this.hasSql) {
      (this.ctx.storage as any).sql.exec(`
        CREATE TABLE IF NOT EXISTS slots (
          slot_key TEXT PRIMARY KEY,
          doctor_id TEXT NOT NULL,
          start_time_utc TEXT NOT NULL,
          end_time_utc TEXT NOT NULL,
          status TEXT NOT NULL,
          patient_id TEXT,
          idempotency_key TEXT,
          hold_expires_at INTEGER,
          created_at INTEGER NOT NULL
        );
      `);
    }
  }

  /**
   * Cloudflare Workers Alarm Handler
   * Automatically triggered when setAlarm() fires.
   * Releases all expired holds (held > 10 minutes) back to AVAILABLE.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    console.log(`[Slot DO Alarm] Checking and releasing expired holds at ${new Date(now).toISOString()}...`);

    if (this.hasSql) {
      const sql = (this.ctx.storage as any).sql;
      // 1. Release expired holds
      sql.exec(
        `UPDATE slots
         SET status = 'AVAILABLE', patient_id = NULL, idempotency_key = NULL, hold_expires_at = NULL
         WHERE status = 'HELD' AND hold_expires_at <= ?`,
        now
      );

      // 2. Schedule next alarm if any other active holds exist
      const cursor = sql.exec(
        `SELECT MIN(hold_expires_at) as next_alarm
         FROM slots
         WHERE status = 'HELD' AND hold_expires_at > ?`,
        now
      );
      const rows = [...cursor];
      if (rows.length > 0 && rows[0].next_alarm) {
        await this.ctx.storage.setAlarm(rows[0].next_alarm);
      }
    } else {
      // Memory fallback for mock tests
      for (const [key, slot] of this.memorySlots.entries()) {
        if (slot.status === 'HELD' && slot.hold_expires_at && slot.hold_expires_at <= now) {
          slot.status = 'AVAILABLE';
          slot.patient_id = null;
          slot.idempotency_key = null;
          slot.hold_expires_at = null;
          this.memorySlots.set(key, slot);
        }
      }
    }
  }

  /**
   * HTTP router for internal Durable Object invocations
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/slots/hold' && request.method === 'POST') {
        const body = (await request.json()) as SlotHoldRequest;
        const result = await this.hold(body);
        const status = result.success ? 200 : (result as any).status || 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/slots/confirm' && request.method === 'POST') {
        const body = (await request.json()) as ConfirmSlotRequest;
        const result = await this.confirm(body);
        const status = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/slots/release' && request.method === 'POST') {
        const body = (await request.json()) as ReleaseSlotRequest;
        const result = await this.release(body);
        const status = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/slots' && request.method === 'GET') {
        const slots = await this.getSlots();
        return new Response(JSON.stringify({ slots }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Endpoint not found in Slot DO' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Slot DO execution error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Locks a timeslot in SQLite and configures setAlarm() to release the hold after 10 minutes.
   * Eliminates race conditions by executing within the single-threaded actor.
   */
  async hold(request: SlotHoldRequest): Promise<SlotHoldResult | { success: false; error: string; status: number }> {
    const { doctor_id, start_time_utc, end_time_utc, patient_id, idempotency_key } = request;
    const slot_key = `${doctor_id}:${start_time_utc}`;
    const now = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const holdExpiresMs = now + tenMinutesMs;

    const existing = await this.getSlotRow(slot_key);

    if (existing) {
      // 1. If slot is already booked, reject
      if (existing.status === 'BOOKED') {
        return {
          success: false,
          error: 'SLOT_ALREADY_BOOKED: This timeslot is already confirmed and booked.',
          status: 409,
        };
      }

      // 2. If slot is currently held
      if (existing.status === 'HELD') {
        const isStillValid = existing.hold_expires_at && existing.hold_expires_at > now;

        if (isStillValid) {
          // Check for idempotent replay with matching key and patient
          if (existing.idempotency_key === idempotency_key && existing.patient_id === patient_id) {
            return {
              success: true,
              slot_key,
              doctor_id,
              patient_id,
              status: 'HELD',
              hold_expires_at: new Date(existing.hold_expires_at!).toISOString(),
              hold_expires_timestamp_ms: existing.hold_expires_at!,
              idempotency_key,
              idempotent_replay: true,
            };
          }

          // Slot is held by another transaction/patient
          return {
            success: false,
            error: 'SLOT_CURRENTLY_HELD: This timeslot is temporarily locked by another reservation.',
            status: 409,
          };
        }
        // If expired, fall through to re-claim hold
      }
    }

    // 3. Lock timeslot in SQLite with HELD status and 10-minute hold expiration
    const slotRow: SlotRow = {
      slot_key,
      doctor_id,
      start_time_utc,
      end_time_utc,
      status: 'HELD',
      patient_id,
      idempotency_key,
      hold_expires_at: holdExpiresMs,
      created_at: existing ? existing.created_at : now,
    };

    await this.saveSlotRow(slotRow);

    // 4. Configure setAlarm() to automatically release the hold after 10 minutes
    if (this.ctx.storage.setAlarm) {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm || holdExpiresMs < currentAlarm) {
        await this.ctx.storage.setAlarm(holdExpiresMs);
      }
    }

    return {
      success: true,
      slot_key,
      doctor_id,
      patient_id,
      status: 'HELD',
      hold_expires_at: new Date(holdExpiresMs).toISOString(),
      hold_expires_timestamp_ms: holdExpiresMs,
      idempotency_key,
    };
  }

  /**
   * Confirms a held booking, converting status to BOOKED
   */
  async confirm(request: ConfirmSlotRequest): Promise<{ success: boolean; error?: string }> {
    const { slot_key, idempotency_key } = request;
    const existing = await this.getSlotRow(slot_key);

    if (!existing) {
      return { success: false, error: 'Slot not found' };
    }

    if (existing.status === 'BOOKED') {
      return { success: true }; // Already booked (idempotent)
    }

    if (existing.status !== 'HELD') {
      return { success: false, error: 'Slot must be in HELD status before confirmation' };
    }

    // Convert to BOOKED and clear hold expiration
    existing.status = 'BOOKED';
    existing.hold_expires_at = null;
    await this.saveSlotRow(existing);

    return { success: true };
  }

  /**
   * Explicitly releases a held slot back to AVAILABLE
   */
  async release(request: ReleaseSlotRequest): Promise<{ success: boolean; error?: string }> {
    const { slot_key, idempotency_key } = request;
    const existing = await this.getSlotRow(slot_key);

    if (!existing) {
      return { success: false, error: 'Slot not found' };
    }

    existing.status = 'AVAILABLE';
    existing.patient_id = null;
    existing.idempotency_key = null;
    existing.hold_expires_at = null;
    await this.saveSlotRow(existing);

    return { success: true };
  }

  /**
   * Returns all slots for this doctor-day
   */
  async getSlots(): Promise<AvailabilitySlot[]> {
    const now = Date.now();
    let rows: SlotRow[] = [];

    if (this.hasSql) {
      const sql = (this.ctx.storage as any).sql;
      const cursor = sql.exec(`SELECT * FROM slots ORDER BY start_time_utc ASC`);
      rows = [...cursor] as SlotRow[];
    } else {
      rows = Array.from(this.memorySlots.values());
    }

    return rows.map((r) => {
      // Check if hold has expired
      let status = r.status;
      if (status === 'HELD' && r.hold_expires_at && r.hold_expires_at <= now) {
        status = 'AVAILABLE';
      }

      return {
        slot_key: r.slot_key,
        doctor_id: r.doctor_id,
        start_time_utc: r.start_time_utc,
        end_time_utc: r.end_time_utc,
        status,
        hold_expires_at: r.hold_expires_at ? new Date(r.hold_expires_at).toISOString() : null,
      };
    });
  }

  private async getSlotRow(slot_key: string): Promise<SlotRow | null> {
    if (this.hasSql) {
      const sql = (this.ctx.storage as any).sql;
      const cursor = sql.exec(`SELECT * FROM slots WHERE slot_key = ?`, slot_key);
      const rows = [...cursor] as SlotRow[];
      return rows.length > 0 ? rows[0] : null;
    }
    return this.memorySlots.get(slot_key) || null;
  }

  private async saveSlotRow(row: SlotRow): Promise<void> {
    if (this.hasSql) {
      const sql = (this.ctx.storage as any).sql;
      sql.exec(
        `INSERT OR REPLACE INTO slots (
          slot_key, doctor_id, start_time_utc, end_time_utc, status,
          patient_id, idempotency_key, hold_expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.slot_key,
        row.doctor_id,
        row.start_time_utc,
        row.end_time_utc,
        row.status,
        row.patient_id,
        row.idempotency_key,
        row.hold_expires_at,
        row.created_at
      );
    } else {
      this.memorySlots.set(row.slot_key, { ...row });
    }
  }
}
