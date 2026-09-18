# DoctorCare Platform Infrastructure

A healthcare platform built on Cloudflare Workers and Appwrite Cloud with HIPAA-compliant credential and data isolation.

Repository Origin: [https://github.com/itsmesyaam/doctorcare](https://github.com/itsmesyaam/doctorcare)

---

## Architecture Overview

The system divides responsibilities across three independent Cloudflare Workers and two isolated Appwrite Cloud projects:

```
                                  HTTPS (api.yourhospital.com)
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────┐
                         │      Cloudflare Pro Zone (WAF & OWASP)      │
                         │   - Cloudflare Managed Ruleset              │
                         │   - OWASP ModSecurity Core Ruleset (CRS)    │
                         └──────────────────────┬──────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │    Worker: api        │
                                    │ (Gateway & Security)  │
                                    └───┬───────────────┬───┘
                                        │               │
                     Internal Service   │               │ Internal Service
                     Binding            ▼               ▼ Binding
                         ┌────────────────────┐   ┌────────────────────┐
                         │  Worker: records   │   │   Worker: notify   │
                         │ (PHI / EHR Engine) │   │ (Alerts & Queues)  │
                         └─────────┬──────────┘   └─────────┬──────────┘
                                   │                        │
         Cloudflare Secrets Store  │                        │
         Key: kek-2026-09          │                        │
                 ▼                 ▼                        ▼
        ┌──────────────────────────────────┐      ┌─────────────────────────────┐
        │ Appwrite Project B               │      │ Appwrite Project A          │
        │ Strictly Medical Records & PHI   │      │ Operational Data            │
        │ - Database: medical_records_db   │      │ - Database: operational_db  │
        │ - Scoped API Key B               │      │ - Scoped API Key A          │
        └──────────────────────────────────┘      └─────────────────────────────┘
```

---

## 1. Cloudflare Workers Fleet

| Worker | Directory | Role & Responsibilities | Key Bindings & Isolation |
|---|---|---|---|
| **api** | `workers/api` | Public entrypoint via `api.yourhospital.com`. Routes operational traffic and proxies internal records/notifications. | Service Bindings: `RECORDS_SERVICE`, `NOTIFY_SERVICE`. Interacts only with Project A. |
| **records** | `workers/records` | Electronic Health Records (EHR) and Protected Health Information (PHI). | **Exclusively binds Cloudflare Secrets Store `kek-2026-09`**. Accesses strictly Appwrite Project B. |
| **notify** | `workers/notify` | Asynchronous staff notifications, patient appointment alerts, and audit logging. | Interacts only with Project A operational database. **Zero access to medical records or KEK**. |

---

## 2. Cloudflare Pro Zone WAF & OWASP Rulesets

The domain `api.yourhospital.com` is configured as a custom domain route in `workers/api/wrangler.toml`:
```toml
routes = [
  { pattern = "api.yourhospital.com", custom_domain = true }
]
```

Managed rulesets configured in `infra/cloudflare/waf-rulesets.json`:
- **Cloudflare Managed Ruleset**: `efb79d62c8814b68844470d33a810f44` (Block action)
- **OWASP ModSecurity Core Rule Set**: `4814384a9e5d47ee937000e3f019f39f` (Anomaly scoring threshold = 40)

To deploy rulesets to your Cloudflare Pro zone:
```bash
export CLOUDFLARE_API_TOKEN="<your-cloudflare-token>"
export CLOUDFLARE_ZONE_ID="<your-pro-zone-id>"
npm run infra:waf
```

---

## 3. Appwrite Cloud Dual-Project Isolation

Two distinct Appwrite projects enforce strict separation of privilege:

1. **Project A (`doctorcare-operational-prod`)**:
   - Operational data: appointments, clinics, staff directory, notification audit logs.
   - Scoped API key permissions: `databases.*`, `collections.*`, `documents.*`, `users.read`.
2. **Project B (`doctorcare-medical-records-prod`)**:
   - Medical records and sensitive clinical encounters (PHI).
   - Scoped API key permissions: strictly limited to medical records database (`medical_records_db`) and files.
   - No user identity management permissions.

To provision projects and generate scoped API keys:
```bash
npm run infra:appwrite
```

---

## 4. Cloudflare Secrets Store & KEK (`kek-2026-09`)

A Key-Encryption Key (KEK) named `kek-2026-09` is provisioned in the Cloudflare Secrets Store and bound exclusively to the `records` Worker in `workers/records/wrangler.toml`:
```toml
[[secrets_store_secrets]]
binding = "KEK_2026_09"
store_id = "doctorcare_vault_store"
secret_name = "kek-2026-09"
```

### Envelope Encryption Pattern
1. Every patient medical record is encrypted with a unique, ephemeral **Data Encryption Key (DEK)** using AES-GCM-256.
2. The DEK is encrypted under `kek-2026-09` (from Cloudflare Secrets Store).
3. The encrypted DEK and ciphertext are stored in Appwrite Project B.
4. If a breach occurs at the database layer, records remain unreadable without `kek-2026-09` held within Cloudflare's secure hardware store.

To provision Secrets Store and KEK:
```bash
npm run infra:secrets
```

---

---

## 5. Appwrite Auth Security & First-Party Session Architecture

### Appwrite Auth in Project A
- **Password Hashing**: Enforces Argon2 algorithm (`Argon2id`).
- **10,000-Common-Password Dictionary**: Automatically blocks weak, common, and hospital-related dictionary passwords (`passwordDictionary: true`).
- **Personal Data Check**: Prevents personal identifiers (name, email, username) inside passwords (`personalDataCheck: true`).
- **Disposable Email Address Blocking**: Rejects sign-ups from temporary and disposable email services (`mailinator.com`, `guerrillamail.com`, `tempmail.com`, etc.).

### Token-Exchange Endpoint (`POST /api/v1/auth/token-exchange`)
- Accepts a 15-minute Appwrite JWT produced by `account.createJWT()`.
- Verifies the signature and user profile against Appwrite Project A.
- Issues a custom first-party session:
  - **Short-Lived Access Token**: Signed HMAC-SHA256 JWT (15-minute validity).
  - **First-Party Cookies**: `__Host-access_token` and `__Host-refresh_token` configured with `HttpOnly; Secure; SameSite=Strict`.

### Session Durable Object (`SessionDurableObject`)
- Keyed by `userId` using `env.SESSION_DO.idFromName(userId)`.
- **Refresh Token Families**: Manages active token chains with strict lifecycle states.
- **Atomic Token Rotation**: Atomically consumes the previous refresh token and issues a new refresh token within the same family upon refresh (`POST /api/v1/auth/refresh`).
- **Reuse Detection**: If a previously consumed or expired refresh token is presented, the Durable Object immediately detects the breach, revokes the entire token family, and terminates all active sessions for that user ID.

### Staff & Admin MFA Enforcement Middleware
- Enforces Appwrite Multi-Factor Authentication (TOTP, email, or phone) for all privileged accounts (`admin`, `staff`, `doctor`, `nurse`).
- Blocks unverified access to sensitive clinical endpoints (`/api/v1/records/*`) and operational mutations with `403 Forbidden` (`MFA_VERIFICATION_REQUIRED`).
- Verification endpoint `POST /api/v1/auth/mfa/verify` validates the factor and marks the session as `mfaVerified: true` in the Session Durable Object.

---

## 6. Directory Module & Availability Slot Architecture

### Relational TablesDB Collections in Project A
- **`HOSPITAL`**: Master hospital directory (`name`, `address`, `phone`, `timezone`).
- **`DEPARTMENT`**: Clinical departments linked to hospital (`hospital_id`, `name`, `description`).
- **`DOCTOR`**: Medical practitioners (`hospital_id`, `department_id`, `name`, `email`, `specialty`, `active`).
- **`ROOM`**: Physical examination/consultation rooms (`hospital_id`, `department_id`, `room_number`, `floor`, `status`).

### Availability Slots & Booking Schema
- **`AVAILABILITY_SLOT`**:
  - `slot_key`: Plaintext composite key formatted as `{doctor_id}:{start_time_utc}`.
  - **Plaintext Unique Index**: Enforces absolute slot uniqueness at the database layer (`idx_slot_key_unique`).
  - Attributes: `doctor_id`, `start_time_utc`, `end_time_utc`, `status` (`AVAILABLE`, `HELD`, `BOOKED`), `hold_expires_at`, `room_id`.
- **`BOOKING`**:
  - `booking_id`: Unique booking reference.
  - `slot_key`: Associated availability slot key.
  - `idempotency_key`: Client-supplied unique token preventing duplicate submissions (`idx_idempotency_key_unique`).
  - `hold_expires_at`: ISO timestamp indicating hold timeout.
  - `status`: `HELD`, `CONFIRMED`, `CANCELLED`, `RELEASED`.

---

## 7. Slot Durable Object (`SlotDurableObject`)

### Doctor-Day Sharding Architecture
- Keyed per doctor-day: `env.SLOT_DO.idFromName(`${doctorId}:${dateUtc}`)`.
- **Zero Race Conditions**: Single-threads all booking mutations for a doctor on any given date, completely preventing database double-booking anomalies.

### SQLite Timeslot Locking & Automatic Alarm Release
- **`hold()` Method**:
  - Queries local SQLite table `slots`.
  - Rejects if `status === 'BOOKED'` (`409 Conflict`).
  - Rejects if `status === 'HELD'` and hold has not expired (`409 Conflict`).
  - Idempotent replay: if matching `idempotency_key` and `patient_id` is supplied, returns existing active hold.
  - Atomically locks timeslot in SQLite with `status = 'HELD'`, `hold_expires_at = Date.now() + 10 * 60 * 1000`.
  - Schedules **Cloudflare Workers Alarm** via `ctx.storage.setAlarm(holdExpiresAt)` to automatically release the hold after 10 minutes.
- **`alarm()` Method**:
  - Invoked automatically by the Workers runtime at the 10-minute timeout.
  - Releases all expired holds back to `status = 'AVAILABLE'`.
  - Automatically re-schedules the alarm for subsequent pending holds.

---

## 8. Strict Zod Routing Layer

- Every request schema in `workers/api/src/schemas/index.ts` enforces `.strict()`.
- Automatically rejects any request with unexpected, unknown, or extraneous payload fields with `400 Bad Request` (`unrecognized_keys`).
- Enforced on:
  - `HoldSlotSchema.strict()`
  - `ConfirmSlotSchema.strict()`
  - `ReleaseSlotSchema.strict()`
  - `TokenExchangeSchema.strict()`
  - `RefreshTokenSchema.strict()`
  - `MfaVerifySchema.strict()`
  - `CreateHospitalSchema.strict()`, `CreateDepartmentSchema.strict()`, `CreateDoctorSchema.strict()`, `CreateRoomSchema.strict()`
  - `CreateAppointmentSchema.strict()`

---

---

## 10. Razorpay Payments & Server-Side Price Derivation

### Server-Side Amount Calculation (`POST /api/v1/payments/create-order`)
- Strictly prevents client-side price tampering.
- The request schema `CreatePaymentOrderSchema.strict()` explicitly prohibits the client from providing an `amount`. If an attacker attempts to inject an `amount` parameter, Zod rejects the request with HTTP 400 (`unrecognized_keys`).
- Consultation fee breakdown is computed deterministically on the server via `deriveConsultationFee(specialty, consultationType)`:
  - Base specialty fees (e.g. Cardiology: ₹1500, Neurology: ₹2000, General Medicine: ₹800).
  - Consultation type multipliers: `REGULAR` (1.0x), `SPECIALIST` (1.25x), `SURGICAL` (2.0x), `EMERGENCY` (1.5x).
  - Mandatory 18% GST calculation in paise.
  - Generates official Razorpay order with notes linking `doctor_id`, `slot_key`, and `patient_id`.

---

## 11. Razorpay Webhook Handler & Web Crypto Timing-Safe Verification

### Raw Body Buffer & Constant-Time Verification (`POST /api/v1/payments/webhook`)
- Reads raw request body as `ArrayBuffer` via `request.arrayBuffer()`.
- Calculates expected HMAC-SHA256 digest using the Web Crypto API (`crypto.subtle.sign`).
- Compares computed digest against incoming `x-razorpay-signature` in constant-time using `crypto.subtle.timingSafeEqual()` to guard against side-channel timing attacks.

### Webhook Idempotency Deduplication via `WEBHOOK_EVENT` Collection
- Appwrite Project A includes the `WEBHOOK_EVENT` collection with a unique index on `event_id` (`idx_event_id_unique`).
- When a webhook arrives, the worker checks if `event_id` has already been recorded.
- Duplicate callbacks are immediately returned as `{ status: "ALREADY_PROCESSED" }` with HTTP 200 without duplicate processing.
- The raw event payload is preserved with timestamp and processing status.

---

## 12. Cloudflare Queues & Dead-Letter Queue (DLQ) Architecture

Asynchronous background tasks are processed via Cloudflare Queues:

```
┌─────────────────────────────────┐
│     Worker: api (Producer)      │
│  Binding: env.TASK_QUEUE        │
│  Queue: 'doctorcare-tasks'      │
└────────────────┬────────────────┘
                 │
                 │ env.TASK_QUEUE.send(task)
                 ▼
┌─────────────────────────────────┐
│ Cloudflare Queue:               │
│ 'doctorcare-tasks'              │
└────────────────┬────────────────┘
                 │
                 │ Batches (size <= 10, timeout = 5s)
                 ▼
┌─────────────────────────────────┐
│     Worker: notify (Consumer)   │
│  - max_retries = 3              │
│  - msg.ack() / msg.retry()      │
└────────────────┬────────────────┘
                 │
                 │ On 3 consecutive failures
                 ▼
┌─────────────────────────────────┐
│ Dead-Letter Queue (DLQ):        │
│ 'doctorcare-tasks-dlq'          │
└─────────────────────────────────┘
```

- **Provisioning**: Script `infra/cloudflare/provision-queues.ts` provisions `doctorcare-tasks` and `doctorcare-tasks-dlq` via Wrangler.
- **Producer Configuration (`workers/api/wrangler.toml`)**:
  ```toml
  [[queues.producers]]
  binding = "TASK_QUEUE"
  queue = "doctorcare-tasks"
  ```
- **Consumer Configuration (`workers/notify/wrangler.toml`)**:
  ```toml
  [[queues.consumers]]
  queue = "doctorcare-tasks"
  max_batch_size = 10
  max_batch_timeout = 5
  max_retries = 3
  dead_letter_queue = "doctorcare-tasks-dlq"
  ```
- **Notify Worker Queue Consumer (`workers/notify/src/index.ts`)**:
  - Implements `queue(batch, env, ctx)` handler.
  - Consumes tasks, updates notifications log in Appwrite Project A.
  - Acknowledges successful tasks with `msg.ack()`.
  - Automatically routes unrecoverable messages to `doctorcare-tasks-dlq` after 3 failed retry attempts.

---

## 14. Meta WhatsApp Cloud API Integration (`workers/notify`)

The `notify` Worker integrates Meta Graph API `v20.0` for automated clinical notifications:
- **Appointment Confirmations**:
  - Sent immediately when `PAYMENT_CONFIRMED` event is consumed from the queue or via `POST /api/v1/notify/whatsapp/confirmation`.
  - Dispatches template `appointment_confirmation` with patient name, doctor name, scheduled date/time, and booking ID.
- **Appointment Reminders**:
  - Sent via `POST /api/v1/notify/whatsapp/reminder` and queue alerts.
  - Dispatches template `appointment_reminder` advising arrival 15 minutes prior.
- **Offline / Dev Mock**: Automatic mock fallback when running without production credentials.

---

## 15. Transactional Email & Appwrite Messaging SMTP Provider

Configured to bind an enterprise SMTP provider directly to Appwrite Messaging:
- **Selected Provider**: **Amazon SES (Mumbai `ap-south-1`)**
  - Host: `email-smtp.ap-south-1.amazonaws.com`
  - Port: `587` (TLS / STARTTLS)
  - Sender: `DoctorCare Healthcare <notifications@yourhospital.com>`
  - Compliance: Data residency retained in India under Mumbai region to satisfy DPDP rules.
- **Appwrite Messaging Binding**:
  - Project A API key provisioned with `messages.read`, `messages.write`, `providers.read`, `providers.write`.
  - Sends transactional emails via `messaging.createEmail()` with HTML templates and plain text fallbacks.
  - Endpoint: `POST /api/v1/notify/email/transactional`.

---

## 16. India DPDP Act 2023 Consent Audit Trail (`CONSENT_LOG`)

To comply with Section 6 of India's **Digital Personal Data Protection (DPDP) Act 2023**, all data processing consent is tracked in Project A:
- **`CONSENT_LOG` Collection**:
  - `consent_id`: Unique token identifying the consent transaction (`idx_consent_id_unique`).
  - `patient_id`: Identifier of the Data Principal.
  - `purpose`: Explicit purpose (e.g. `WHATSAPP_CONFIRMATIONS`, `TRANSACTIONAL_EMAIL`, `HEALTH_RECORDS_ACCESS`).
  - `notice_version`: Version tag of the privacy notice presented (e.g. `v2026.09.1`).
  - `language`: Multilingual notice language ISO 639-1 code (`en`, `hi`, `ta`, `te`, `mr`, `bn`, etc.).
  - `granted_at`: ISO datetime when affirmative consent was provided.
  - `withdrawn_at`: ISO datetime when consent was withdrawn (nullable).
  - `status`: `ACTIVE`, `WITHDRAWN`, `EXPIRED`.
- **Pre-Dispatch Verification**: Before dispatching WhatsApp messages or emails, the `notify` Worker checks `CONSENT_LOG`. If consent has been withdrawn or was never granted for that purpose, communication is blocked (`403 CONSENT_WITHDRAWN_OR_MISSING`).
- **Endpoints**:
  - `POST /api/v1/consent`: Grants consent with strict Zod validation (`GrantConsentSchema.strict()`).
  - `POST /api/v1/consent/withdraw`: Withdraws consent with timestamp.
  - `GET /api/v1/consent`: Queries active consent status for a patient.

---

---

## 17. Appwrite Project B `MEDICAL_RECORD` & Envelope Encryption with AAD

To ensure zero-trust security and HIPAA compliance for sensitive clinical data:
- **`MEDICAL_RECORD` Collection**:
  - `record_id`: String (128), unique index (`idx_record_id_unique`).
  - `patient_id`: String (128), key index with `record_class` (`idx_patient_records`).
  - `hospital_id`: String (128).
  - `record_class`: Category (`EHR_NOTE`, `DIAGNOSTIC_REPORT`, `PRESCRIPTION`, `LAB_RESULT`, `DISCHARGE_SUMMARY`).
  - `envelope`: Serialized encrypted envelope containing AES-256-GCM ciphertext, IV, and wrapped DEK.
  - `kek_id`: Key encryption key identifier (`kek-2026-09`).
  - `alg`: Encryption algorithm (`AES-256-GCM`).
  - `retention_until`: ISO datetime defining legal data retention period.
  - `legal_hold`: Boolean flag (`idx_legal_hold`) preventing record destruction during active litigation or audits.
- **Envelope Encryption with Ephemeral 32-Byte DEK**:
  - Generates a fresh, cryptographically random 32-byte (256-bit) Data Encryption Key (DEK) for every record via `crypto.getRandomValues(new Uint8Array(32))`.
  - The DEK is encrypted (wrapped) under `kek-2026-09` using AES-256-GCM.
- **Cryptographic AAD Binding**:
  - The record's medical ciphertext is cryptographically bound to its identity by passing `{hospital_id, patient_id, record_id, field, kek_id}` as Additional Authenticated Data (`additionalData` / AAD) to `crypto.subtle.encrypt`.
  - Tampering with `patient_id`, `record_id`, or `hospital_id` causes an immediate `OperationError` authentication tag verification failure upon decryption.
- **Non-Extractable KEK Decryption**:
  - In the `records` Worker, `kek-2026-09` is imported into Web Crypto with `extractable: false`. Any attempt to call `crypto.subtle.exportKey()` throws an error, guaranteeing the master key cannot be leaked from worker memory.

---

## 18. Cloudflare R2 Bucket & 5-Minute Presigned PUT URLs

For direct-to-storage patient document uploads (e.g. lab PDFs, DICOM scans, imaging):
- **Bucket**: `doctorcare-patient-files` bound exclusively to `workers/records/wrangler.toml` as `PATIENT_FILES_BUCKET`.
- **AWS SigV4 Presigned PUT URLs**:
  - Generated on-demand via `generateR2PresignedPutUrl()`.
  - **Strict 5-Minute Expiration**: Explicitly enforces `expiresInSeconds = 300` and `X-Amz-Expires=300`.
  - **Cryptographically Random Keys**: Object keys are formatted as `raw/${crypto.randomUUID()}.${ext}`, eliminating path collisions and upload enumeration attacks.
- **Endpoint**: `POST /api/v1/records/files/upload-url` (proxied through API worker behind Staff MFA).

---

## 19. Server-Side File Validation Middleware (Magic Bytes)

Prior to clinical processing, patient files are validated server-side by inspecting their raw magic byte signatures:
- **`validateFileMagicBytes(buffer, declaredMimeType)`**:
  - `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`): Medical reports and discharge summaries.
  - `DICM` (`0x44, 0x49, 0x43, 0x4D`): Medical imaging (MRI, CT, X-Ray) at standard offset 128 (after 128-byte preamble) or offset 0.
  - JPEG (`0xFF, 0xD8, 0xFF`) and PNG (`0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A`): Clinical scans and plots.
  - TIFF (`0x49, 0x49, 0x2A, 0x00` / `0x4D, 0x4D, 0x00, 0x2A`): Digital pathology.
