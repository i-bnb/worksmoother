/**
 * =============================================================================
 * Security Test Helpers & Client Fixtures
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

export const DEMO_COMPANY_A = '11111111-1111-1111-1111-111111111111';
export const DEMO_COMPANY_B = '99999999-9999-9999-9999-999999999999';
export const DEMO_BRANCH_DXB = '22222222-2222-2222-2222-222222222221';
export const DEMO_BRANCH_AUH = '22222222-2222-2222-2222-222222222222';

export const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || 'DevPassword123!';

/**
 * Returns an unauthenticated Supabase client (Anon role)
 */
export function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns a privileged admin client bypassing RLS (for test setup and verification)
 */
export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Signs in as a specific user and returns an authenticated client bound to that user's session
 */
export async function getAuthenticatedClient(email: string, password = SEED_PASSWORD): Promise<{
  client: SupabaseClient;
  user: any;
}> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
  }

  return { client, user: data.user };
}
