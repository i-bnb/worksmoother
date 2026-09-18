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

## 5. Development & Verification

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
