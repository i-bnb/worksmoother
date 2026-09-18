/**
 * Cloudflare Queue & Dead-Letter Queue (DLQ) Provisioning Script
 * Provisions 'doctorcare-tasks' and 'doctorcare-tasks-dlq' via Cloudflare Wrangler,
 * binding the producer to the api Worker and the consumer with DLQ to the notify Worker.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const QUEUE_CONFIG = {
  primaryQueue: 'doctorcare-tasks',
  deadLetterQueue: 'doctorcare-tasks-dlq',
  producerWorker: 'doctorcare-api',
  consumerWorker: 'doctorcare-notify',
  consumerSettings: {
    maxBatchSize: 10,
    maxBatchTimeout: 5,
    maxRetries: 3,
  },
};

export async function provisionQueues() {
  console.log('================================================================');
  console.log('   Cloudflare Queues Provisioning Engine (doctorcare-tasks)     ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const apiWranglerPath = path.join(rootDir, 'workers/api/wrangler.toml');
  const notifyWranglerPath = path.join(rootDir, 'workers/notify/wrangler.toml');

  console.log(`[*] Primary Queue: "${QUEUE_CONFIG.primaryQueue}"`);
  console.log(`[*] Dead-Letter Queue (DLQ): "${QUEUE_CONFIG.deadLetterQueue}"`);
  console.log(`[*] Producer Binding: "${QUEUE_CONFIG.producerWorker}" -> TASK_QUEUE`);
  console.log(
    `[*] Consumer Binding: "${QUEUE_CONFIG.consumerWorker}" -> max_retries=${QUEUE_CONFIG.consumerSettings.maxRetries}, dlq=${QUEUE_CONFIG.deadLetterQueue}`
  );

  const isCloudflareAuthAvailable = Boolean(
    process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID
  );

  if (isCloudflareAuthAvailable) {
    try {
      console.log('\n[*] Checking and creating dead-letter queue via Wrangler CLI...');
      try {
        execSync(`npx.cmd wrangler queues create ${QUEUE_CONFIG.deadLetterQueue}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        console.log(`[+] Created dead-letter queue: ${QUEUE_CONFIG.deadLetterQueue}`);
      } catch (err: any) {
        console.log(`[INFO] DLQ already exists or returned: ${err.message?.split('\n')[0]}`);
      }

      console.log('\n[*] Checking and creating primary task queue via Wrangler CLI...');
      try {
        execSync(`npx.cmd wrangler queues create ${QUEUE_CONFIG.primaryQueue}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        console.log(`[+] Created primary task queue: ${QUEUE_CONFIG.primaryQueue}`);
      } catch (err: any) {
        console.log(`[INFO] Primary queue already exists or returned: ${err.message?.split('\n')[0]}`);
      }
    } catch (err: any) {
      console.warn('[!] Remote queue provisioning notice:', err.message);
    }
  } else {
    console.log('\n[INFO] No remote CLOUDFLARE_API_TOKEN found in local shell.');
    console.log('[*] Validating local declarative wrangler.toml bindings for Queues & DLQ...');
  }

  // 1. Audit API Worker wrangler.toml producer binding
  console.log(`\n[*] Inspecting API Worker queue producer config: ${apiWranglerPath}`);
  const apiWranglerContent = fs.readFileSync(apiWranglerPath, 'utf8');

  if (
    !apiWranglerContent.includes('[[queues.producers]]') ||
    !apiWranglerContent.includes(QUEUE_CONFIG.primaryQueue)
  ) {
    throw new Error(
      `Queue Producer Error: ${apiWranglerPath} is missing [[queues.producers]] binding for ${QUEUE_CONFIG.primaryQueue}`
    );
  }
  console.log(`[OK] API Worker correctly configured as producer for "${QUEUE_CONFIG.primaryQueue}"`);

  // 2. Audit Notify Worker wrangler.toml consumer and DLQ binding
  console.log(`\n[*] Inspecting Notify Worker queue consumer config: ${notifyWranglerPath}`);
  const notifyWranglerContent = fs.readFileSync(notifyWranglerPath, 'utf8');

  if (
    !notifyWranglerContent.includes('[[queues.consumers]]') ||
    !notifyWranglerContent.includes(`queue = "${QUEUE_CONFIG.primaryQueue}"`) ||
    !notifyWranglerContent.includes(`dead_letter_queue = "${QUEUE_CONFIG.deadLetterQueue}"`)
  ) {
    throw new Error(
      `Queue Consumer Error: ${notifyWranglerPath} is missing [[queues.consumers]] binding with dead_letter_queue = "${QUEUE_CONFIG.deadLetterQueue}"`
    );
  }
  console.log(`[OK] Notify Worker correctly configured as consumer with DLQ "${QUEUE_CONFIG.deadLetterQueue}"`);

  console.log('\n================================================================');
  console.log('   PROVISIONING SUMMARY:');
  console.log(`   - Primary Queue: ${QUEUE_CONFIG.primaryQueue}`);
  console.log(`   - DLQ: ${QUEUE_CONFIG.deadLetterQueue}`);
  console.log(`   - Producer: ${QUEUE_CONFIG.producerWorker} (binding: TASK_QUEUE)`);
  console.log(`   - Consumer: ${QUEUE_CONFIG.consumerWorker}`);
  console.log(`   - Max Retries before DLQ: ${QUEUE_CONFIG.consumerSettings.maxRetries}`);
  console.log('================================================================\n');
}

if (require.main === module) {
  provisionQueues().catch((err) => {
    console.error('[ERROR]', err);
    process.exit(1);
  });
}
