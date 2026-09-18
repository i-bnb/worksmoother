/**
 * Cloudflare Pro Zone WAF & OWASP Core Rulesets Provisioning Script
 * Applies the Managed WAF Rulesets to zone 'yourhospital.com' targeting 'api.yourhospital.com'.
 */

import * as fs from 'fs';
import * as path from 'path';

interface CloudflareRulesetPayload {
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

async function deployZoneWAF() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  console.log('--- Cloudflare Pro Zone WAF & OWASP Core Ruleset Provisioning ---');
  console.log('Target Custom Domain: api.yourhospital.com');
  console.log('Target Zone: yourhospital.com (Pro Plan)');

  const configPath = path.resolve(__dirname, 'waf-rulesets.json');
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(rawConfig);

  if (!apiToken || !zoneId) {
    console.warn('\n[!] Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID in environment.');
    console.log('[*] Validating WAF Rulesets declarative configuration file...');
    console.log(`[+] Found ${config.rulesets.length} ruleset definitions:`);
    for (const rs of config.rulesets) {
      console.log(`    - ${rs.name}: target=${rs.action_parameters.id} on (${rs.expression})`);
    }
    console.log('\n[INFO] To deploy directly to Cloudflare, provide:');
    console.log('  export CLOUDFLARE_API_TOKEN="<your-api-token>"');
    console.log('  export CLOUDFLARE_ZONE_ID="<your-zone-id>"');
    console.log('  npm run infra:waf');
    return;
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`;

  const payload: CloudflareRulesetPayload = {
    rules: config.rulesets.map((r: any) => ({
      action: r.action,
      expression: r.expression,
      description: r.description,
      action_parameters: r.action_parameters,
    })),
  };

  console.log(`[*] Updating ruleset entrypoint for zone ${zoneId}...`);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const resJson = (await response.json()) as any;
  if (!response.ok || !resJson.success) {
    console.error('[ERROR] Failed to deploy WAF rulesets:', JSON.stringify(resJson, null, 2));
    process.exit(1);
  }

  console.log('[SUCCESS] Successfully enabled Cloudflare Managed WAF & OWASP Core Rulesets for api.yourhospital.com!');
}

deployZoneWAF().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
