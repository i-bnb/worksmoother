/**
 * Server-side Appwrite Storage accessor (records context).
 *
 * Post-pivot architecture:
 * – Medical record metadata is stored in Cloudflare D1 (doctorcare-records-db)
 * – Clinical document files (PDF, images) are stored in Appwrite Storage
 *
 * This module provides server-side access to Appwrite Storage for the
 * clinical-documents bucket using the storage-scoped API key.
 *
 * The old Project B (medical records Appwrite DB) has been decommissioned.
 * All structured PHI data is now in D1 under the records worker.
 */
import { getServerEnv } from './env';

export class Client {
  endpoint = '';
  project = '';
  key = '';

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint;
    return this;
  }

  setProject(project: string) {
    this.project = project;
    return this;
  }

  setKey(key: string) {
    this.key = key;
    return this;
  }
}

/** Returns a server-side Appwrite client for storage access in the records context. */
export function getServerStorageClientRecords(): Client {
  const env = getServerEnv();
  return new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_STORAGE_ID)
    .setKey(env.APPWRITE_STORAGE_API_KEY);
}
