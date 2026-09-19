-- -----------------------------------------------------------------------------
-- Cloudflare D1 Migration 0001: doctorcare-ops-db Schema
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'patient',
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  password_hash TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider_account ON accounts(provider_id, account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'TERTIARY',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS department (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospital(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospital(id),
  department_id TEXT NOT NULL REFERENCES department(id),
  name TEXT NOT NULL,
  specialization TEXT NOT NULL,
  registration_number TEXT NOT NULL UNIQUE,
  consultation_fee INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doctor_department ON doctor(department_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_registration ON doctor(registration_number);

CREATE TABLE IF NOT EXISTS room (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospital(id),
  department_id TEXT NOT NULL REFERENCES department(id),
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'CONSULTATION',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_slot (
  id TEXT PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  doctor_id TEXT NOT NULL REFERENCES doctor(id),
  hospital_id TEXT NOT NULL REFERENCES hospital(id),
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  held_by TEXT,
  held_until INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_key_unique ON availability_slot(slot_key);
CREATE INDEX IF NOT EXISTS idx_slot_doctor_date ON availability_slot(doctor_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_slot_status ON availability_slot(status);

CREATE TABLE IF NOT EXISTS booking (
  id TEXT PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL REFERENCES doctor(id),
  hospital_id TEXT NOT NULL REFERENCES hospital(id),
  slot_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INITIATED',
  amount INTEGER NOT NULL,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_patient ON booking(patient_id);
CREATE INDEX IF NOT EXISTS idx_booking_slot ON booking(slot_key);
CREATE INDEX IF NOT EXISTS idx_booking_status ON booking(status);

CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  valid_until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consent_patient_type ON consent_log(patient_id, consent_type);

CREATE TABLE IF NOT EXISTS webhook_event (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_id ON webhook_event(event_id);