- **Malicious File Rejection**: Rejects PE executables (`MZ`), scripts, HTML, and files masquerading under false extensions with `INVALID_FILE_MAGIC_BYTES` (HTTP 422).
- **Endpoint**: `POST /api/v1/records/files/validate`.

---

## 20. Private Records Service Binding & Network Isolation

- **Zero Public Routes**: The `records` Worker configuration in `workers/records/wrangler.toml` contains no `routes` or `custom_domain`. It is completely unreachable from the public internet.
- **Service Binding**: The `api` Worker links to `doctorcare-records` via `RECORDS_SERVICE`. All incoming requests to `/api/v1/records/*` must pass through the API Worker's strict Zod schema validation and Staff MFA middleware before reaching the records service.

---

---

## 21. `RECORD_ACCESS_LOG` & Fail-Closed Audit Architecture in Project B

To strictly comply with HIPAA § 164.312(b) and India DPDP Act 2023 audit standards:
- **`RECORD_ACCESS_LOG` Collection**:
  - Located strictly in Project B (`medical_records_db`).
  - Fields: `log_id` (unique index `idx_log_id_unique`), `record_id`, `patient_id`, `hospital_id`, `accessor_id`, `accessor_role`, `action` (`READ`), `purpose` (`CLINICAL_TREATMENT`, `EMERGENCY`, etc.), `ip_address`, `user_agent`, `status` (`RECORDED`), `created_at`.
  - Indexes: `idx_log_id_unique` (unique), `idx_record_access` (key: `["record_id", "created_at"]`), `idx_accessor_patient` (key: `["accessor_id", "patient_id"]`).
