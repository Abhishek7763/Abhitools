import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'test-only-secret';
const { getClientAddress, securityFingerprint } = await import('../server_shared.js');

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
  assert.match(source, /abhi-tools-shell-v2-4-stable-v13/);
});

test('Vercel Hobby API function count remains exactly 12', () => {
  const apiDir = path.join(root, 'api');
  const functions = fs.readdirSync(apiDir).filter(name => name.endsWith('.js'));
  assert.equal(functions.length, 12);
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

test('release metadata and package version are aligned to V2.4', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(version.release, '2.4');
  assert.equal(version.label, 'V2.4 Stable');
  assert.equal(version.backup_format_version, 7);
  assert.equal(pkg.version, '2.4.0');
});
