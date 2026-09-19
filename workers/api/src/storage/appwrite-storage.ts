/**
 * Appwrite Storage utility for the DoctorCare API Worker.
 *
 * Uses `node-appwrite` which runs safely in the Cloudflare Workers V8 isolate
 * because `nodejs_compat` is enabled in workers/api/wrangler.toml.
 *
 * This module handles server-side storage operations:
 * – File metadata retrieval
 * – Admin-level file deletion (clinical document lifecycle)
 * – Bucket file listing
 * – Server-side 20 MB size guard (defence-in-depth)
 *
 * The APPWRITE_STORAGE_API_KEY environment variable must be set as a
 * Cloudflare secret: `npx wrangler secret put APPWRITE_STORAGE_API_KEY`
 * The key must be scoped to storage.read and storage.write ONLY.
 */
import { Client, Storage, ID, Query } from 'node-appwrite';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const BUCKET_PUBLIC_ASSETS = 'public-assets';
export const BUCKET_CLINICAL_DOCS = 'clinical-documents';

/** 20 MB — Appwrite's at-rest encryption threshold */
const MAX_ENCRYPTED_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Env types (Cloudflare Workers binding shape)
// ─────────────────────────────────────────────────────────────────────────────
export interface StorageEnv {
  APPWRITE_STORAGE_API_KEY: string;
  APPWRITE_ENDPOINT?: string;
  APPWRITE_PROJECT_STORAGE_ID?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a node-appwrite Client authenticated with the storage-scoped API key.
 * Call this once per request — do not cache across requests in a Worker context.
 */
export function createStorageClient(env: StorageEnv): { client: Client; storage: Storage } {
  const endpoint = env.APPWRITE_ENDPOINT ?? 'https://sgp.cloud.appwrite.io/v1';
  const projectId = env.APPWRITE_PROJECT_STORAGE_ID ?? '6aae1c62000bebb93adb';

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(env.APPWRITE_STORAGE_API_KEY);

  const storage = new Storage(client);
  return { client, storage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Size guard (server-side defence-in-depth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a file size before upload.
 * Returns an error message string if the size exceeds 20 MB, or null if OK.
 * Call this in API route handlers before forwarding to Appwrite.
 */
export function checkFileSizeLimit(sizeBytes: number): string | null {
  if (sizeBytes > MAX_ENCRYPTED_FILE_SIZE_BYTES) {
    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
    return (
      `FILE_TOO_LARGE: file is ${sizeMb} MB. ` +
      `Maximum is 20 MB to ensure Appwrite at-rest encryption is applied.`
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve metadata for a single file without downloading its content.
 */
export async function getFileMetadata(
  env: StorageEnv,
  bucketId: string,
  fileId: string
) {
  const { storage } = createStorageClient(env);
  return storage.getFile(bucketId, fileId);
}

/**
 * List files in a bucket with optional Appwrite Query filters.
 * Example queries: [Query.equal('name', 'report.pdf')]
 */
export async function listFiles(
  env: StorageEnv,
  bucketId: string,
  queries: string[] = []
) {
  const { storage } = createStorageClient(env);
  return storage.listFiles(bucketId, queries);
}

/**
 * Admin-level file deletion — requires storage.write scope on the API key.
 * Used for clinical document lifecycle management and retention policy enforcement.
 */
export async function deleteFile(
  env: StorageEnv,
  bucketId: string,
  fileId: string
): Promise<void> {
  const { storage } = createStorageClient(env);
  await storage.deleteFile(bucketId, fileId);
}

/**
 * Re-export ID and Query helpers for use in route handlers.
 */
export { ID, Query };
