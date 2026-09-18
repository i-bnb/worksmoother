// Operational Data Models (Appwrite Cloud Project A)
export interface DoctorProfile {
  id: string;
  name: string;
  specialty: string;
  department: string;
  clinicId: string;
  availableDays: string[];
}

export interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  resourceId: string;
  ipAddress?: string;
}

// Medical Records & EHR Models (Appwrite Cloud Project B - Sensitive PHI)
export interface EncryptedPayload {
  version: 'v1';
  iv: string; // Base64 AES-GCM IV
  encryptedDek: string; // DEK encrypted under KEK kek-2026-09
  ciphertext: string; // Payload encrypted under DEK
  tag?: string;
}

export interface MedicalRecordDecrypted {
  recordId: string;
  patientId: string;
  doctorId: string;
  encounterDate: string;
  diagnosis: string[];
  clinicalNotes: string;
  prescriptions: {
    medication: string;
    dosage: string;
    frequency: string;
    duration: string;
  }[];
  labResults?: {
    testName: string;
    value: string;
    unit: string;
    referenceRange: string;
  }[];
}

export interface MedicalRecordDocument {
  $id: string;
  patientId: string;
  doctorId: string;
  encounterDate: string;
  encryptedPayload: string; // Serialized EncryptedPayload
  kekId: 'kek-2026-09';
  createdAt: string;
  updatedAt: string;
}

// Notification Payload
export interface NotificationEvent {
  eventId: string;
  recipientId: string;
  recipientEmail?: string;
  recipientPhone?: string;
  type: 'APPOINTMENT_REMINDER' | 'SHIFT_ALERT' | 'SYSTEM_ALERT';
  message: string;
  metadata?: Record<string, unknown>;
}

// Cloudflare Worker Environment Bindings
export interface ApiEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_A_ID: string;
  APPWRITE_PROJECT_A_KEY: string;
  RECORDS_SERVICE: Fetcher;
  NOTIFY_SERVICE: Fetcher;
}

export interface RecordsEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_B_ID: string;
  APPWRITE_PROJECT_B_KEY: string;
  // Cloudflare Secrets Store key binding
  KEK_2026_09: string;
}

export interface NotifyEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_A_ID: string;
  APPWRITE_PROJECT_A_KEY: string;
}
