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
export interface MedicalRecordAAD {
  hospital_id: string;
  patient_id: string;
  record_id: string;
  field: string;
  kek_id: string;
}

export interface EncryptedPayload {
  version: 'v1' | 'v2';
  iv: string; // Base64 AES-GCM IV
  encryptedDek: string; // 32-byte DEK encrypted under KEK kek-2026-09
  ciphertext: string; // Payload encrypted under DEK with AAD
  alg?: string; // 'AES-256-GCM'
  aad?: MedicalRecordAAD;
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

export interface MedicalRecordEntity {
  $id?: string;
  record_id: string;
  patient_id: string;
  hospital_id: string;
  record_class: 'EHR_NOTE' | 'DIAGNOSTIC_REPORT' | 'PRESCRIPTION' | 'LAB_RESULT' | 'DISCHARGE_SUMMARY';
  envelope: string; // Serialized EncryptedPayload
  kek_id: string; // 'kek-2026-09'
  alg: string; // 'AES-256-GCM'
  retention_until: string; // ISO datetime
  legal_hold: boolean;
  created_at: string;
  updated_at?: string;
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

// Fail-Closed Access Audit Log (Project B - RECORD_ACCESS_LOG)
export interface RecordAccessLog {
  $id?: string;
  log_id: string;
  record_id: string;
  patient_id: string;
  hospital_id: string;
  accessor_id: string;
  accessor_role: string;
  action: 'READ' | 'DECRYPT' | 'EXPORT' | 'UPDATE';
  purpose: string;
  ip_address: string;
  user_agent: string;
  status: 'RECORDED' | 'DENIED' | 'FAILED';
  created_at: string;
}

// Cryptographic Hash-Chained Audit Block (for Write-Only R2 Audit Vault)
export interface HashChainedAuditBlock {
  sequence_number: number;
  timestamp: string;
  previous_hash: string;
  log_id: string;
  record_id: string;
  patient_id: string;
  hospital_id: string;
  accessor_id: string;
  accessor_role: string;
  action: string;
  purpose: string;
  ip_address: string;
  user_agent: string;
  status: string;
  current_hash: string;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalBlocks: number;
  genesisHash: string;
  latestHash?: string;
  latestSequenceNumber?: number;
  error?: string;
  tamperedIndex?: number;
  brokenBlock?: HashChainedAuditBlock;
}

// R2 Presigned URL & File Validation Types
export interface R2PresignedUrlRequest {
  fileName: string;
  contentType: string;
  fileExtension?: string;
  recordId?: string;
  patientId?: string;
}

export interface R2PresignedUrlResult {
  uploadUrl: string;
  objectKey: string;
  method: 'PUT';
  expiresInSeconds: 300; // Strict 5-minute expiry
  expiresAt: string;
  headers: Record<string, string>;
  mock?: boolean;
}

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  detectedExtension?: string;
  fileSize: number;
  magicBytesHex: string;
  error?: string;
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

// Appwrite Auth & MFA User Profile
export interface AppwriteUser {
  $id: string;
  name: string;
  email: string;
  emailVerification: boolean;
  status: boolean;
  labels: string[];
  mfa: boolean;
  targets?: Array<{
    $id: string;
    providerType: 'email' | 'sms' | 'push';
    identifier: string;
  }>;
}

// First-Party Custom Session & Token Family Management
export interface FirstPartySession {
  sessionId: string;
  familyId: string;
  userId: string;
  email: string;
  roles: string[];
  mfaVerified: boolean;
  mfaFactors: string[];
  createdAt: string;
  expiresAt: string;
}

export interface TokenFamilyState {
  familyId: string;
  userId: string;
  currentRefreshTokenHash: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  updatedAt: string;
}

export interface TokenRotationResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  familyRevoked?: boolean;
}

export interface SessionValidationResult {
  valid: boolean;
  session?: FirstPartySession;
  error?: string;
}

// Directory Module Models (Appwrite TablesDB in Project A)
export interface Hospital {
  id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  created_at?: string;
  updated_at?: string;
}

export interface Department {
  id: string;
  hospital_id: string;
  name: string;
  description?: string;
  created_at?: string;
}

export interface Doctor {
  id: string;
  hospital_id: string;
  department_id: string;
  name: string;
  email: string;
  specialty: string;
  active: boolean;
  created_at?: string;
}

export interface Room {
  id: string;
  hospital_id: string;
  department_id: string;
  room_number: string;
  floor: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
  created_at?: string;
}

// Availability Slot & Booking Models
export interface AvailabilitySlot {
  slot_key: string; // Formatted as {doctor_id}:{start_time_utc}
  doctor_id: string;
  start_time_utc: string;
  end_time_utc: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED';
  hold_expires_at?: string | null;
  room_id?: string | null;
}

export interface BookingRecord {
  booking_id: string;
  slot_key: string;
  doctor_id: string;
  patient_id: string;
  status: 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'RELEASED';
  idempotency_key: string;
  hold_expires_at: string;
  created_at: string;
}

export interface SlotHoldRequest {
  doctor_id: string;
  start_time_utc: string;
  end_time_utc: string;
  patient_id: string;
  idempotency_key: string;
}

export interface SlotHoldResult {
  success: boolean;
  slot_key: string;
  doctor_id: string;
  patient_id: string;
  status: 'HELD';
  hold_expires_at: string;
  hold_expires_timestamp_ms: number;
  idempotency_key: string;
  idempotent_replay?: boolean;
}

// Webhook & Payment Models
export interface WebhookEventRecord {
  event_id: string; // Razorpay x-razorpay-event-id or payload id
  event_type: string;
  payment_id?: string | null;
  order_id?: string | null;
  amount?: number | null;
  payload: string;
  processed_at: string;
  status: 'PROCESSED' | 'FAILED' | 'PENDING';
}

export interface RazorpayOrderRequest {
  doctor_id: string;
  slot_key: string;
  consultation_type: 'REGULAR' | 'SPECIALIST' | 'SURGICAL' | 'EMERGENCY';
  patient_id: string;
}

export interface DerivedFeeBreakdown {
  baseFee: number; // in paise
  gst: number; // 18% in paise
  total: number; // in paise
}

export interface RazorpayOrderResponse {
  order_id: string;
  amount: number;
  currency: 'INR';
  doctor_id: string;
  slot_key: string;
  breakdown: DerivedFeeBreakdown;
}

// DPDP Act 2023 Compliant Consent Record
export interface ConsentLogRecord {
  $id?: string;
  consent_id: string;
  patient_id: string;
  purpose: string;
  notice_version: string;
  language: string;
  granted_at: string;
  withdrawn_at?: string | null;
  status: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
  ip_address?: string;
  user_agent?: string;
}

// Meta WhatsApp Cloud API Types
export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string;
  apiVersion?: string;
}

export interface WhatsAppTemplateComponentParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document';
  text?: string;
  currency?: { fallback_value: string; code: string; amount_1000: number };
  date_time?: { fallback_value: string };
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters: WhatsAppTemplateComponentParameter[];
}

export interface WhatsAppMessagePayload {
  to: string; // E.164 format (e.g., +919876543210 or 919876543210)
  type: 'template' | 'text';
  template?: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
  text?: {
    body: string;
    preview_url?: boolean;
  };
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  recipient?: string;
  mock?: boolean;
  error?: string;
}

// Transactional Email / SMTP Provider Types
export interface SmtpProviderConfig {
  providerId: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  encryption: 'none' | 'ssl' | 'tls';
  autoTLS?: boolean;
  fromName: string;
  fromEmail: string;
  replyToEmail?: string;
  enabled: boolean;
}

export interface TransactionalEmailPayload {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  content: string; // Plain text
  html?: string; // HTML formatted string
  cc?: string[];
  bcc?: string[];
}

export interface TransactionalEmailResult {
  success: boolean;
  messageId?: string;
  provider: string;
  recipient: string;
  mock?: boolean;
  error?: string;
}

export interface TaskQueueMessage {
  type:
    | 'PAYMENT_CONFIRMED'
    | 'SLOT_RELEASED'
    | 'APPOINTMENT_ALERT'
    | 'WHATSAPP_DISPATCH'
    | 'EMAIL_DISPATCH';
  eventId: string;
  recipientId?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// Rate Limiting Types across 4 Architecture Layers
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface DoRateLimitConsumeRequest {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface DoRateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

export interface BusinessCapViolation {
  allowed: boolean;
  quota: string;
  limit: number;
  current: number;
  message?: string;
  actionRequired?: string;
}

// Cloudflare Worker Environment Bindings
export interface ApiEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_A_ID: string;
  APPWRITE_PROJECT_A_KEY: string;
  SESSION_SECRET?: string;
  SESSION_DO: DurableObjectNamespace;
  SLOT_DO: DurableObjectNamespace;
  TASK_QUEUE: Queue<TaskQueueMessage>;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RECORDS_SERVICE: Fetcher;
  NOTIFY_SERVICE: Fetcher;
  // Layer 2: Cloudflare Workers RateLimit Bindings
  API_RATE_LIMITER?: RateLimitBinding;
  AUTH_RATE_LIMITER?: RateLimitBinding;
  // Layer 3: Exact Durable Object Counter Binding
  RATE_LIMITER_DO?: DurableObjectNamespace;
}

export interface RecordsEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_B_ID: string;
  APPWRITE_PROJECT_B_KEY: string;
  // Cloudflare Secrets Store key binding
  KEK_2026_09: string;
  // Cloudflare R2 Bucket for Patient Files
  PATIENT_FILES_BUCKET?: R2Bucket;
  // Cloudflare Write-Only R2 Audit Vault Bucket
  AUDIT_VAULT_BUCKET?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_AUDIT_ACCESS_KEY_ID?: string;
  R2_AUDIT_SECRET_ACCESS_KEY?: string;
}

export interface NotifyEnv {
  ENVIRONMENT: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_A_ID: string;
  APPWRITE_PROJECT_A_KEY: string;
  TASK_QUEUE_DLQ?: Queue<TaskQueueMessage>;
  // Meta WhatsApp Cloud API Bindings
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  WHATSAPP_API_VERSION?: string;
  // Transactional Email / SMTP Bindings
  SMTP_PROVIDER_ID?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number | string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
}



