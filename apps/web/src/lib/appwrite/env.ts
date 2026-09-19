import { z } from 'zod';

/**
 * Centralised, Zod-validated environment configuration for the DoctorCare web app.
 *
 * Architecture (post storage-layer pivot):
 * – Auth, scheduling, directory → Cloudflare D1 / Better Auth
 * – File storage (doctor photos, clinical documents) → Appwrite Storage only
 *
 * – NEXT_PUBLIC_* vars are available in both browser and server contexts.
 * – Server-only vars (without NEXT_PUBLIC_) are validated only when this module
 *   is imported from a server/edge context (route handlers, scripts).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public schema — safe to access client-side
// ─────────────────────────────────────────────────────────────────────────────
const publicEnvSchema = z.object({
  /** Appwrite cloud endpoint for the sgp-region storage project */
  NEXT_PUBLIC_APPWRITE_ENDPOINT: z
    .string()
    .url('NEXT_PUBLIC_APPWRITE_ENDPOINT must be a valid URL')
    .default('https://sgp.cloud.appwrite.io/v1'),
  /** Single Appwrite project ID used exclusively for storage */
  NEXT_PUBLIC_APPWRITE_PROJECT_STORAGE_ID: z
    .string()
    .default('6aae1c62000bebb93adb'),
  NEXT_PUBLIC_API_URL: z
    .string()
    .default('https://api.yourhospital.com'),
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .default('DoctorCare'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Server-only schema — only validated in server/edge contexts
// ─────────────────────────────────────────────────────────────────────────────
const serverEnvSchema = z.object({
  /**
   * Server API key scoped strictly to storage.read and storage.write.
   * Never used for auth, databases, or user management.
   */
  APPWRITE_STORAGE_API_KEY: z
    .string()
    .default(''),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse and export
// ─────────────────────────────────────────────────────────────────────────────

function parsePublicEnv() {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_STORAGE_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_STORAGE_ID,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`[DoctorCare] Public environment variable validation failed:\n${issues}`);
  }

  return result.data;
}

function parseServerEnv() {
  // Guard: never run this in browser context
  if (typeof window !== 'undefined') {
    throw new Error('[DoctorCare] Server-only env accessed in browser context!');
  }

  const result = serverEnvSchema.safeParse({
    APPWRITE_STORAGE_API_KEY: process.env.APPWRITE_STORAGE_API_KEY,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`[DoctorCare] Server environment variable validation failed:\n${issues}`);
  }

  return result.data;
}

export const publicEnv = parsePublicEnv();

/** Server-only env — call only from edge route handlers, scripts, or server components */
export function getServerEnv() {
  return { ...publicEnv, ...parseServerEnv() };
}
