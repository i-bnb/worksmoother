-- -----------------------------------------------------------------------------
-- Cloudflare D1 Migration 0002: doctorcare-records-db Schema (PHI ISOLATED)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS medical_record (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  record_class TEXT NOT NULL,
  envelope TEXT NOT NULL,
  kek_id TEXT NOT NULL DEFAULT 'kek-2026-09',
  alg TEXT NOT NULL DEFAULT 'AES-256-GCM',
  retention_until TEXT NOT NULL,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_record_patient_class ON medical_record(patient_id, record_class);
CREATE INDEX IF NOT EXISTS idx_record_hospital ON medical_record(hospital_id);
CREATE INDEX IF NOT EXISTS idx_record_legal_hold ON medical_record(legal_hold);

CREATE TABLE IF NOT EXISTS record_access_log (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  accessor_id TEXT NOT NULL,
  accessor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_record_created ON record_access_log(record_id, created_at);
CREATE INDEX IF NOT EXISTS idx_log_accessor_patient ON record_access_log(accessor_id, patient_id);
