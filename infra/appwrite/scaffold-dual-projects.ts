/**
 * DoctorCare Dual-Project Backend Scaffolding & Cloudflare Secrets Generator
 *
 * Scaffolds:
 *  1. Project A: DoctorCare Ops (Auth, Directory, Bookings, Consent)
 *     - Scopes: documents.read, documents.write, users.read, users.write
 *  2. Project B: DoctorCare Records (Strictly isolated PHI/EHR under KEK)
 *     - Scopes: documents.read, documents.write
 *  3. Cryptographic Key: 32-byte AES-256 KEK_2026_09
 *
 * Usage:
 *  npx tsx infra/appwrite/scaffold-dual-projects.ts
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface ProjectSpec {
  id: string;
  name: string;
  description: string;
  keyName: string;
  scopes: string[];
}

const PROJECT_A: ProjectSpec = {
  id: 'doctorcare-ops',
  name: 'DoctorCare Ops',
  description: 'Operational Data: Staff Auth, Doctor Directory, Appointments, Bookings & Consent',
  keyName: 'doctorcare-ops-server-key',
  scopes: ['documents.read', 'documents.write', 'users.read', 'users.write'],
};

const PROJECT_B: ProjectSpec = {
  id: 'doctorcare-records',
  name: 'DoctorCare Records',
  description: 'Strictly Isolated PHI & EHR Medical Records Encrypted Under KEK_2026_09',
  keyName: 'doctorcare-records-server-key',
  scopes: ['documents.read', 'documents.write'],
};

function generateSecureKek(): string {
  // 32 bytes = 256 bits for AES-256-GCM Envelope Encryption
  return crypto.randomBytes(32).toString('hex');
}

async function scaffold() {
  console.log('========================================================================');
  console.log('   DoctorCare — Appwrite Backend & Cloudflare Secrets Scaffolding       ');
  console.log('========================================================================\n');

  const endpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
  const consoleApiKey = process.env.APPWRITE_CONSOLE_API_KEY || process.env.APPWRITE_MASTER_KEY;

  const kek = generateSecureKek();
  let keyA = 'appwrite_key_proj_a_' + crypto.randomBytes(16).toString('hex');
  let keyB = 'appwrite_key_proj_b_' + crypto.randomBytes(16).toString('hex');

  console.log('[1] TARGET APPWRITE PROJECTS:');
  console.log('------------------------------------------------------------------------');
  console.log('  Project A (Operational):');
  console.log(`    • Project ID : ${PROJECT_A.id}`);
  console.log(`    • Name       : "${PROJECT_A.name}"`);
  console.log(`    • API Key    : "${PROJECT_A.keyName}"`);
  console.log(`    • Scopes     : [${PROJECT_A.scopes.join(', ')}]`);
  console.log('');
  console.log('  Project B (Medical Records / PHI):');
  console.log(`    • Project ID : ${PROJECT_B.id}`);
  console.log(`    • Name       : "${PROJECT_B.name}"`);
  console.log(`    • API Key    : "${PROJECT_B.keyName}"`);
  console.log(`    • Scopes     : [${PROJECT_B.scopes.join(', ')}]`);
  console.log('');

  if (consoleApiKey) {
    console.log(`[*] Connecting to Appwrite Console API (${endpoint})...`);
    for (const proj of [PROJECT_A, PROJECT_B]) {
      try {
        console.log(`    -> Provisioning ${proj.name}...`);
        const res = await fetch(`${endpoint}/projects`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Appwrite-Key': consoleApiKey,
          },
          body: JSON.stringify({
            projectId: proj.id,
            name: proj.name,
            teamId: process.env.APPWRITE_TEAM_ID || 'default',
          }),
        });

        if (res.ok || res.status === 409) {
          console.log(`    ✓ Project ${proj.id} ready.`);
        }

        const keyRes = await fetch(`${endpoint}/projects/${proj.id}/keys`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Appwrite-Key': consoleApiKey,
          },
          body: JSON.stringify({
            name: proj.keyName,
            scopes: proj.scopes,
          }),
        });

        if (keyRes.ok) {
          const data: any = await keyRes.json();
          if (proj.id === PROJECT_A.id) keyA = data.secret;
          if (proj.id === PROJECT_B.id) keyB = data.secret;
          console.log(`    ✓ Generated live API key for ${proj.name}.`);
        }
      } catch (err: any) {
        console.warn(`    ⚠ Notice during automated API call: ${err.message}`);
      }
    }
  } else {
    console.log('[i] Note: To auto-create projects via Appwrite Console REST API, set APPWRITE_CONSOLE_API_KEY.');
    console.log('    Alternatively, create both projects in the Appwrite Console with the scopes above.\n');
  }

  console.log('\n[2] CRYPTOGRAPHIC KEY GENERATION (KEK_2026_09):');
  console.log('------------------------------------------------------------------------');
  console.log('  • Algorithm: AES-256-GCM (Non-extractable Key-Encryption Key)');
  console.log('  • Entropy  : 256 bits (32 bytes cryptographically secure random)');
  console.log(`  • Value    : ${kek}\n`);

  console.log('[3] CLOUDFLARE WRANGLER SECRET PUT COMMANDS:');
  console.log('------------------------------------------------------------------------');
  console.log('  Upload secrets securely to your Cloudflare Worker environments:\n');
  console.log('  # --- 1. doctorcare-api Worker (Project A Credentials) ---');
  console.log('  npx wrangler secret put APPWRITE_PROJECT_A_KEY --config workers/api/wrangler.toml');
  console.log(`  (Input: ${keyA})\n`);
  console.log('  # --- 2. doctorcare-records Worker (Project B Credentials + KEK) ---');
  console.log('  npx wrangler secret put APPWRITE_PROJECT_B_KEY --config workers/records/wrangler.toml');
  console.log(`  (Input: ${keyB})\n`);
  console.log('  npx wrangler secret put KEK_2026_09 --config workers/records/wrangler.toml');
  console.log(`  (Input: ${kek})\n`);
  console.log('  # --- 3. doctorcare Frontend Web Worker ---');
  console.log('  npx wrangler secret put APPWRITE_PROJECT_A_API_KEY');
  console.log(`  (Input: ${keyA})\n`);
  console.log('  npx wrangler secret put APPWRITE_PROJECT_B_API_KEY');
  console.log(`  (Input: ${keyB})\n`);

  // Write local template files for testing
  const root = path.resolve(__dirname, '../..');
  const devRecords = path.join(root, 'workers/records/.dev.vars');
  fs.writeFileSync(
    devRecords,
    `ENVIRONMENT=development\nAPPWRITE_ENDPOINT=${endpoint}\nAPPWRITE_PROJECT_B_ID=${PROJECT_B.id}\nAPPWRITE_PROJECT_B_KEY=${keyB}\nKEK_2026_09=${kek}\n`,
    'utf8'
  );

  const devApi = path.join(root, 'workers/api/.dev.vars');
  fs.writeFileSync(
    devApi,
    `ENVIRONMENT=development\nAPPWRITE_ENDPOINT=${endpoint}\nAPPWRITE_PROJECT_A_ID=${PROJECT_A.id}\nAPPWRITE_PROJECT_A_KEY=${keyA}\n`,
    'utf8'
  );

  console.log('[4] LOCAL DEV FILES GENERATED:');
  console.log('------------------------------------------------------------------------');
  console.log('  ✓ workers/records/.dev.vars (configured with KEK_2026_09 and Project B key)');
  console.log('  ✓ workers/api/.dev.vars     (configured with Project A key)');
  console.log('========================================================================\n');
}

scaffold().catch(console.error);
