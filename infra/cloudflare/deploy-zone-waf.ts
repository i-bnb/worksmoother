/**
 * Cloudflare Pro Zone WAF & OWASP Core Rulesets + Layer 1 Rate Limiting Provisioning Script
 * Applies the Managed WAF Rulesets and Zone Rate Limiting Rulesets to zone 'yourhospital.com' targeting 'api.yourhospital.com'.
 */

import * as fs from 'fs';
import * as path from 'path';

interface CloudflareManagedRulesetPayload {
  rules: Array<{
    action: string;
    expression: string;
    description: string;
    action_parameters: {
      id: string;
      overrides?: Record<string, unknown>;
      score_threshold?: number;
    };
  }>;
}

interface CloudflareRateLimitRulesetPayload {
  rules: Array<{
    action: string;
    expression: string;
    description: string;
    ratelimit: {
      characteristics: string[];
      period: number;
      requests_per_period: number;
      mitigation_timeout: number;
    };
  }>;
}

export async function deployZoneWAF() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  console.log('--- Cloudflare Pro Zone WAF, OWASP & Layer 1 Rate Limiting Provisioning ---');
  console.log('Target Custom Domain: api.yourhospital.com');
  console.log('Target Zone: yourhospital.com (Pro Plan)');

  const configPath = path.resolve(__dirname, 'waf-rulesets.json');
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(rawConfig);

  const managedRules = config.rulesets || [];
  const rateLimitRules = config.rate_limiting_rules || [];

  if (!apiToken || !zoneId) {
    console.warn('\n[!] Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID in environment.');
    console.log('[*] Validating WAF Rulesets & Rate Limiting declarative configuration file...');
    console.log(`[+] Found ${managedRules.length} Managed WAF / OWASP ruleset definitions:`);
    for (const rs of managedRules) {
      console.log(`    - ${rs.name}: target=${rs.action_parameters.id} on (${rs.expression})`);
    }

    console.log(`[+] Found ${rateLimitRules.length} Zone WAF Layer 1 Rate Limiting rule definitions:`);
    for (const rl of rateLimitRules) {
      console.log(`    - ${rl.name}: ${rl.ratelimit.requests_per_period} req/${rl.ratelimit.period}s [${rl.ratelimit.characteristics.join(', ')}] on (${rl.expression})`);
    }

    console.log('\n[INFO] To deploy directly to Cloudflare, provide:');
    console.log('  export CLOUDFLARE_API_TOKEN="<your-api-token>"');
    console.log('  export CLOUDFLARE_ZONE_ID="<your-zone-id>"');
    console.log('  npm run infra:waf');
    return;
  }

  // 1. Deploy Managed WAF Rulesets (http_request_firewall_managed)
  const managedUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`;
  const managedPayload: CloudflareManagedRulesetPayload = {
    rules: managedRules.map((r: any) => ({
      action: r.action,
      expression: r.expression,
      description: r.description,
      action_parameters: r.action_parameters,
    })),
  };

  console.log(`[*] Updating managed ruleset entrypoint for zone ${zoneId}...`);
  const managedRes = await fetch(managedUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(managedPayload),
  });

  const managedJson = (await managedRes.json()) as any;
  if (!managedRes.ok || !managedJson.success) {
    console.error('[ERROR] Failed to deploy Managed WAF rulesets:', JSON.stringify(managedJson, null, 2));
    process.exit(1);
  }
  console.log('[SUCCESS] Successfully enabled Cloudflare Managed WAF & OWASP Core Rulesets!');

  // 2. Deploy Zone Rate Limiting Rules (http_ratelimit)
  const rateLimitUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`;
  const rateLimitPayload: CloudflareRateLimitRulesetPayload = {
    rules: rateLimitRules.map((r: any) => ({
      action: r.action,
      expression: r.expression,
      description: r.description,
      ratelimit: r.ratelimit,
    })),
  };

  console.log(`[*] Updating Layer 1 rate limiting entrypoint for zone ${zoneId}...`);
  const rlRes = await fetch(rateLimitUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rateLimitPayload),
  });

  const rlJson = (await rlRes.json()) as any;
  if (!rlRes.ok || !rlJson.success) {
    console.error('[ERROR] Failed to deploy Zone Rate Limiting rulesets:', JSON.stringify(rlJson, null, 2));
    process.exit(1);
  }
  console.log('[SUCCESS] Successfully deployed Cloudflare Zone WAF Layer 1 Rate Limiting Rules!');
}

deployZoneWAF().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
