/**
 * Appwrite Server Factory — Project B (Medical Records / PHI)
 *
 * STRICTLY ISOLATED from Project A. Uses node-appwrite with a separate
 * APPWRITE_PROJECT_B_API_KEY that has no access to Project A collections.
 *
 * This factory should ONLY be used for:
 *  - MEDICAL_RECORD collection operations
 *  - RECORD_ACCESS_LOG writes
 *  - Any PHI/EHR document access
 *
 * In production, these operations flow through the records Worker via
 * the Cloudflare Service Binding. This server factory exists for:
 *  - Database provisioning scripts
 *  - Connectivity checks
 *  - Admin tooling
 *
 * Scopes: databases.read/write, documents.read/write, files.read/write
 */

import { Client, Databases } from 'node-appwrite';
import { getServerEnv } from './env';

/**
 * Create a fresh node-appwrite Client for Project B (PHI).
 * Returns a new instance per call — never cache in edge context.
 */
export function getServerClientB(): Client {
  const env = getServerEnv();
  return new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_B_ID)
    .setKey(env.APPWRITE_PROJECT_B_API_KEY);
}

/** Databases service for Project B — use for MEDICAL_RECORD, RECORD_ACCESS_LOG only */
export function getServerDatabasesB(): Databases {
  return new Databases(getServerClientB());
}