- **Fail-Closed Architecture Guarantee**:
  - The `records` Worker **must** durably persist the access log to `RECORD_ACCESS_LOG` **before** executing `decryptMedicalRecord()`.
  - If the audit log write fails, times out, or encounters any database error, the operation **fails closed**:
    - Aborts immediately with HTTP 500 (`AUDIT_LOG_FAILED`).
    - Decryption is completely blocked.
    - Zero clinical payload, diagnosis, or notes are returned to the caller.
- **Actor Context Propagation**:
  - The `api` Worker injects authenticated actor headers (`X-Actor-Id`, `X-Actor-Role`, `X-Session-Id`, `X-Access-Purpose`) over the internal `RECORDS_SERVICE` binding behind Staff MFA.
- **Endpoints**:
  - `GET /api/v1/records/:recordId`: Returns clinical data only after successful audit log persistence.
  - `GET /api/v1/records/:recordId/access-logs`: Queries immutable audit history for the record.

---

## 22. Development & Verification

### Install dependencies:
```bash
npm.cmd install
```

### Run Typecheck across all monorepo workspaces:
```bash
npm.cmd run typecheck
```

### Run Provisioning Scripts:
```bash
npm.cmd run infra:secrets    # Cloudflare Secrets Store & KEK (kek-2026-09)
npm.cmd run infra:appwrite   # Appwrite Dual-Project & TablesDB Collections
npm.cmd run infra:waf        # Cloudflare Pro Zone WAF & OWASP Rulesets
npm.cmd run infra:queues     # Cloudflare Queues & Dead-Letter Queue
npm.cmd run infra:r2         # Cloudflare R2 Bucket & Isolation Audit
```

### Run Test Suites:
```bash
npm.cmd run test             # Record Access Log & Fail-Closed Test Suite
npm.cmd run test:access-log  # Fail-Closed Audit Log Tests
npm.cmd run test:records     # Medical Records, R2 & AAD Tests
npm.cmd run test:notify      # Meta WhatsApp, Email & DPDP Consent Tests
npm.cmd run test:all         # Complete Test Suite (All 7 verification suites)
```




