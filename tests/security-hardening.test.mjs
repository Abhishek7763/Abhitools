import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'test-only-secret';
const { getClientAddress, securityFingerprint } = await import('../server_shared.js');

const EXPECTED_API_FUNCTIONS = [
  'auth.js',
  'backup.js',
  'borrowers.js',
  'dashboard.js',
  'documents.js',
  'due.js',
  'import.js',
  'loans.js',
  'payments.js',
  'recycle.js',
  'settlements.js',
  'upload.js'
];

const DEAD_PUBLIC_DUES_FILES = ['ui_public_dues.js', 'ui_public_dues_compact.js'];
const RUNTIME_TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.yml', '.yaml']);

function runtimeTextFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...runtimeTextFiles(full));
    else if (RUNTIME_TEXT_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

test('client address uses only the first forwarded address', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } };
  assert.equal(getClientAddress(req), '203.0.113.7');
});

test('login fingerprint is deterministic and does not expose the raw address', () => {
  const raw = '203.0.113.7';
  const one = securityFingerprint('admin-login-ip', raw);
  const two = securityFingerprint('admin-login-ip', raw);
  assert.equal(one, two);
  assert.match(one, /^[a-f0-9]{64}$/);
  assert.equal(one.includes(raw), false);
});

test('service worker retries reads only and still bypasses non-GET writes', () => {
  const source = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(source, /if \(request\.method !== 'GET'\) return;/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /abhi-tools-shell-v2-4-stable-v18/);
});

