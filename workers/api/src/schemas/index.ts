import { z } from 'zod';

/**
 * Strict Zod Schemas for API Worker Routing Layer
 * Every schema applies .strict() to reject and drop unexpected payload fields.
 */

// 1. Slot & Booking Schemas
export const HoldSlotSchema = z
  .object({
    doctor_id: z.string().min(1, 'doctor_id is required'),
    start_time_utc: z.string().datetime({ message: 'start_time_utc must be a valid ISO datetime' }),
    end_time_utc: z.string().datetime({ message: 'end_time_utc must be a valid ISO datetime' }),
    patient_id: z.string().min(1, 'patient_id is required'),
    idempotency_key: z.string().min(1, 'idempotency_key is required'),
  })
  .strict();

export const ConfirmSlotSchema = z
  .object({
    slot_key: z.string().min(1, 'slot_key is required'),
    idempotency_key: z.string().min(1, 'idempotency_key is required'),
  })
  .strict();

export const ReleaseSlotSchema = z
  .object({
    slot_key: z.string().min(1, 'slot_key is required'),
    idempotency_key: z.string().min(1, 'idempotency_key is required'),
  })
  .strict();

// 2. Auth Schemas
export const TokenExchangeSchema = z
  .object({
    jwt: z.string().min(1, 'jwt token is required'),
  })
  .strict();

export const RefreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required'),
    userId: z.string().optional(),
  })
  .strict();

export const MfaVerifySchema = z
  .object({
    factor: z.enum(['totp', 'email', 'phone']),
    code: z.string().min(6, 'code must be at least 6 digits'),
    sessionId: z.string().min(1, 'sessionId is required'),
  })
  .strict();

// 3. Directory Module Schemas
export const CreateHospitalSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    address: z.string().min(1, 'address is required'),
    phone: z.string().min(1, 'phone is required'),
    timezone: z.string().min(1, 'timezone is required'),
  })
  .strict();

export const CreateDepartmentSchema = z
  .object({
    hospital_id: z.string().min(1, 'hospital_id is required'),
    name: z.string().min(1, 'name is required'),
    description: z.string().optional(),
  })
  .strict();

export const CreateDoctorSchema = z
  .object({
    hospital_id: z.string().min(1, 'hospital_id is required'),
    department_id: z.string().min(1, 'department_id is required'),
    name: z.string().min(1, 'name is required'),
    email: z.string().email('valid email required'),
    specialty: z.string().min(1, 'specialty is required'),
    active: z.boolean().default(true),
  })
  .strict();

export const CreateRoomSchema = z
  .object({
    hospital_id: z.string().min(1, 'hospital_id is required'),
    department_id: z.string().min(1, 'department_id is required'),
    room_number: z.string().min(1, 'room_number is required'),
    floor: z.number().int('floor must be an integer'),
    status: z.enum(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE']),
  })
  .strict();

// 4. Operational Appointments Schema
export const CreateAppointmentSchema = z
  .object({
    patientId: z.string().min(1, 'patientId is required'),
    doctorId: z.string().min(1, 'doctorId is required'),
    clinicId: z.string().min(1, 'clinicId is required'),
    scheduledAt: z.string().datetime({ message: 'scheduledAt must be ISO datetime' }),
    status: z.enum(['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED']),
    notes: z.string().optional(),
  })
  .strict();

// 5. Razorpay Payments Schemas (Server-side price derivation enforced via .strict())
export const CreatePaymentOrderSchema = z
  .object({
    doctor_id: z.string().min(1, 'doctor_id is required'),
    slot_key: z.string().min(1, 'slot_key is required'),
    consultation_type: z.enum(['REGULAR', 'SPECIALIST', 'SURGICAL', 'EMERGENCY']),
    patient_id: z.string().min(1, 'patient_id is required'),
  })
  .strict();

export type CreatePaymentOrderDto = z.infer<typeof CreatePaymentOrderSchema>;

export type HoldSlotDto = z.infer<typeof HoldSlotSchema>;
export type ConfirmSlotDto = z.infer<typeof ConfirmSlotSchema>;
export type ReleaseSlotDto = z.infer<typeof ReleaseSlotSchema>;
export type TokenExchangeDto = z.infer<typeof TokenExchangeSchema>;
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;
export type MfaVerifyDto = z.infer<typeof MfaVerifySchema>;
export type CreateHospitalDto = z.infer<typeof CreateHospitalSchema>;
export type CreateDepartmentDto = z.infer<typeof CreateDepartmentSchema>;
export type CreateDoctorDto = z.infer<typeof CreateDoctorSchema>;
export type CreateRoomDto = z.infer<typeof CreateRoomSchema>;
export type CreateAppointmentDto = z.infer<typeof CreateAppointmentSchema>;

/**
 * Validates request body strictly against a Zod schema.
 * Rejects with HTTP 400 if unexpected payload fields are present or validation fails.
 */
export async function validateStrictJson<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ data?: T; errorResponse?: Response }> {
  try {
    const raw = (await request.json().catch(() => null)) as unknown;
    if (raw === null || typeof raw !== 'object') {
      return {
        errorResponse: new Response(
          JSON.stringify({
            error: 'INVALID_JSON',
            message: 'Request body must be a valid JSON object.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        ),
      };
    }

    const data = schema.parse(raw);
    return { data };
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return {
        errorResponse: new Response(
          JSON.stringify({
            error: 'STRICT_VALIDATION_FAILED',
            message: 'Payload failed strict schema validation (unexpected or invalid fields).',
            issues: err.errors.map((e) => ({
              path: e.path.join('.'),
              code: e.code,
              message: e.message,
            })),
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        ),
      };
    }

    return {
      errorResponse: new Response(
        JSON.stringify({ error: 'BAD_REQUEST', message: 'Failed to process request body.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }
}
