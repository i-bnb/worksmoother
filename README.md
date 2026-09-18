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

## 3. Appwrite Cloud Dual-Project Isolation & Credential Boundary Architecture

Healthcare regulations (HIPAA § 164.312, India DPDP Act 2023) mandate strict separation between general operational metadata and Protected Health Information (PHI). DoctorCare satisfies this by establishing **two entirely independent Appwrite Cloud projects**, completely separating credentials, databases, API scopes, and network topologies.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLOUDFLARE WORKERS FLEET                                 │
│                                                                                        │
│   ┌───────────────────────────┐                       ┌────────────────────────────┐   │
│   │       Worker: api         │                       │      Worker: records       │   │
│   │ (Public Ingress Gateway)  │                       │   (Private Service Only)   │   │
│   └─────────────┬─────────────┘                       └──────────────┬─────────────┘   │
└─────────────────┼────────────────────────────────────────────────────┼─────────────────┘
                  │                                                    │
                  │ Scoped API Key A                                   │ Scoped API Key B
                  ▼                                                    ▼
┌──────────────────────────────────────────────┐     ┌──────────────────────────────────────────────┐
│             APPWRITE PROJECT A               │     │             APPWRITE PROJECT B               │
│         (doctorcare-operational-prod)        │     │       (doctorcare-medical-records-prod)      │
│                                              │     │                                              │
│  DATABASE: operational_db                    │     │  DATABASE: medical_records_db                │
│  - HOSPITAL (Master directory & metadata)    │     │  - patient_charts (Encounter charts)         │
│  - DEPARTMENT (Clinical divisions)           │     │  - MEDICAL_RECORD (Envelope encrypted PHI)   │
│  - DOCTOR (Practitioners & specialties)      │     │  - RECORD_ACCESS_LOG (Immutable audit trail) │
│  - ROOM (Clinic consultation rooms)          │     │                                              │
│  - AVAILABILITY_SLOT (Doctor-day slots)      │     │  STORAGE BUCKET:                             │
│  - BOOKING (Appointments & idempotency)      │     │  - patient_files (Presigned direct uploads)  │
│  - WEBHOOK_EVENT (Razorpay idempotency)      │     │                                              │
│  - CONSENT_LOG (DPDP Act 2023 tracking)      │     │  PERMISSIONS:                                │
│                                              │     │  - Strictly database & files only            │
│  PERMISSIONS:                                │     │  - ZERO access to users/auth                 │
│  - databases.*, collections.*, documents.*   │     │  - ZERO access to operational collections    │
│  - users.read, messages.*                    │     │                                              │
└──────────────────────────────────────────────┘     └──────────────────────────────────────────────┘
```

### Threat Model & Isolation Guarantees
- **Logical RLS vs Physical Credential Isolation**: Typical single-project architectures rely on database Row-Level Security (RLS) or application-level filters. If an application vulnerability (e.g., SQL injection, ORM bypass, or API key compromise) occurs, all medical records are exposed.
- **Physical Zero-Trust Boundary**: In DoctorCare, `doctorcare-api` and `doctorcare-notify` only possess Scoped API Key A. Even if an attacker gains full administrative control of Project A or exfiltrates Key A, they have **zero cryptographic access or credentials** to query, alter, or list Project B.
- **Network Ingress Lockdown**: Project B credentials are held strictly inside `doctorcare-records`, which has **no public Internet route** in `wrangler.toml` and is only reachable via authenticated internal Cloudflare Service Bindings behind Staff MFA.

### Comprehensive Project Comparison Matrix

| Architectural Attribute | Project A: Operational Data | Project B: Medical Records & PHI |
|---|---|---|
| **Project Name** | `DoctorCare Operational` | `DoctorCare Medical Records` |
| **Project ID** | `doctorcare-operational-prod` | `doctorcare-medical-records-prod` |
| **Primary Database** | `operational_db` | `medical_records_db` |
| **Primary Collections** | `HOSPITAL`, `DEPARTMENT`, `DOCTOR`, `ROOM`, `AVAILABILITY_SLOT`, `BOOKING`, `WEBHOOK_EVENT`, `CONSENT_LOG` | `patient_charts`, `MEDICAL_RECORD`, `RECORD_ACCESS_LOG` |
| **API Key Name** | `key-project-a-operational` | `key-project-b-medical-records-phi` |
| **API Key Scopes** | `databases.read`, `databases.write`, `collections.read`, `collections.write`, `documents.read`, `documents.write`, `users.read`, `messages.read`, `messages.write`, `providers.read`, `providers.write` | `databases.read`, `databases.write`, `collections.read`, `collections.write`, `documents.read`, `documents.write`, `files.read`, `files.write` |
| **User Identity Access** | Allowed (`users.read` for Appwrite Auth verification) | **Forbidden** (Zero identity scopes) |
| **Worker Binding** | Bound to `doctorcare-api` and `doctorcare-notify` | **Exclusively bound to `doctorcare-records`** |
| **Encryption Standard** | TLS 1.3 in transit, AES-256 at rest | **AES-256-GCM Envelope Encryption with 5-Tuple AAD** |
| **Audit Requirement** | Operational logging | **Fail-Closed `RECORD_ACCESS_LOG` + Immutable R2 Hash Chain** |

### Declarative Provisioning
Both projects, their databases, collections, attributes, and indexes are defined declaratively in [`infra/appwrite/appwrite.config.json`](file:///e:/doctor%20care/infra/appwrite/appwrite.config.json).
To provision both projects idempotently:
```bash
export APPWRITE_ENDPOINT="https://cloud.appwrite.io/v1"
export APPWRITE_PROJECT_A_KEY="<your-project-a-api-key>"
export APPWRITE_PROJECT_B_KEY="<your-project-b-api-key>"
npm run infra:appwrite
```

---

## 4. Cloudflare Secrets Store & KEK (`kek-2026-09`)

DoctorCare leverages **Cloudflare Secrets Store** as a hardware-backed root of trust for master Key-Encryption Keys (KEKs).

### Hardware-Backed KEK Architecture
- **Hardware Isolation**: Master keys are stored inside Cloudflare's secure hardware store (`doctorcare_vault_store`) and bound to Workers via dedicated runtime bindings:
  ```toml
  # workers/records/wrangler.toml
  [[secrets_store_secrets]]
  binding = "KEK_2026_09"
  store_id = "doctorcare_vault_store"
  secret_name = "kek-2026-09"
  ```
- **WebCrypto Non-Extractability**: When the `records` Worker imports `kek-2026-09`, it explicitly sets `extractable: false`:
  ```ts
  const kek = await crypto.subtle.importKey(
    'raw',
    rawKeyBuffer,
    { name: 'AES-GCM', length: 256 },
    false, // extractable = false (IMMUNE TO MEMORY DUMPS & EXFILTRATION)
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
  ```
  Any attempt to invoke `crypto.subtle.exportKey()` throws a runtime `InvalidAccessError`, ensuring that the master key cannot be leaked from worker memory.

---

### Envelope Encryption & AAD Cryptographic Binding

DoctorCare implements a multi-tier envelope encryption pattern:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE SECRETS STORE (HARDWARE)                  │
│                        Key: kek-2026-09 (Master KEK)                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Wraps 32-byte DEK
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       EPHEMERAL DEK (32-BYTE AES-256)                  │
│                     Fresh Random Key Per Medical Record                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    │ Encrypts Payload with AES-256-GCM
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       ENCRYPTED CLINICAL ENVELOPE                      │
│                                                                        │
│   ADDITIONAL AUTHENTICATED DATA (AAD) 5-TUPLE:                         │
│   { hospital_id, patient_id, record_id, field, kek_id }                │
│                                                                        │
│   CIPHERTEXT: AES-256-GCM Encrypted Clinical Findings & Prescriptions │
│   WRAPPED DEK: DEK encrypted under kek-2026-09                         │
│   IV & AUTH TAG: 12-byte IV + 128-bit Authentication Tag               │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Fresh 32-Byte DEK per Record**: Every medical record generates a fresh, cryptographically random Data Encryption Key via `crypto.getRandomValues(new Uint8Array(32))`.
2. **5-Tuple AAD Binding**: The ciphertext is mathematically bound to its context by passing `{ hospital_id, patient_id, record_id, field, kek_id }` as `additionalData` to AES-GCM. Tampering with patient IDs or moving ciphertext across records causes immediate authentication tag failure.
3. **Encrypted DEK Storage**: The ephemeral DEK is wrapped under the master KEK and stored alongside the ciphertext in Appwrite Project B `MEDICAL_RECORD.envelope`.

---

## 4.1 Secrets Store KEK Rotation Process (Operational Runbook)

Key-Encryption Keys must be rotated periodically (e.g. annually or following personnel changes) to satisfy regulatory mandates (NIST SP 800-57, HIPAA § 164.312(a)(2)(iv)).

### Why KEK Rotation in DoctorCare is Non-Destructive and Zero-Downtime
In naive encryption systems, rotating a master key requires:
1. Decrypting gigabytes or terabytes of clinical records and files.
2. Re-encrypting the data with the new key.
3. Overwriting the entire database, incurring massive I/O, potential data corruption, and prolonged maintenance windows.

Under DoctorCare's **Envelope Encryption Architecture**, the clinical payload and patient files are **NEVER re-encrypted** during KEK rotation:
- The clinical payload remains safely encrypted with its unique ephemeral 32-byte DEK.
- KEK rotation **only re-wraps the 32-byte DEK** with the new KEK!
- **Performance**: Re-wrapping a 32-byte DEK takes ~0.1 milliseconds. An entire hospital repository of 100,000 records can be rotated in seconds without streaming clinical data over the network.

---

### Step-by-Step Operator Runbook for KEK Rotation

```
Phase 1: Provision New KEK   ──▶  Phase 2: Dual-KEK Binding   ──▶  Phase 3: Zero-Downtime Migration
(Secrets Store: kek-2027-01)      (wrangler.toml: Dual Keys)       (Lazy or Batch Re-Wrapping)
                                                                               │
                                                                               ▼
Phase 5: Key Revocation      ◀──  Phase 4: Audit Verification ◀────────────────┘
(Delete Retired kek-2026-09)      (Confirm 100% Records Migrated)
```

#### Phase 1: Provision the New KEK in Cloudflare Secrets Store
Generate a fresh, cryptographically secure 256-bit (32-byte) hex-encoded key and register it in the Secrets Store under `doctorcare_vault_store`:
```bash
# Generate high-entropy 256-bit key
NEW_KEK_VALUE=$(openssl rand -hex 32)

# Provision into Cloudflare Secrets Store
npx wrangler secrets-store secret create doctorcare_vault_store \
  --secret-name kek-2027-01 \
  --value "$NEW_KEK_VALUE"
```

#### Phase 2: Configure Dual-KEK Bindings in `workers/records/wrangler.toml`
Update the records worker configuration to support both the current and legacy KEK during the transition grace period:
```toml
# workers/records/wrangler.toml

# New Primary KEK for all new writes and re-wraps
[[secrets_store_secrets]]
binding = "KEK_CURRENT"
store_id = "doctorcare_vault_store"
secret_name = "kek-2027-01"

# Legacy KEK retained strictly for unwrapping during migration
[[secrets_store_secrets]]
binding = "KEK_PREVIOUS"
store_id = "doctorcare_vault_store"
secret_name = "kek-2026-09"
```

#### Phase 3: Zero-Downtime Decryption & Re-Wrapping Migration
Deploy the records Worker. The cryptographic engine automatically handles dual-key unwrapping:

```ts
// packages/shared/src/crypto/envelope.ts
export async function unwrapDekForRecord(
  envelope: EncryptedEnvelope,
  currentKek: CryptoKey,
  previousKek?: CryptoKey
): Promise<CryptoKey> {
  // If record was encrypted under previous KEK, unwrap using previous KEK
  if (envelope.kek_id === 'kek-2026-09' && previousKek) {
    return await unwrapDek(envelope.wrapped_dek, previousKek);
  }
  // Otherwise unwrap using current KEK
  return await unwrapDek(envelope.wrapped_dek, currentKek);
}
```

To migrate existing records in bulk without service interruption, execute the automated migration runner:
```bash
npm --workspace=@doctorcare/infra run rotate:kek -- \
  --old-kek-id kek-2026-09 \
  --new-kek-id kek-2027-01
```
For each record:
1. Unwraps the 32-byte DEK using `KEK_PREVIOUS`.
2. Re-wraps the 32-byte DEK under `KEK_CURRENT`.
3. Updates `envelope.wrapped_dek` and sets `kek_id = 'kek-2027-01'` in Appwrite Project B.
4. Leaves the clinical ciphertext byte-for-byte identical.

#### Phase 4: Verification & Audit
Verify that all medical records have transitioned to `kek-2027-01`:
```bash
# Verify all records in Project B have kek_id == kek-2027-01
npm --workspace=@doctorcare/infra run verify:kek-migration -- --expected-kek kek-2027-01

# Run cryptographic test suite against new KEK
npm run test:records
```

#### Phase 5: Decommission & Hardware Revocation of Retired KEK
Once audit logs confirm zero active records reference `kek-2026-09`:
1. Remove `KEK_PREVIOUS` from `workers/records/wrangler.toml`.
2. Redeploy `doctorcare-records`.
3. Permanently delete `kek-2026-09` from Cloudflare Secrets Store:
   ```bash
   npx wrangler secrets-store secret delete doctorcare_vault_store --secret-name kek-2026-09
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

Healthcare data governance frameworks—including **HIPAA § 164.312(b)** (Audit Controls) and **India DPDP Act 2023 Section 8**—strictly require that any access to Protected Health Information (PHI) must be verifiably logged. 

DoctorCare implements a **Fail-Closed Access Control Pattern**: under no circumstances will clinical data be decrypted or returned if the durable persistence of the access audit log fails.

```
Incoming Request: GET /api/v1/records/:recordId (with Staff MFA)
                               │
                               ▼
            ┌───────────────────────────────────────┐
            │  Verify Request & Enforce Velocity    │
            │  Cap (Layer 4: Max 50 decryptions/hr) │
            └──────────────────┬────────────────────┘
                               │
                               ▼
            ┌───────────────────────────────────────┐
            │ STEP 1: Durable Audit Write Attempt   │
            │ Write to Project B RECORD_ACCESS_LOG  │
            └──────────────────┬────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
         Write Fails                   Write Succeeds
                │                             │
                ▼                             ▼
  ┌───────────────────────────┐ ┌───────────────────────────────────────┐
  │ FAIL-CLOSED TERMINATION   │ │ STEP 2: Mirror Block to R2 Vault      │
  │ - Abort immediately (500) │ │ - Write-Only Cryptographic Mirror     │
  │ - Decryption is BLOCKED   │ └──────────────────┬────────────────────┘
  │ - ZERO clinical payload   │                    │
  │   or notes returned!      │                    ▼
  └───────────────────────────┘ ┌───────────────────────────────────────┐
                                │ STEP 3: Cryptographic Decryption      │
                                │ - Unwrap DEK with non-extractable KEK │
                                │ - Verify 5-tuple AAD authentication   │
                                │ - Decrypt AES-256-GCM ciphertext      │
                                └──────────────────┬────────────────────┘
                                                   │
                                                   ▼
                                        Return Decrypted Record +
                                        Audit Hash Chain Confirmation
```

### Collection Schema: `RECORD_ACCESS_LOG` (Project B)
Defined in `infra/appwrite/appwrite.config.json` under `medical_records_db`:

| Field | Type | Size | Description |
|---|---|---|---|
| `log_id` | String | 128 | Unique cryptographically random audit identifier (`log_${uuid}`). |
| `record_id` | String | 128 | Identifier of the accessed `MEDICAL_RECORD`. |
| `patient_id` | String | 128 | Identifier of the data principal. |
| `hospital_id` | String | 128 | Hospital/facility identifier. |
| `accessor_id` | String | 128 | Authenticated physician or staff ID (e.g. `doc_suresh_01`). |
| `accessor_role` | String | 64 | Clinical role (`doctor`, `nurse`, `compliance_officer`, `admin`). |
| `action` | String | 32 | Audit action (`READ`, `WRITE`, `EXPORT`, `HOLD_PLACED`). |
| `purpose` | String | 64 | Clinical justification (`CLINICAL_TREATMENT`, `EMERGENCY_CARE`, `STATUTORY_AUDIT`). |
| `ip_address` | String | 64 | Source IP address from Cloudflare header `CF-Connecting-IP`. |
| `user_agent` | String | 256 | Client User-Agent string. |
| `status` | String | 32 | Status (`RECORDED`, `FLAGGED_ANOMALOUS`). |
| `created_at` | String | 64 | ISO 8601 UTC timestamp. |

**Indexes in Project B**:
- `idx_log_id_unique`: Unique index on `log_id`.
- `idx_record_access`: Key index on `["record_id", "created_at"]` for historical record audits.
- `idx_accessor_patient`: Key index on `["accessor_id", "patient_id"]` for physician exfiltration velocity checks.

### Fail-Closed Implementation
```ts
// workers/records/src/index.ts
try {
  await databases.createDocument(
    env.APPWRITE_PROJECT_B_DATABASE_ID,
    'RECORD_ACCESS_LOG',
    logId,
    auditPayload
  );
} catch (dbError) {
  // CRITICAL FAIL-CLOSED ENFORCEMENT:
  // If audit logging fails, immediately abort and NEVER decrypt PHI.
  return new Response(
    JSON.stringify({
      error: 'AUDIT_LOG_FAILED',
      message: 'Fail-closed architecture blocked record access: audit log write rejected.',
    }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  );
}
```

---

## 22. Write-Only R2 Audit Vault & Cryptographic Hash-Chaining (`doctorcare-audit-vault`)

While database logs in Project B provide transactional querying, high-assurance healthcare systems require an **immutable, append-only, tamper-evident audit mirror**. Even if a privileged database administrator or malicious actor modifies or deletes rows in Appwrite Project B, the write-only R2 audit vault provides mathematical proof of tampering and non-repudiation.

```
                                    RECORD ACCESS EVENT
                                             │
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │           Canonical JSON Serializer           │
                     │  - Lexicographical sorting of all keys        │
                     │  - Strict ISO 8601 UTC timestamp format       │
                     └───────────────────────┬───────────────────────┘
                                             │
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │        Cryptographic SHA-256 Digest           │
                     │   crypto.subtle.digest('SHA-256', canonical)  │
                     └───────────────────────┬───────────────────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        IMMUTABLE R2 HASH-CHAINED BLOCKS                                │
│                                                                                        │
│   BLOCK #000001 (Genesis)             BLOCK #000002                   BLOCK #000003    │
│   ┌──────────────────────────┐        ┌──────────────────────────┐    ┌──────────────┐ │
│   │ seq: 1                   │        │ seq: 2                   │    │ seq: 3       │ │
│   │ prev_hash:               │        │ prev_hash:               │    │ prev_hash:   │ │
│   │   0000000000000000000... ├───────▶│   95d406b62e291c9f...    ├───▶│ 49d620d6...  │ │
│   │ hash:                    │        │ hash:                    │    │ hash:        │ │
│   │   95d406b62e291c9f...    │        │   49d620d66e65486f...    │    │ e780218a...  │ │
│   │ actor: doc_suresh_01     │        │ actor: doc_priya_02      │    │ actor: doc_a │ │
│   └──────────────────────────┘        └──────────────────────────┘    └──────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 22.1 Write-Only Scoped Cloudflare API Token

The R2 Audit Vault is provisioned with a strictly constrained Cloudflare API Token generated via [`infra/cloudflare/provision-audit-vault.ts`](file:///e:/doctor%20care/infra/cloudflare/provision-audit-vault.ts):

- **Target Bucket**: `doctorcare-audit-vault`.
- **Policy Permission**: `workers_r2_bucket_object_write` (PutObject allowed).
- **Explicit Exclusions**:
  - `workers_r2_bucket_object_read`: **FORBIDDEN** for operational ingest keys.
  - `workers_r2_bucket_object_delete`: **FORBIDDEN** (No credential in the system can issue `DeleteObject`).
  - `workers_r2_bucket_object_list`: **FORBIDDEN** for operational ingest keys.

**Security Benefit**: If an attacker compromises the runtime environment of `doctorcare-records`, they can only append new blocks to the vault; they are mathematically and cryptographically barred from reading, overwriting, backdating, or deleting historical audit records.

---

### 22.2 Cryptographic Hash Chain Mechanics

Each clinical access event produces a sequentially linked block stored under:
```
chain/${record_id}/${sequence_number.padStart(6, '0')}.json
```

#### Block JSON Schema
```json
{
  "sequence_number": 2,
  "previous_hash": "95d406b62e291c9f80928e185854891b2c554a938c417242c1619a9e30a5cb4b",
  "timestamp": "2026-09-18T10:14:02.190Z",
  "record_id": "rec_live_90214a1c",
  "patient_id": "pat_enc_892348",
  "hospital_id": "hosp_mumbai_apex_01",
  "actor_id": "usr_staff_dr_priya_01",
  "actor_role": "doctor",
  "action": "READ",
  "purpose": "CLINICAL_TREATMENT",
  "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "block_hash": "49d620d66e65486fe6a50616999a415ff568019b8417c88b7ad2691929007fef"
}
```

1. **Genesis Anchor**: Sequence #1 binds strictly to `GENESIS_HASH`:
   `0000000000000000000000000000000000000000000000000000000000000000`.
2. **Canonical Determinism**: All JSON keys are sorted recursively prior to hashing (`canonicalizeJson()`), guaranteeing that identical block states yield identical SHA-256 digests across any runtime, operating system, or CPU architecture.
3. **Cryptographic Linking**: For any block $N > 1$:
   $$\text{previous\_hash}_N \equiv \text{block\_hash}_{N-1}$$

---

### 22.3 Verification Algorithm & Tamper Detection

The integrity of any record's access history can be verified on-demand via:
```http
GET /api/v1/records/:recordId/audit-chain/verify
```

#### Verification Pipeline:
```ts
// packages/shared/src/audit/hash-chain.ts
export async function verifyHashChain(blocks: AuditBlock[]): Promise<VerificationResult> {
  if (blocks.length === 0) return { valid: true, totalBlocks: 0 };

  // 1. Genesis Block Check
  if (blocks[0].sequence_number !== 1) {
    return { valid: false, error: 'INVALID_GENESIS_SEQUENCE' };
  }
  if (blocks[0].previous_hash !== GENESIS_HASH) {
    return { valid: false, error: 'INVALID_GENESIS_PREV_HASH' };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const expectedSeq = i + 1;

    // 2. Sequence Continuity Check (Detects omitted/deleted blocks)
    if (block.sequence_number !== expectedSeq) {
      return {
        valid: false,
        error: 'SEQUENCE_GAP',
        message: `Expected sequence ${expectedSeq} at index ${i}, but found ${block.sequence_number}`
      };
    }

    // 3. Forward Link Integrity (Detects swapped or reordered blocks)
    if (i > 0 && block.previous_hash !== blocks[i - 1].block_hash) {
      return {
        valid: false,
        error: 'BROKEN_HASH_LINK',
        message: `Block ${block.sequence_number} previous_hash does not match Block ${i} hash`
      };
    }

    // 4. Content Hash Verification (Detects payload/timestamp tampering)
    const computedHash = await computeBlockHash(block);
    if (computedHash !== block.block_hash) {
      return {
        valid: false,
        error: 'CONTENT_HASH_MISMATCH',
        message: `Block ${block.sequence_number} content hash mismatch (computed: ${computedHash}, recorded: ${block.block_hash})`
      };
    }
  }

  return { valid: true, totalBlocks: blocks.length, headHash: blocks[blocks.length - 1].block_hash };
}
```

#### Sample Verification API Response:
```json
{
  "status": "CHAIN_VERIFIED",
  "valid": true,
  "record_id": "rec_live_90214a1c",
  "total_blocks": 5,
  "genesis_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "head_hash": "49d620d66e65486fe6a50616999a415ff568019b8417c88b7ad2691929007fef",
  "tamper_detected": false
}
```

---

## 23. Four-Layer Defense-in-Depth Rate Limiting Architecture

The DoctorCare platform implements four distinct architectural layers of rate limiting to ensure volumetric attack resistance, low-latency edge protection, zero-race distributed consistency, and compliance with clinical governance:

```
                  ┌─────────────────────────────────────────────────────────┐
  LAYER 1         │       Cloudflare Zone WAF Rate Limiting (Edge)          │
  Global Edge     │ - Auth & Token Exchange: 30 req/60s per IP (Block)       │
  DDoS Shield     │ - Clinical Records: 60 req/60s per IP (Block)           │
                  │ - General Volumetric: 600 req/60s per IP (Block)        │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
  LAYER 2         │      Cloudflare Workers RateLimit Bindings (In-Worker)  │
  In-Worker Edge  │ - AUTH_RATE_LIMITER: 15 req/60s per IP                   │
  Low-Latency     │ - API_RATE_LIMITER: 120 req/60s per IP                  │
  Throttling      │ Returns HTTP 429 (X-RateLimit-Layer: WORKERS_RATELIMIT)  │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
  LAYER 3         │      Exact Durable Object Counters (RATE_LIMITER_DO)    │
  Strong          │ - Atomic, single-threaded sliding-window counters       │
  Consistency     │ - Eliminates eventual consistency edge race conditions  │
  Zero Races      │ - Enforced on payment orders, slot reservations, and MFA│
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
  LAYER 4         │          Business-Logic Caps (Healthcare Quotas)        │
  Domain Quotas   │ - Slot Hoarding Cap: Max 3 active unconfirmed holds/pt   │
  & Anti-Abuse    │ - Doctor Exfiltration: Max 50 decryptions/hr (ER bypass)│
                  │ - File Uploads: Max 10 presigned URLs / 24 hours / pt    │
                  │ - Payment Attempts: Max 5 orders per appointment        │
                  └─────────────────────────────────────────────────────────┘
```

- **Layer 1: Zone WAF Rules (`infra/cloudflare/waf-rulesets.json`)**: Configured under Cloudflare Rulesets API phase `http_ratelimit`, mitigating volumetric burst attacks before requests consume Worker compute.
- **Layer 2: Workers RateLimit Bindings (`workers/api/wrangler.toml`)**: Cloudflare native `[[ratelimits]]` bindings executed as the earliest middleware in `api` worker (`enforceWorkersRateLimit`).
- **Layer 3: Exact Durable Object Counters (`RateLimiterDurableObject`)**: Keyed per actor/patient/doctor (`RATE_LIMITER_DO`), maintaining exact millisecond-precision timestamps in storage to guarantee zero concurrency race conditions.
- **Layer 4: Business-Logic Caps (`@doctorcare/shared`)**: Policy-level quotas preventing appointment hoarding (HTTP 422 `BUSINESS_QUOTA_EXCEEDED`), mass PHI record harvesting (HTTP 429 with `X-Emergency-Override` support), and file/payment spam.

---

## 24. Next.js Frontend on Cloudflare Workers via `@opennextjs/cloudflare`

The web client is scaffolded as a modern Next.js 14 App Router application located in `apps/web`:
- **Cloudflare OpenNext Adapter (`@opennextjs/cloudflare`)**:
  - Configured in `apps/web/open-next.config.ts` via `defineCloudflareConfig({})`.
  - Deploys as an edge worker targeting `.open-next/worker.js` with `nodejs_compat` runtime.
  - Serves static assets directly via Cloudflare Assets binding `ASSETS`.
  - Connects to backend services via internal Service Binding `API_SERVICE` -> `doctorcare-api`.
- **Apple-Inspired Minimalist Dark Aesthetic**:
  - Pitch black background (`#000000`) with subtle radial gradients and high-contrast typographic hierarchy (SF Pro Display / Inter).
  - Frosted glass cards (`.glass-panel`) with `backdrop-filter: blur(24px)` and hairline borders (`border: 1px solid rgba(255, 255, 255, 0.08)`).
  - Refined Apple status pills (`.apple-pill`) and micro-glow highlights for cryptographic and security states.
- **Application Modules**:
  - **Telemetry & Platform Overview (`/`)**: Real-time status cards displaying Cloudflare Pro Zone WAF, Secrets Store KEK, Dual Appwrite Isolation, and 4-Layer Rate Limiting metrics.
  - **Doctor & Clinic Directory (`/directory`)**: Searchable care directory with specialty filters, room/tower assignments, and server-derived consultation fees.
  - **10-Minute Hold Slot Booking (`/booking`)**: Single-threaded slot booking with real-time countdown timer synchronized with `SlotDurableObject.hold()` and automated alarm release.
  - **Encrypted Medical Records Vault (`/records`)**: Zero-trust clinical record explorer with AES-256-GCM + AAD envelope inspection, non-extractable KEK status, and live append-only R2 hash-chained block explorer.
  - **DPDP Act 2023 Consent Center (`/consent`)**: Granular consent management with multilingual notices, purpose limitation (`APPOINTMENT_COMMUNICATION`, `EHR_DATA_PROCESSING`), and instant right-to-withdraw toggles.
  - **Staff Authentication Portal (`/login`)**: Zero-trust token exchange with ephemeral in-memory access tokens and HttpOnly SameSite=Strict refresh cookies.

### 24.1 In-Memory Access Token Storage & HttpOnly Strict Cookie Architecture
- **In-Memory Access Token Store (`apps/web/src/lib/auth/tokenStore.ts`)**:
  - The short-lived (15-minute) JWT access token resides strictly in a JavaScript memory closure and React Context.
  - **Zero Web Storage Footprint**: `localStorage` and `sessionStorage` are never written to, preventing persistent XSS token harvesting.
  - Ephemeral lifecycle: On tab reload or closure, memory is purged; sessions are seamlessly restored via silent refresh.
- **HttpOnly, SameSite=Strict Refresh Cookie (`__Host-refresh_token`)**:
  - Browser-managed C-engine storage inaccessible to JavaScript (`document.cookie` cannot read or leak the refresh token).
  - Scope: Restricted to HTTPS origin with `SameSite=Strict` and `Path=/`.
- **Single-Flight Refresh Mutex (`apps/web/src/lib/auth/authClient.ts`)**:
  - Deduplicates concurrent background API refreshes into exactly one rotation request, eliminating race conditions in the Session Durable Object.
- **Authenticated API Client (`apps/web/src/lib/api/apiClient.ts`)**:
  - `apiFetch()` automatically injects `Authorization: Bearer <inMemoryToken>`.
  - Intercepts 401 Unauthorized, triggers silent token rotation via HttpOnly cookie, and retries the original request.

---

## 25. Development & Verification

### Install dependencies:
```bash
npm.cmd install
```

### Run Typecheck across all monorepo workspaces:
```bash
npm.cmd run typecheck
```

### Run Frontend Development Server:
```bash
npm.cmd run dev:web
```

### Build Frontend for Cloudflare Workers:
```bash
npm.cmd run build:web
```

### Run Provisioning Scripts:
```bash
npm.cmd run infra:secrets      # Cloudflare Secrets Store & KEK (kek-2026-09)
npm.cmd run infra:appwrite     # Appwrite Dual-Project & TablesDB Collections
npm.cmd run infra:waf          # Cloudflare Pro Zone WAF, OWASP & Layer 1 Rate Limiting
npm.cmd run infra:queues       # Cloudflare Queues & Dead-Letter Queue
npm.cmd run infra:r2           # Cloudflare Patient Files R2 Bucket
npm.cmd run infra:audit-vault  # Cloudflare Write-Only R2 Audit Vault & Scoped Token
```

### Run Test Suites:
```bash
npm.cmd run test               # Record Access Log & Fail-Closed Test Suite
npm.cmd run test:access-log    # Fail-Closed Audit Log Tests
npm.cmd run test:records       # Medical Records, R2 & AAD Tests
npm.cmd run test:notify        # Meta WhatsApp, Email & DPDP Consent Tests
npm.cmd run test:audit-chain   # R2 Write-Only Vault & Cryptographic Hash-Chain Tests
npm.cmd run test:ratelimit     # Four-Layer Defense-in-Depth Rate Limiting Tests
npm.cmd run test:frontend      # Next.js Frontend Scaffold & Design System Tests
npm.cmd run test:token-exchange # Frontend Token Exchange & In-Memory Auth Tests
npm.cmd run test:all           # Complete Test Suite (All 11 verification suites, 61 tests)
```




