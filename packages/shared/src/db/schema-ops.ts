import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// -----------------------------------------------------------------------------
// Identity & Authentication Tables (Edge-Compatible Auth)
// -----------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    role: text('role', { enum: ['admin', 'doctor', 'nurse', 'staff', 'patient'] }).notNull().default('patient'),
    mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
    mfaSecret: text('mfa_secret'),
    image: text('image'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex('idx_users_email').on(table.email),
    roleIdx: index('idx_users_role').on(table.role),
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('idx_sessions_token').on(table.token),
    userIdx: index('idx_sessions_user').on(table.userId),
  })
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    passwordHash: text('password_hash'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: integer('expires_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex('idx_accounts_provider_account').on(table.providerId, table.accountId),
    userIdx: index('idx_accounts_user').on(table.userId),
  })
);

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// -----------------------------------------------------------------------------
// Operational Clinical Directory & Booking Tables
// -----------------------------------------------------------------------------

export const hospital = sqliteTable('hospital', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  tier: text('tier').notNull().default('TERTIARY'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const department = sqliteTable('department', {
  id: text('id').primaryKey(),
  hospitalId: text('hospital_id').notNull().references(() => hospital.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const doctor = sqliteTable(
  'doctor',
  {
    id: text('id').primaryKey(),
    hospitalId: text('hospital_id').notNull().references(() => hospital.id),
    departmentId: text('department_id').notNull().references(() => department.id),
    name: text('name').notNull(),
    specialization: text('specialization').notNull(),
    registrationNumber: text('registration_number').notNull().unique(),
    consultationFee: integer('consultation_fee').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    deptIdx: index('idx_doctor_department').on(table.departmentId),
    regIdx: uniqueIndex('idx_doctor_registration').on(table.registrationNumber),
  })
);

export const room = sqliteTable('room', {
  id: text('id').primaryKey(),
  hospitalId: text('hospital_id').notNull().references(() => hospital.id),
  departmentId: text('department_id').notNull().references(() => department.id),
  roomNumber: text('room_number').notNull(),
  roomType: text('room_type').notNull().default('CONSULTATION'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const availabilitySlot = sqliteTable(
  'availability_slot',
  {
    id: text('id').primaryKey(),
    slotKey: text('slot_key').notNull().unique(),
    doctorId: text('doctor_id').notNull().references(() => doctor.id),
    hospitalId: text('hospital_id').notNull().references(() => hospital.id),
    slotDate: text('slot_date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    status: text('status', { enum: ['AVAILABLE', 'HELD', 'BOOKED'] }).notNull().default('AVAILABLE'),
    heldBy: text('held_by'),
    heldUntil: integer('held_until'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    slotKeyIdx: uniqueIndex('idx_slot_key_unique').on(table.slotKey),
    doctorDateIdx: index('idx_slot_doctor_date').on(table.doctorId, table.slotDate),
    statusIdx: index('idx_slot_status').on(table.status),
  })
);

export const booking = sqliteTable(
  'booking',
  {
    id: text('id').primaryKey(),
    bookingNumber: text('booking_number').notNull().unique(),
    patientId: text('patient_id').notNull(),
    doctorId: text('doctor_id').notNull().references(() => doctor.id),
    hospitalId: text('hospital_id').notNull().references(() => hospital.id),
    slotKey: text('slot_key').notNull(),
    status: text('status', { enum: ['INITIATED', 'CONFIRMED', 'CANCELLED', 'COMPLETED'] }).notNull().default('INITIATED'),
    amount: integer('amount').notNull(),
    paymentId: text('payment_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    patientIdx: index('idx_booking_patient').on(table.patientId),
    slotIdx: index('idx_booking_slot').on(table.slotKey),
    statusIdx: index('idx_booking_status').on(table.status),
  })
);

export const consentLog = sqliteTable(
  'consent_log',
  {
    id: text('id').primaryKey(),
    patientId: text('patient_id').notNull(),
    hospitalId: text('hospital_id').notNull(),
    consentType: text('consent_type').notNull(),
    status: text('status', { enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] }).notNull().default('ACTIVE'),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent').notNull(),
    timestamp: text('timestamp').notNull(),
    validUntil: text('valid_until').notNull(),
  },
  (table) => ({
    patientTypeIdx: index('idx_consent_patient_type').on(table.patientId, table.consentType),
  })
);

export const webhookEvent = sqliteTable(
  'webhook_event',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    status: text('status', { enum: ['PENDING', 'PROCESSED', 'FAILED'] }).notNull().default('PENDING'),
    processedAt: text('processed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    eventUniqueIdx: uniqueIndex('idx_webhook_event_id').on(table.eventId),
  })
);