test('UI spacing scale is centralized and More shell panel consumes it', () => {
  const source = fs.readFileSync(path.join(root, 'ui_shell.css'), 'utf8');
  const expected = [
    ['--ui-space-1', '4px'],
    ['--ui-space-2', '8px'],
    ['--ui-space-3', '12px'],
    ['--ui-space-4', '16px'],
    ['--ui-space-5', '24px'],
    ['--ui-space-6', '32px']
  ];
  for (const [token, value] of expected) {
    assert.match(source, new RegExp(`${token}:\\s*${value.replace('px', '\\px')}`));
  }
  assert.match(source, /\.ui-more-header\s*\{[\s\S]*?gap:\s*var\(--ui-space-3\);[\s\S]*?padding:\s*var\(--ui-space-4\) var\(--ui-space-4\) var\(--ui-space-3\);/);
  assert.match(source, /\.ui-more-content\s*\{[\s\S]*?padding:\s*var\(--ui-space-2\) var\(--ui-space-3\) var\(--ui-space-5\);/);
  assert.match(source, /\.ui-more-action\s*\{[\s\S]*?gap:\s*var\(--ui-space-2\);[\s\S]*?padding:\s*var\(--ui-space-2\) var\(--ui-space-3\);/);
});

test('Phase 9 interaction polish keeps shared tokens, focus rings, and 44px targets aligned', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'ui_shell.css'), 'utf8');
  const smooth = fs.readFileSync(path.join(root, 'ui_smoothness.css'), 'utf8');
  const forms = fs.readFileSync(path.join(root, 'ui_forms_secondary.css'), 'utf8');

  const shellLink = index.indexOf('<link rel="stylesheet" href="ui_shell.css">');
  const styleLink = index.indexOf('<link rel="stylesheet" href="style.css">');
  assert.ok(shellLink >= 0 && styleLink > shellLink, 'public page must load shared UI tokens before style.css');

  assert.match(shell, /--ui-focus-ring:/);
  assert.match(shell, /--ui-focus-border:\s*#2563eb;/);
  assert.match(shell, /--ui-disabled-opacity:\s*\.58;/);
  assert.match(shell, /body\.ui-shell-ready \.btn\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(shell, /\.ui-icon-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);

  assert.match(smooth, /button:disabled,[\s\S]*?\.btn:disabled\s*\{[\s\S]*?cursor:\s*not-allowed;[\s\S]*?var\(--ui-disabled-opacity, \.58\)/);
  assert.match(smooth, /outline:\s*3px solid var\(--ui-focus-ring/);
  assert.match(forms, /outline:\s*3px solid var\(--ui-focus-ring/);
  assert.match(forms, /\.ui-form-close-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(forms, /\.ui-secondary-screen \.btn,[\s\S]*?\.ui-secondary-screen button\s*\{[\s\S]*?min-height:\s*44px;/);
});

test('Phase 10 home and collections cards keep consistent surfaces and unchanged empty-state copy', () => {
  const css = fs.readFileSync(path.join(root, 'ui_home_collections.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'ui_home_collections.js'), 'utf8');

  assert.match(css, /\.ui-home-head\s*\{[\s\S]*?border-radius:\s*14px;/);
  assert.match(css, /\.ui-home-priority\s*\{[\s\S]*?border-radius:\s*12px;/);
  assert.match(css, /\.ui-collections-summary button\s*\{[\s\S]*?border-radius:\s*12px;/);
  assert.match(css, /\.ui-collection-row\s*\{[\s\S]*?border-radius:\s*12px;/);
  assert.match(css, /\.ui-home-empty,[\s\S]*?\.ui-collections-empty\s*\{[\s\S]*?min-height:\s*88px;[\s\S]*?border:\s*1px dashed[\s\S]*?border-radius:\s*12px;[\s\S]*?background:\s*var\(--ui-surface-2/);

  assert.match(js, /✓ No dated urgent\/upcoming item in the current priority feed\./);
  assert.match(js, /✓ No open Promise-to-Pay item in this view\./);
  assert.match(js, /✓ Is queue me koi dated EMI nahi hai\./);
});

test('dead public dues variants are absent and unreferenced across runtime sources', () => {
  for (const dead of DEAD_PUBLIC_DUES_FILES) {
    assert.equal(fs.existsSync(path.join(root, dead)), false, `${dead} should be deleted`);
  }

  const references = [];
  for (const file of runtimeTextFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const dead of DEAD_PUBLIC_DUES_FILES) {
      if (source.includes(dead)) references.push(`${path.relative(root, file)} -> ${dead}`);
    }
  }
  assert.deepEqual(references, []);

  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(indexSource, /<script src="ui_public_dues_final\.js"><\/script>/);
  assert.match(indexSource, /<script src="ui_paid_first\.js"><\/script>/);
  assert.equal(fs.existsSync(path.join(root, 'ui_public_dues_final.js')), true);

  const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  for (const dead of DEAD_PUBLIC_DUES_FILES) assert.equal(serviceWorker.includes(dead), false);
});

test('Vercel Hobby API function inventory remains the protected 12-file set', () => {
  const apiDir = path.join(root, 'api');
  const functions = fs.readdirSync(apiDir).filter(name => name.endsWith('.js')).sort();
  assert.equal(functions.length, 12);
  assert.deepEqual(functions, [...EXPECTED_API_FUNCTIONS].sort());
});

test('UPI public alias stays consolidated through dashboard without a 13th function', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rewrite = (config.rewrites || []).find(item => item?.source === '/api/upi-payments');
  assert.ok(rewrite, 'Expected /api/upi-payments rewrite is missing');
  assert.equal(rewrite.destination, '/api/dashboard?mode=upi-payments');
  assert.equal(fs.existsSync(path.join(root, 'api', 'upi-payments.js')), false);
});

test('fresh Supabase bootstrap stays foundational and does not duplicate financial RPC logic', () => {
  const source = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260823000000_bootstrap_core_schema.sql'), 'utf8');
  for (const table of ['borrowers', 'loans', 'emis', 'documents', 'activity_log']) {
    assert.match(source, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(source, /revoke all on table public\.borrowers from public, anon, authenticated/i);
  assert.match(source, /grant all on table public\.borrowers to service_role/i);
  assert.doesNotMatch(source, /create or replace function public\.abhi_add_emi_payment/i);
  assert.doesNotMatch(source, /create or replace function public\.abhi_settle_loan/i);
  assert.doesNotMatch(source, /create or replace function public\.abhi_start_upi_payment_request/i);
});

test('V2.4 migration contains duplicate UTR and DB-backed login guards', () => {
  const source = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826134000_v24_security_hardening.sql'), 'utf8');
  assert.match(source, /upi_payment_requests_user_reference_unique_idx/);
  assert.match(source, /upper\(trim\(user_reference\)\)/i);
  assert.match(source, /abhi_admin_login_rate_limit/);
  assert.match(source, /admin_login_rate_limits/);
  assert.match(source, /grant execute on function public\.abhi_admin_login_rate_limit\(text,text\) to service_role/i);
});

test('auth route uses rate limiter and Retry-After without changing session endpoints', () => {
  const source = fs.readFileSync(path.join(root, 'api', 'auth.js'), 'utf8');
  assert.match(source, /abhi_admin_login_rate_limit/);
  assert.match(source, /Retry-After/);
  assert.match(source, /req\.method === 'GET'/);
  assert.match(source, /req\.method === 'DELETE'/);
});

test('CSP scopes legacy inline allowances to attributes and login assets are external', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const globalHeaders = (config.headers || []).find(item => item?.source === '/(.*)')?.headers || [];
  const csp = globalHeaders.find(header => header?.key === 'Content-Security-Policy')?.value || '';

  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /script-src-elem 'self';/);
  assert.match(csp, /script-src-attr 'unsafe-inline';/);
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);

  assert.match(csp, /style-src 'self';/);
  assert.match(csp, /style-src-elem 'self';/);
  assert.match(csp, /style-src-attr 'unsafe-inline';/);
  assert.doesNotMatch(csp, /style-src [^;]*'unsafe-inline'/);

  const login = fs.readFileSync(path.join(root, 'advanced_admin_login_panel.html'), 'utf8');
  assert.doesNotMatch(login, /<style[\s>]/i);
  assert.doesNotMatch(login, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(login, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(login, /\sstyle\s*=/i);
  assert.match(login, /<link rel="stylesheet" href="admin_login\.css">/);
  assert.match(login, /<script src="admin_login\.js"><\/script>/);
  assert.equal(fs.existsSync(path.join(root, 'admin_login.css')), true);
  assert.equal(fs.existsSync(path.join(root, 'admin_login.js')), true);
});

test('release metadata and package version are aligned to V2.4', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(version.release, '2.4');
  assert.equal(version.label, 'V2.4 Stable');
  assert.equal(version.backup_format_version, 7);
  assert.equal(pkg.version, '2.4.0');
});
