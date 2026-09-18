/**
 * Appwrite Server Factory — Project A (Operational)
 *
 * Uses node-appwrite with the server-side APPWRITE_PROJECT_A_API_KEY.
 * Import ONLY from edge route handlers, API routes, or Node.js scripts.
 * Never import in Client Components or browser-side code.
 *
 * Scopes: databases.read/write, collections.read/write, documents.read/write,
 *         users.read, messages.read/write, providers.read/write
 */

import { Client, Databases, Users, Account } from 'node-appwrite';
import { getServerEnv } from './env';

/**
 * Create a fresh node-appwrite Client authenticated with the Project A API key.
 * Returns a new instance per call — suitable for edge contexts where module-level
 * singletons may be shared across requests.
 */
export function getServerClientA(): Client {
  const env = getServerEnv();
  return new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID)
    .setKey(env.APPWRITE_PROJECT_A_API_KEY);
}

/** Databases service for Project A — use for HOSPITAL, DOCTOR, BOOKING, CONSENT_LOG, etc. */
export function getServerDatabasesA(): Databases {
  return new Databases(getServerClientA());
}

/** Users service for Project A — use for identity verification and JWT validation */
export function getServerUsersA(): Users {
  return new Users(getServerClientA());
}

/**
 * Verify an Appwrite JWT by fetching the associated account.
 * Throws if the JWT is invalid or expired.
 */
export async function verifyAppwriteJwtA(jwt: string): Promise<{ userId: string; email: string; name: string }> {
  const env = getServerEnv();
  // Use a client authenticated with the JWT (not the API key) for verification
  const jwtClient = new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID)
    .setJWT(jwt);

  const account = new Account(jwtClient);
  const user = await account.get();

  return {
    userId: user.$id,
    email: user.email,
    name: user.name,
  };
}
