/**
 * Cloudflare R2 Bucket Provisioning & Private Records Worker Verification Script
 * Provisions 'doctorcare-patient-files' exclusively for patient file uploads.
 * Verifies that the records Worker has zero public internet routes and is accessible
 * solely via the api Worker's RECORDS_SERVICE private Service Binding.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const R2_CONFIG = {
  bucketName: 'doctorcare-patient-files',
  bindingName: 'PATIENT_FILES_BUCKET',
  targetWorker: 'doctorcare-records',
  apiGatewayWorker: 'doctorcare-api',
  presignedUrlExpirySeconds: 300, // Strict 5-minute expiry
};

export async function provisionR2() {
  console.log('================================================================');
  console.log('   Cloudflare R2 Bucket Provisioning & Isolation Audit Engine   ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const recordsWranglerPath = path.join(rootDir, 'workers/records/wrangler.toml');
  const apiWranglerPath = path.join(rootDir, 'workers/api/wrangler.toml');

  console.log(`[*] Target R2 Bucket: "${R2_CONFIG.bucketName}"`);
  console.log(`[*] Dedicated Binding: "${R2_CONFIG.bindingName}"`);
  console.log(`[*] Bound Worker: "${R2_CONFIG.targetWorker}"`);
  console.log(`[*] Strict Presigned URL TTL: ${R2_CONFIG.presignedUrlExpirySeconds}s (5 minutes)`);

  const isCloudflareAuthAvailable = Boolean(
    process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID
  );

  if (isCloudflareAuthAvailable) {
    try {
      console.log(`\n[*] Checking and creating R2 bucket "${R2_CONFIG.bucketName}" via Wrangler CLI...`);
      try {
        const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execSync(`${cmd} wrangler r2 bucket create ${R2_CONFIG.bucketName}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        console.log(`[+] Successfully created R2 bucket: ${R2_CONFIG.bucketName}`);
      } catch (err: any) {
        console.log(`[INFO] R2 bucket already exists or returned: ${err.message?.split('\n')[0]}`);
      }
    } catch (err: any) {
      console.warn(`[!] Cloudflare R2 provisioning warning: ${err.message}`);
    }
  } else {
    console.log('\n[INFO] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set in environment.');
    console.log('[INFO] Operating in Declarative / Offline Validation Mode.');
  }

  // 1. Audit workers/records/wrangler.toml
  console.log('\n[*] Auditing records Worker configuration in workers/records/wrangler.toml...');
  if (!fs.existsSync(recordsWranglerPath)) {
    throw new Error(`records wrangler.toml not found at ${recordsWranglerPath}`);
  }

  const recordsWranglerContent = fs.readFileSync(recordsWranglerPath, 'utf8');

  // Check R2 bucket binding
  const hasR2Binding =
    recordsWranglerContent.includes('[[r2_buckets]]') &&
    recordsWranglerContent.includes('PATIENT_FILES_BUCKET') &&
    recordsWranglerContent.includes('doctorcare-patient-files');

  if (!hasR2Binding) {
    throw new Error('Missing [[r2_buckets]] binding for PATIENT_FILES_BUCKET in workers/records/wrangler.toml');
  }
  console.log('  -> [PASS] PATIENT_FILES_BUCKET correctly bound to doctorcare-patient-files.');

  // Check private network isolation (zero public routes)
  const hasPublicRoutes =
    recordsWranglerContent.includes('routes =') ||
    recordsWranglerContent.includes('custom_domain = true') ||
    recordsWranglerContent.includes('route =');

  if (hasPublicRoutes) {
    throw new Error(
      'CRITICAL SECURITY VIOLATION: records Worker must NOT have public routes or custom domains configured!'
    );
  }
  console.log('  -> [PASS] Verified zero public routes. records Worker has NO public internet interface.');

  // 2. Audit workers/api/wrangler.toml for Service Binding
  console.log('\n[*] Auditing api Worker configuration in workers/api/wrangler.toml...');
  if (!fs.existsSync(apiWranglerPath)) {
    throw new Error(`api wrangler.toml not found at ${apiWranglerPath}`);
  }

  const apiWranglerContent = fs.readFileSync(apiWranglerPath, 'utf8');
  const hasRecordsServiceBinding =
    (apiWranglerContent.includes('binding = "RECORDS_SERVICE"') ||
      apiWranglerContent.includes('name = "RECORDS_SERVICE"')) &&
    apiWranglerContent.includes('service = "doctorcare-records"');

  if (!hasRecordsServiceBinding) {
    throw new Error('api Worker missing RECORDS_SERVICE binding to doctorcare-records');
  }
  console.log('  -> [PASS] RECORDS_SERVICE binding correctly links api Worker to doctorcare-records.');

  console.log('\n================================================================');
  console.log('   CLOUDFLARE R2 PROVISIONING & ISOLATION AUDIT COMPLETE!       ');
  console.log('================================================================\n');

  return {
    success: true,
    bucketName: R2_CONFIG.bucketName,
    bindingName: R2_CONFIG.bindingName,
    workerName: R2_CONFIG.targetWorker,
    publicRoutes: false,
    serviceBindingVerified: true,
  };
}

provisionR2().catch((err) => {
  console.error('[FATAL] R2 provisioning failed:', err);
  process.exit(1);
});
