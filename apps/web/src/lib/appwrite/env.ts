import { z } from 'zod';

/**
 * Centralised, Zod-validated environment configuration for the DoctorCare web app.
 *
 * – NEXT_PUBLIC_* vars are available in both browser and server contexts.
 * – Server-only vars (without NEXT_PUBLIC_) are validated only when this module
 *   is imported from a server/edge context (route handlers, scripts).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public schema — safe to access client-side
// ─────────────────────────────────────────────────────────────────────────────
const publicEnvSchema = z.object({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: z
    .string()
    .url('NEXT_PUBLIC_APPWRITE_ENDPOINT must be a valid URL')
    .default('https://cloud.appwrite.io/v1'),
  NEXT_PUBLIC_APPWRITE_PROJECT_A_ID: z
    .string()
    .min(1, 'NEXT_PUBLIC_APPWRITE_PROJECT_A_ID is required'),
  NEXT_PUBLIC_API_URL: z
    .string()
    .url('NEXT_PUBLIC_API_URL must be a valid URL')
    .default('http://127.0.0.1:8787'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Server-only schema — only validated in server/edge contexts
// ─────────────────────────────────────────────────────────────────────────────
const serverEnvSchema = z.object({
  APPWRITE_PROJECT_A_API_KEY: z
    .string()
    .min(1, 'APPWRITE_PROJECT_A_API_KEY is required for server operations'),
  APPWRITE_PROJECT_B_ID: z
    .string()
    .min(1, 'APPWRITE_PROJECT_B_ID is required for PHI operations'),
  APPWRITE_PROJECT_B_API_KEY: z
    .string()
    .min(1, 'APPWRITE_PROJECT_B_API_KEY is required for PHI operations'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse and export
// ─────────────────────────────────────────────────────────────────────────────

function parsePublicEnv() {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_A_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID,
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
    APPWRITE_PROJECT_A_API_KEY: process.env.APPWRITE_PROJECT_A_API_KEY,
    APPWRITE_PROJECT_B_ID: process.env.APPWRITE_PROJECT_B_ID,
    APPWRITE_PROJECT_B_API_KEY: process.env.APPWRITE_PROJECT_B_API_KEY,
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
