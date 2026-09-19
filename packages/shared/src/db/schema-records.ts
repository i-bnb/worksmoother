import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// -----------------------------------------------------------------------------
// Protected Health Information (PHI) & Electronic Health Records (EHR) Schema
// STRICTLY PHYSICALLY ISOLATED in doctorcare-records-db
// Only accessible to doctorcare-records Worker bound to KEK_2026_09
// -----------------------------------------------------------------------------

export const medicalRecord = sqliteTable(
  'medical_record',
  {
    id: text('id').primaryKey(), // record_id
    patientId: text('patient_id').notNull(),
    hospitalId: text('hospital_id').notNull(),
    recordClass: text('record_class').notNull(),
    envelope: text('envelope').notNull(), // Envelope JSON: { encryptedDek, iv, authTag, ciphertext }
    kekId: text('kek_id').notNull().default('kek-2026-09'),
    alg: text('alg').notNull().default('AES-256-GCM'),
    retentionUntil: text('retention_until').notNull(),
    legalHold: integer('legal_hold', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    patientClassIdx: index('idx_record_patient_class').on(table.patientId, table.recordClass),
    hospitalIdx: index('idx_record_hospital').on(table.hospitalId),
    legalHoldIdx: index('idx_record_legal_hold').on(table.legalHold),
  })
);

export const recordAccessLog = sqliteTable(
  'record_access_log',
  {
    id: text('id').primaryKey(), // log_id
    recordId: text('record_id').notNull(),
    patientId: text('patient_id').notNull(),
    hospitalId: text('hospital_id').notNull(),
    accessorId: text('accessor_id').notNull(),
    accessorRole: text('accessor_role').notNull(),
    action: text('action').notNull(), // 'READ' | 'WRITE' | 'DECRYPT' | 'AUDIT'
    purpose: text('purpose').notNull(),
    status: text('status').notNull(), // 'AUTHORIZED' | 'DENIED' | 'FAILED'
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    recordIdx: index('idx_log_record_created').on(table.recordId, table.createdAt),
    accessorIdx: index('idx_log_accessor_patient').on(table.accessorId, table.patientId),
  })
);
