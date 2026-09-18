/**
 * scripts/check-appwrite-connectivity.ts
 *
 * Connectivity and handshake verification for both Appwrite projects.
 * Validates env vars via Zod, then pings Project A and Project B.
 *
 * Usage:
 *   cd apps/web
 *   npx tsx scripts/check-appwrite-connectivity.ts
 */

import { Client, Health } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Zod env validation ────────────────────────────────────────────────────
const envSchema = z.object({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: z.string().url(),
  NEXT_PUBLIC_APPWRITE_PROJECT_A_ID: z.string().min(1),
  APPWRITE_PROJECT_A_API_KEY: z.string().min(1),
  APPWRITE_PROJECT_B_ID: z.string().min(1),
  APPWRITE_PROJECT_B_API_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
  NEXT_PUBLIC_APPWRITE_PROJECT_A_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID,
  APPWRITE_PROJECT_A_API_KEY: process.env.APPWRITE_PROJECT_A_API_KEY,
  APPWRITE_PROJECT_B_ID: process.env.APPWRITE_PROJECT_B_ID,
  APPWRITE_PROJECT_B_API_KEY: process.env.APPWRITE_PROJECT_B_API_KEY,
});

if (!envResult.success) {
  console.error('\n❌  Environment validation failed:');
  envResult.error.issues.forEach((i) => {
    console.error(`   • ${i.path.join('.')}: ${i.message}`);
  });
  console.error('\n   Please fill in apps/web/.env.local (copy from .env.example)');
  process.exit(1);
}

const env = envResult.data;

// ─── Helpers ───────────────────────────────────────────────────────────────
function makeClient(projectId: string, apiKey: string): Client {
  return new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(projectId)
    .setKey(apiKey);
}

async function checkProject(
  label: string,
  projectId: string,
  apiKey: string
): Promise<boolean> {
  process.stdout.write(`  Pinging ${label} (${projectId})... `);
  try {
    const health = new Health(makeClient(projectId, apiKey));
    const status = await health.get();
    console.log(`✓  status=${status.status}  ping=${status.ping}ms`);
    return true;
  } catch (err: any) {
    const code = err?.code ?? '—';
    const msg = err?.message ?? String(err);
    console.log(`✗  [${code}] ${msg}`);
    return false;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DoctorCare — Appwrite Connectivity Check');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Endpoint : ${env.NEXT_PUBLIC_APPWRITE_ENDPOINT}`);
  console.log('');

  const a = await checkProject('Project A (Operational)', env.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID, env.APPWRITE_PROJECT_A_API_KEY);
  const b = await checkProject('Project B (PHI Records)', env.APPWRITE_PROJECT_B_ID, env.APPWRITE_PROJECT_B_API_KEY);

  console.log('');
  if (a && b) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✅  Both Appwrite projects are reachable!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    process.exit(0);
  } else {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ❌  One or more Appwrite projects failed the ping check.');
    console.log('      Verify your API keys and project IDs in .env.local.');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    process.exit(1);
  }
}

main();
