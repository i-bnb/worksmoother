/**
 * Browser-side Appwrite Storage client.
 *
 * Architecture boundary:
 * – Auth  → Better Auth (Cloudflare D1)
 * – DB    → Cloudflare D1 via API Worker
 * – Files → Appwrite Storage (this module)
 *
 * Only the `Client` and `Storage` primitives are used from the Appwrite SDK.
 * Auth and database stubs have been removed — those concerns live elsewhere.
 */
import { Client, Storage, ID } from 'appwrite';
import { publicEnv } from './env';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client
// ─────────────────────────────────────────────────────────────────────────────
let _client: Client | null = null;

export function getClient(): Client {
  if (!_client) {
    _client = new Client()
      .setEndpoint(publicEnv.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(publicEnv.NEXT_PUBLIC_APPWRITE_PROJECT_STORAGE_ID);
  }
  return _client;
}

export function getStorage(): Storage {
  return new Storage(getClient());
}

/** Re-export ID helper so callers don't import directly from 'appwrite' */
export { ID };
