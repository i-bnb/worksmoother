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

## 9. Development & Verification

### Install dependencies:
```bash
npm.cmd install
```

### Run Typecheck across monorepo:
```bash
npm.cmd run typecheck
```

### Run Architecture & Cryptographic Verification Tests:
```bash
npx.cmd tsx tests/architecture.test.ts
```

### Run Auth, Session DO & MFA Enforcement Tests:
```bash
npx.cmd tsx tests/auth-session.test.ts
```

### Run Directory Module, Slot DO & Strict Zod Tests:
```bash
npx.cmd tsx tests/directory-slots.test.ts
```


