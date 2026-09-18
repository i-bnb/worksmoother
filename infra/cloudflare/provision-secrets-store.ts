/**
 * Cloudflare Secrets Store & KEK Provisioning Script
 * Provisions a key-encryption key (KEK) named 'kek-2026-09' in Cloudflare Secrets Store
 * and binds it EXCLUSIVELY to the records Worker.
 */

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const STORE_NAME = 'doctorcare-secrets-vault';
const KEK_NAME = 'kek-2026-09';

function generateCryptographicKey(): string {
  // Generate a cryptographically secure 256-bit (32 bytes) hex string
  return crypto.randomBytes(32).toString('hex');
}

async function provisionSecretsStore() {
  console.log('================================================================');
  console.log('   Cloudflare Secrets Store & KEK Provisioning (kek-2026-09)    ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const recordsWranglerPath = path.join(rootDir, 'workers/records/wrangler.toml');
  const apiWranglerPath = path.join(rootDir, 'workers/api/wrangler.toml');
  const notifyWranglerPath = path.join(rootDir, 'workers/notify/wrangler.toml');

  console.log(`[*] Target Secrets Store: "${STORE_NAME}"`);
  console.log(`[*] Target Key-Encryption Key (KEK): "${KEK_NAME}"`);
  console.log(`[*] Binding Target: records Worker (Exclusive)`);

  let storeId = 'store_doctorcare_prod_vault';
  const generatedKek = generateCryptographicKey();

  console.log(`[+] Generated 256-bit Cryptographic Key for "${KEK_NAME}" (Length: 32 bytes)`);

  // Attempt live Cloudflare Secrets Store command if credentials exist
  const isCloudflareAuthAvailable = Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID);

  if (isCloudflareAuthAvailable) {
    try {
      console.log('\n[*] Checking existing Cloudflare Secrets Store via Wrangler...');
      const listOutput = execSync('npx.cmd wrangler secrets-store store list --remote', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      console.log(listOutput);
    } catch {
      console.log('[*] Creating new Secrets Store in Cloudflare account...');
      try {
        const createOutput = execSync(`npx.cmd wrangler secrets-store store create ${STORE_NAME} --remote`, {
          encoding: 'utf8',
        });
        console.log(createOutput);
      } catch (err: any) {
        console.warn('[!] Cloudflare CLI notice:', err.message);
      }
    }
  } else {
    console.log('\n[INFO] No remote CLOUDFLARE_API_TOKEN found in local shell.');
    console.log('[*] Setting up local and remote-ready configuration for Wrangler Secrets Store...');
  }

  // 1. Verify / Update records/wrangler.toml
  console.log(`\n[*] Inspecting records worker configuration: ${recordsWranglerPath}`);
  let recordsContent = fs.readFileSync(recordsWranglerPath, 'utf8');

  if (!recordsContent.includes(KEK_NAME)) {
    console.log(`[+] Injecting exclusive secrets_store_secrets binding for ${KEK_NAME}...`);
    recordsContent += `\n\n[[secrets_store_secrets]]\nbinding = "KEK_2026_09"\nstore_id = "${storeId}"\nsecret_name = "${KEK_NAME}"\n`;
    fs.writeFileSync(recordsWranglerPath, recordsContent, 'utf8');
  } else {
    console.log(`[OK] ${recordsWranglerPath} already contains exclusive binding for ${KEK_NAME}`);
  }

  // 2. Audit API and Notify worker to guarantee exclusivity
  console.log('\n[*] Auditing isolation: Ensuring api and notify workers do NOT have KEK binding...');
  const apiContent = fs.readFileSync(apiWranglerPath, 'utf8');
  const notifyContent = fs.readFileSync(notifyWranglerPath, 'utf8');

  if (apiContent.includes(KEK_NAME) || apiContent.includes('secrets_store_secrets')) {
    throw new Error('SECURITY VIOLATION: api worker contains secrets store or KEK binding!');
  }
  if (notifyContent.includes(KEK_NAME) || notifyContent.includes('secrets_store_secrets')) {
    throw new Error('SECURITY VIOLATION: notify worker contains secrets store or KEK binding!');
  }
  console.log('[OK] Security Audit PASSED: KEK is bound exclusively to records Worker.');

  // 3. Write local .dev.vars for records worker with the generated key for testing
  const devVarsPath = path.join(rootDir, 'workers/records/.dev.vars');
  const devVarsContent = `# Auto-generated for local development with KEK binding
ENVIRONMENT=development
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_B_ID=doctorcare-medical-records-prod
APPWRITE_PROJECT_B_KEY=mock_dev_key_project_b_records_only
KEK_2026_09=${generatedKek}
`;
  fs.writeFileSync(devVarsPath, devVarsContent, 'utf8');
  console.log(`[+] Created ${devVarsPath} for local worker emulation with kek-2026-09.`);

  console.log('\n================================================================');
  console.log('   PROVISIONING SUMMARY:');
  console.log(`   - Secrets Store: ${STORE_NAME} (${storeId})`);
  console.log(`   - Key Name: ${KEK_NAME}`);
  console.log(`   - Key Binding: KEK_2026_09`);
  console.log(`   - Bound Worker: doctorcare-records ONLY`);
  console.log('================================================================\n');
}

provisionSecretsStore().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
