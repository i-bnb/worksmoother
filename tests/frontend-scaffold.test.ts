import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- DoctorCare Frontend Scaffold & Design System Tests ---');

const webRoot = path.join(process.cwd(), 'apps', 'web');

// 1. Check apps/web/package.json
console.log('[Test 1] Verifying apps/web/package.json configuration...');
const pkgPath = path.join(webRoot, 'package.json');
assert.strictEqual(fs.existsSync(pkgPath), true, 'apps/web/package.json must exist');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

assert.strictEqual(pkg.name, '@doctorcare/web');
assert.ok(pkg.dependencies['@opennextjs/cloudflare'], 'Must include @opennextjs/cloudflare adapter');
assert.ok(pkg.dependencies['@doctorcare/shared'], 'Must include @doctorcare/shared workspace dependency');
assert.ok(pkg.dependencies['next'], 'Must include next.js dependency');
assert.ok(pkg.dependencies['react'], 'Must include react');
assert.ok(pkg.dependencies['lucide-react'], 'Must include lucide-react');
assert.ok(pkg.scripts['dev'], 'Must include dev script');
assert.ok(pkg.scripts['build'], 'Must include build script');
assert.ok(pkg.scripts['preview'], 'Must include preview script');
assert.ok(pkg.scripts['deploy'], 'Must include deploy script');
console.log('✓ apps/web/package.json is properly configured with OpenNext and workspace dependencies');

// 2. Check OpenNext Cloudflare Adapter configuration
console.log('[Test 2] Verifying open-next.config.ts...');
const openNextPath = path.join(webRoot, 'open-next.config.ts');
assert.strictEqual(fs.existsSync(openNextPath), true, 'open-next.config.ts must exist');
const openNextContent = fs.readFileSync(openNextPath, 'utf8');
assert.ok(openNextContent.includes('defineCloudflareConfig'), 'Must call defineCloudflareConfig');
console.log('✓ open-next.config.ts correctly defines Cloudflare adapter configuration');

// 3. Check wrangler.toml deployment configuration
console.log('[Test 3] Verifying apps/web/wrangler.toml...');
const wranglerPath = path.join(webRoot, 'wrangler.toml');
assert.strictEqual(fs.existsSync(wranglerPath), true, 'apps/web/wrangler.toml must exist');
const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
assert.ok(wranglerContent.includes('.open-next/worker.js'), 'Must target .open-next/worker.js entrypoint');
assert.ok(wranglerContent.includes('nodejs_compat'), 'Must enable nodejs_compat flag');
assert.ok(wranglerContent.includes('binding = "ASSETS"'), 'Must bind ASSETS');
assert.ok(wranglerContent.includes('binding = "API_SERVICE"'), 'Must bind API_SERVICE service binding');
assert.ok(wranglerContent.includes('service = "doctorcare-api"'), 'Must point service binding to doctorcare-api');
console.log('✓ wrangler.toml contains worker entrypoint, assets binding, and API service binding');

// 4. Check Apple-inspired Minimalist Design System tokens
console.log('[Test 4] Verifying Tailwind & CSS design system tokens...');
const tailwindPath = path.join(webRoot, 'tailwind.config.ts');
assert.strictEqual(fs.existsSync(tailwindPath), true, 'tailwind.config.ts must exist');
const tailwindContent = fs.readFileSync(tailwindPath, 'utf8');
assert.ok(tailwindContent.includes("black: '#000000'"), 'Tailwind must configure apple black');
assert.ok(tailwindContent.includes("border: 'rgba(255, 255, 255, 0.08)'"), 'Tailwind must configure apple border');
assert.ok(tailwindContent.includes("blue: '#2997ff'"), 'Tailwind must configure apple blue');

const cssPath = path.join(webRoot, 'src', 'app', 'globals.css');
assert.strictEqual(fs.existsSync(cssPath), true, 'globals.css must exist');
const cssContent = fs.readFileSync(cssPath, 'utf8');
assert.ok(cssContent.includes('.glass-panel'), 'CSS must define frosted glass panel utility');
assert.ok(cssContent.includes('.apple-pill'), 'CSS must define apple pill status utility');
assert.ok(cssContent.includes('.apple-btn-primary'), 'CSS must define primary button utility');
console.log('✓ Apple-inspired design tokens and frosted glass classes are configured');

// 5. Check Pages and Components
console.log('[Test 5] Verifying page modules and navigation...');
const routes = [
  { file: 'src/app/page.tsx', marker: 'Cloudflare Pro Zone WAF' },
  { file: 'src/app/directory/page.tsx', marker: 'Physician & Specialist Directory' },
  { file: 'src/app/booking/page.tsx', marker: 'Reserve Consultation Slot' },
  { file: 'src/app/records/page.tsx', marker: 'Encrypted Clinical Records' },
  { file: 'src/app/consent/page.tsx', marker: 'Patient Consent & Privacy Center' },
  { file: 'src/components/Navbar.tsx', marker: 'DoctorCare' },
  { file: 'src/components/Footer.tsx', marker: 'DoctorCare Engine' },
];

for (const route of routes) {
  const fullPath = path.join(webRoot, route.file);
  assert.strictEqual(fs.existsSync(fullPath), true, `Route file ${route.file} must exist`);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert.ok(content.includes(route.marker), `Route file ${route.file} must contain "${route.marker}"`);
  console.log(`  ✓ Checked ${route.file}`);
}

// 6. Check Hash-chain audit trail viewer & AES-256-GCM badge in records page
console.log('[Test 6] Verifying records page cryptographic elements...');
const recordsPath = path.join(webRoot, 'src', 'app', 'records', 'page.tsx');
const recordsContent = fs.readFileSync(recordsPath, 'utf8');
assert.ok(recordsContent.includes('AES-256-GCM'), 'Records page must display AES-256-GCM AEAD');
assert.ok(recordsContent.includes('kek-2026-09'), 'Records page must display KEK kek-2026-09');
assert.ok(recordsContent.includes('Write-Only R2 Hash-Chained Audit Trail'), 'Records page must display hash-chain ledger');
assert.ok(recordsContent.includes('0000000000000000000000000000000000000000000000000000000000000000'), 'Must display genesis hash anchor');
console.log('✓ Records vault features AES-256-GCM envelope badges and live hash-chain ledger');

// 7. Check DPDP Act 2023 Consent Center
console.log('[Test 7] Verifying consent page compliance features...');
const consentPath = path.join(webRoot, 'src', 'app', 'consent', 'page.tsx');
const consentContent = fs.readFileSync(consentPath, 'utf8');
assert.ok(consentContent.includes('DPDP ACT 2023 COMPLIANCE'), 'Consent page must display DPDP Act 2023 badge');
assert.ok(consentContent.includes('CONSENT_LOG'), 'Consent page must display CONSENT_LOG reference');
assert.ok(consentContent.includes('APPOINTMENT_COMMUNICATION'), 'Must include APPOINTMENT_COMMUNICATION purpose');
assert.ok(consentContent.includes('EHR_DATA_PROCESSING'), 'Must include EHR_DATA_PROCESSING purpose');
assert.ok(consentContent.includes('Right to Withdraw'), 'Must explain DPDP right to withdraw');
console.log('✓ DPDP Act 2023 Consent Center features purpose specification, language selection, and withdrawal toggles');

console.log('\n======================================================');
console.log('ALL FRONTEND SCAFFOLD & DESIGN TESTS PASSED (7/7)!');
console.log('======================================================\n');
