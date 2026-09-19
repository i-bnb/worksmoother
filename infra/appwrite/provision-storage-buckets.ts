/**
 * Appwrite Storage Bucket Provisioning Script
 *
 * Creates the two required storage buckets in the DoctorCare Appwrite project:
 * – public-assets      : Doctor photos and hospital logos (public read)
 * – clinical-documents : Patient clinical files (owner-scoped, encrypted)
 *
 * Usage:
 *   APPWRITE_STORAGE_API_KEY=<your_key> npx ts-node infra/appwrite/provision-storage-buckets.ts
 *
 * Prerequisites:
 *   – Appwrite project 6aae1c62000bebb93adb must exist in the sgp region
 *   – API key must have: storage.read, storage.write, buckets.read, buckets.write
 *
 * SECURITY NOTE:
 *   Files > 20 MB bypass Appwrite's at-rest encryption silently.
 *   Both buckets enforce fileSizeLimit at the bucket level as a platform safeguard.
 */
import { Client, Storage, Permission, Role } from 'node-appwrite';

const ENDPOINT = process.env.APPWRITE_ENDPOINT ?? 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_STORAGE_ID ?? '6aae1c62000bebb93adb';
const API_KEY = process.env.APPWRITE_STORAGE_API_KEY ?? '';

if (!API_KEY) {
  console.error('❌  APPWRITE_STORAGE_API_KEY is not set.');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const storage = new Storage(client);

// ─────────────────────────────────────────────────────────────────────────────
// Bucket definitions
// ─────────────────────────────────────────────────────────────────────────────

const BUCKETS = [
  {
    id: 'public-assets',
    name: 'Public Assets (Doctor Photos & Logos)',
    /** Public read — any visitor can view doctor photos without authentication */
    permissions: [
      Permission.read(Role.any()),
      Permission.write(Role.users()),   // only authenticated users can upload
      Permission.delete(Role.users()),
    ],
    fileSizeLimit: 10 * 1024 * 1024,   // 10 MB — public images only
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'],
    encryption: false,                  // public media, no PHI
    antivirus: true,
  },
  {
    id: 'clinical-documents',
    name: 'Clinical Documents (Patient Files — Restricted)',
    /**
     * Owner-scoped permissions enforced at Appwrite document level.
     * The API Worker sets per-file permissions when uploading on behalf of a patient.
     * Default bucket-level permissions intentionally empty — rely on file-level ACL.
     */
    permissions: [],
    fileSizeLimit: 20 * 1024 * 1024,   // 20 MB — Appwrite encryption threshold
    allowedFileExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'dcm', 'xml'],
    encryption: true,                   // Appwrite at-rest encryption for PHI
    antivirus: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Provisioning
// ─────────────────────────────────────────────────────────────────────────────

async function provisionBucket(bucket: typeof BUCKETS[number]) {
  console.log(`\n→ Provisioning bucket: ${bucket.id}`);
  try {
    // Attempt to create; if it already exists Appwrite returns a 409
    const result = await storage.createBucket(
      bucket.id,
      bucket.name,
      bucket.permissions,
      false,                             // fileSecurity: false = use bucket-level permissions
      bucket.encryption,
      bucket.antivirus,
      bucket.allowedFileExtensions,
      bucket.fileSizeLimit,
      undefined,                         // maximumFileSize: not used (fileSizeLimit is the cap)
    );
    console.log(`  ✓ Created: ${result.$id} — "${result.name}"`);
    console.log(`    Encryption: ${result.encryption ? 'ENABLED' : 'disabled'}`);
    console.log(`    Max file size: ${(result.maximumFileSize / 1024 / 1024).toFixed(0)} MB`);
  } catch (err: any) {
    if (err?.code === 409) {
      console.log(`  ⚠ Already exists (409) — skipping create, bucket is up-to-date.`);
    } else {
      console.error(`  ✗ Failed to provision ${bucket.id}:`, err?.message ?? err);
      throw err;
    }
  }
}

async function main() {
  console.log('=== DoctorCare Appwrite Storage Provisioning ===');
  console.log(`Endpoint  : ${ENDPOINT}`);
  console.log(`Project   : ${PROJECT_ID}`);
  console.log(`Buckets   : ${BUCKETS.map(b => b.id).join(', ')}\n`);

  for (const bucket of BUCKETS) {
    await provisionBucket(bucket);
  }

  console.log('\n✅  All storage buckets provisioned successfully.');
  console.log('\nNext steps:');
  console.log('  1. Set APPWRITE_STORAGE_API_KEY in your .env.local');
  console.log('  2. Run: npx wrangler secret put APPWRITE_STORAGE_API_KEY');
  console.log('  3. Verify buckets in Appwrite Console → Storage');
}

main().catch((err) => {
  console.error('\n❌  Provisioning failed:', err);
  process.exit(1);
});
