/**
 * scripts/setup-appwrite-db.ts
 *
 * Idempotent Appwrite database provisioning script.
 * Reads schema from infra/appwrite/appwrite.config.json and provisions:
 *   – Project A (operational_db): HOSPITAL, DEPARTMENT, DOCTOR, ROOM,
 *     AVAILABILITY_SLOT, BOOKING, WEBHOOK_EVENT, CONSENT_LOG, etc.
 *   – Project B (medical_records_db): MEDICAL_RECORD, RECORD_ACCESS_LOG
 *
 * Usage:
 *   cd apps/web
 *   npx tsx scripts/setup-appwrite-db.ts
 *
 * Required env vars (from .env.local):
 *   NEXT_PUBLIC_APPWRITE_ENDPOINT
 *   NEXT_PUBLIC_APPWRITE_PROJECT_A_ID
 *   APPWRITE_PROJECT_A_API_KEY
 *   APPWRITE_PROJECT_B_ID
 *   APPWRITE_PROJECT_B_API_KEY
 */

import { Client, Databases, ID, IndexType } from 'node-appwrite';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env.local from apps/web
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Env validation ────────────────────────────────────────────────────────
const required = [
  'NEXT_PUBLIC_APPWRITE_ENDPOINT',
  'NEXT_PUBLIC_APPWRITE_PROJECT_A_ID',
  'APPWRITE_PROJECT_A_API_KEY',
  'APPWRITE_PROJECT_B_ID',
  'APPWRITE_PROJECT_B_API_KEY',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('❌  Missing required environment variables:\n' + missing.map((k) => `   • ${k}`).join('\n'));
  console.error('\n   Copy apps/web/.env.example to apps/web/.env.local and fill in the values.');
  process.exit(1);
}

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const PROJECT_A_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID!;
const PROJECT_A_KEY = process.env.APPWRITE_PROJECT_A_API_KEY!;
const PROJECT_B_ID = process.env.APPWRITE_PROJECT_B_ID!;
const PROJECT_B_KEY = process.env.APPWRITE_PROJECT_B_API_KEY!;

// ─── Load schema ────────────────────────────────────────────────────────────
const configPath = path.resolve(process.cwd(), '../../infra/appwrite/appwrite.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ─── Helper: create client ─────────────────────────────────────────────────
function makeClient(projectId: string, apiKey: string): Client {
  return new Client().setEndpoint(ENDPOINT).setProject(projectId).setKey(apiKey);
}

// ─── Helper: ensure database exists ───────────────────────────────────────
async function ensureDatabase(db: Databases, dbId: string, dbName: string): Promise<void> {
  try {
    await db.get(dbId);
    console.log(`  ✓ Database "${dbId}" already exists`);
  } catch {
    await db.create(dbId, dbName);
    console.log(`  ✓ Created database "${dbId}"`);
  }
}

// ─── Helper: ensure collection exists ─────────────────────────────────────
async function ensureCollection(
  db: Databases,
  dbId: string,
  collId: string,
  collName: string
): Promise<boolean> {
  try {
    await db.getCollection(dbId, collId);
    console.log(`    ↳ Collection "${collId}" already exists — skipping`);
    return false; // Already exists, don't re-add attributes
  } catch {
    await db.createCollection(dbId, collId, collName);
    console.log(`    ↳ Created collection "${collId}"`);
    return true; // Newly created, add attributes
  }
}

// ─── Helper: create attribute ─────────────────────────────────────────────
async function createAttribute(db: Databases, dbId: string, collId: string, attr: any): Promise<void> {
  try {
    switch (attr.type) {
      case 'string':
        await db.createStringAttribute(dbId, collId, attr.key, attr.size ?? 255, attr.required ?? false);
        break;
      case 'integer':
        await db.createIntegerAttribute(dbId, collId, attr.key, attr.required ?? false);
        break;
      case 'boolean':
        await db.createBooleanAttribute(dbId, collId, attr.key, attr.required ?? false);
        break;
      default:
        console.warn(`      ⚠ Unknown attribute type "${attr.type}" for "${attr.key}" — skipping`);
    }
    console.log(`      + attribute "${attr.key}" (${attr.type})`);
    // Appwrite needs a small delay between attribute creations
    await new Promise((r) => setTimeout(r, 300));
  } catch (err: any) {
    if (err?.type === 'attribute_already_exists' || err?.code === 409) {
      console.log(`      ↳ attribute "${attr.key}" already exists`);
    } else {
      throw err;
    }
  }
}

// ─── Helper: create index ─────────────────────────────────────────────────
async function createIndex(db: Databases, dbId: string, collId: string, idx: any): Promise<void> {
  try {
    const idxType = idx.type === 'unique' ? IndexType.Unique : IndexType.Key;
    await db.createIndex(dbId, collId, idx.key, idxType, idx.attributes);
    console.log(`      + index "${idx.key}" (${idx.type})`);
    await new Promise((r) => setTimeout(r, 300));
  } catch (err: any) {
    if (err?.type === 'index_already_exists' || err?.code === 409) {
      console.log(`      ↳ index "${idx.key}" already exists`);
    } else {
      throw err;
    }
  }
}

// ─── Provision project ─────────────────────────────────────────────────────
async function provisionProject(
  projectId: string,
  apiKey: string,
  projectConfig: any,
  label: string
): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label} → ${ENDPOINT} (project: ${projectId})`);
  console.log(`${'─'.repeat(60)}`);

  const client = makeClient(projectId, apiKey);
  const db = new Databases(client);

  for (const database of projectConfig.databases) {
    console.log(`\n  📦 Database: ${database.name} (${database.id})`);
    await ensureDatabase(db, database.id, database.name);

    for (const coll of database.collections) {
      console.log(`\n  📂 Collection: ${coll.name} (${coll.id})`);
      const isNew = await ensureCollection(db, database.id, coll.id, coll.name);

      if (isNew) {
        // Wait for collection to be ready
        await new Promise((r) => setTimeout(r, 500));

        for (const attr of coll.attributes ?? []) {
          await createAttribute(db, database.id, coll.id, attr);
        }

        // Wait for attributes to be indexed before creating indexes
        await new Promise((r) => setTimeout(r, 1000));

        for (const idx of coll.indexes ?? []) {
          await createIndex(db, database.id, coll.id, idx);
        }
      }
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DoctorCare — Appwrite Database Provisioning Script');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Endpoint : ${ENDPOINT}`);

  await provisionProject(PROJECT_A_ID, PROJECT_A_KEY, config.projectA, 'Project A (Operational)');
  await provisionProject(PROJECT_B_ID, PROJECT_B_KEY, config.projectB, 'Project B (Medical Records / PHI)');

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ✅  All collections provisioned successfully!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌  Provisioning failed:', err.message ?? err);
  process.exit(1);
});
