# AbhiTools Stability Audit

Last updated: 2026-09-05

This file tracks the low-risk smoothness/stability passes added after the feature-complete loan/payment work. The rule for these passes is: protect working financial behavior first, improve responsiveness second, and avoid large rewrites.

## Protected core scope

The following areas should not be rewritten during polish work unless a verified bug requires it:

- EMI/payment ledger rules
- UPI verification and UTR flow
- sequential EMI eligibility
- foreclosure / settlement closing
- recycle bin restore/purge behavior
- manual Loan ID create/edit behavior
- admin authentication boundary
- API financial write semantics

## Phase A — UI Smoothness

- PR: #9
- Main commit: `cf09c83450257fecfa0ebd266a39b16cd1c229f4`
- Added isolated UI motion/touch polish and mobile rendering-cost reductions.
- Financial/API logic changed: No.
- Production verification at merge: READY, 12/12 serverless functions, build errors 0, new runtime errors 0.

## Phase B — Frontend Performance

- PR: #10
- Main commit: `f53f68e91fcdfd6f67b4206b65f233d6e765e7a0`
- Debounced heavy search rendering and coalesced repeated in-flight refresh calls.
- Financial/API logic changed: No.
- Production verification at merge: READY, 12/12 functions, build errors 0, new runtime errors 0.

## Phase C — Server Smoothness

- PR: #11
- Main commit: `770685d0afaca3ccec4468ec45404760405ba0cf`
- Added warm-instance 60-second due-refresh cooldown and concurrent refresh coalescing.
- Loan/borrower/EMI/payment response data is not cached.
- Due/overdue calculation rules changed: No.
- Production live check: first `/api/due` request used `fresh`; immediate second request used `cooldown`, with due-refresh timing reduced to 0 ms on the repeated call.
- Production verification at merge: READY, 12/12 functions, build errors 0.

## Phase D — Network Resilience

- PR: #12
- Main commit: `4ee52737487722108e825101da91fb26b031c5ab`
- Service worker cache: `v9`.
- Same-origin `GET /api/*` reads get at most one retry for transient network failure or HTTP 408/502/503/504.
- Each read attempt has an 8-second timeout and a 350 ms retry delay.
- `POST`, `PUT`, `DELETE` are never auto-retried by this layer.
- API/auth/financial responses are still never cached by the service worker.
- Database migration: None.
- New serverless function: None.
- Production verification: READY, 12/12 functions, build errors 0.

## Phase E — Loading & Error UX

- PR: #13
- Main commit: `bdbda1a075fe700cf99bfea576082ee36370f315`
- The exact legacy read-failure alert (`Data load nahi hua. Internet check karein.`) is softened into a non-blocking status card with `Retry Sync` and `Dismiss`.
- All other alerts keep their original behavior.
- Last successful public/admin sync time is stored locally and shown when a later read sync fails.
- Existing screen data is intentionally left visible on sync failure; no stale financial response is newly cached by this layer.
- Retry uses the existing read-only `manualSync()` path, which is already protected by in-flight coalescing.
- Payment, UPI, foreclosure, settlement, save, delete, recycle and other financial write actions are not retried or modified.
- Service worker cache: `v10`.
- Database migration: None.
- New serverless function: None.
- Production verification: READY, 12/12 functions, build errors 0, new production error/fatal logs 0, live performance asset and service worker returned 200, `/api/due` returned 200.

## Phase F — Action / Modal / Mobile Polish

- PR: #14
- Main commit: `6c9d990f6266806d2714c8c285de1a6c6182bb3b`
- Clicked actions receive a short presentation-only press state; no button is disabled by this layer.
- If the existing application disables the clicked HTML button during its own async work, the polish layer adds temporary `aria-busy` + spinner feedback and removes it when the core re-enables the button (or after a short safety timeout).
- Dynamic loan/public/UPI/More overlays are detected only to apply a presentation-only body scroll lock while a sheet is open.
- Mobile blur is removed from the admin loan detail backdrop and public sync loader in addition to the already optimized overlays.
- Mobile sheet shadows are reduced slightly to lower paint cost without changing layout or controls.
- Service worker cache: `v11`.
- API/server/database/financial write files changed: No.
- Database migration: None.
- New serverless function: None.
- Production verification: READY, 12/12 functions, build errors 0, live `ui_performance.js` and service worker returned 200, `/api/due` returned 200, new Phase F runtime error/fatal logs 0.

## Final Stable Closeout — V2.3.3

- PR: #15
- Main release commit: `df8bed8198dbfed6c5c714f24de27c4b88402ebb`
- Branch: `release/final-stable-v2-3-3`
- Purpose: finish the remaining low-risk visual consistency work and align release metadata with the completed stability passes.
- Final mobile polish keeps the non-blocking sync notice inside phone safe areas and prevents dynamic sheet containers from creating accidental horizontal layout growth.
- Package and release metadata are aligned to `2.3.3` / `V2.3.3 Stable`.
- Backup format remains `v7`; no backup/import compatibility change is introduced.
- Service worker shell is V2.3.3 `v12` so installed PWAs receive the final stable assets.
- API/server/database/financial write files changed: No.
- EMI/payment/UPI/foreclosure/settlement/recycle/manual Loan ID behavior changed: No.
- Database migration: None.
- New serverless function: None.
- Production deployment: `dpl_DEsNpXjYdps7HQYLvBxobcZzcxiA` — READY.
- Production verification: 12/12 functions, errors-only build log clean, `version.json` returned `V2.3.3 Stable`, service worker returned V2.3.3 `v12`, and `/api/due` returned HTTP 200.
- Runtime verification: no new application error group was attributed to the V2.3.3 production deployment. The only grouped warning remains the pre-existing Node `DEP0169 url.parse()` warning, last seen on the previous Phase F production deployment.

## V2.4 — Security & Regression Hardening

- PR: #16
- Main release commit: `6b67fc86a1774110fa52fef74d75724907c0f14a`.
- Branch: `release/v2-4-hardening`.
- Release metadata: `V2.4 Stable`; package semver `2.4.0`; backup format remains `v7`.
- Database-level normalized unique UTR/reference index prevents the same UTR from being linked to multiple UPI payment requests, including concurrent submissions.
- `abhi_submit_upi_reference` keeps the existing pending/expiry checks and adds duplicate-reference rejection without changing payment confirmation semantics.
- Admin login receives Supabase-backed throttling: 5 failed attempts within a 10-minute window lock that client bucket for 10 minutes.
- The login bucket stores only a keyed HMAC fingerprint generated server-side; raw client IP is not persisted.
- Rate limiter is availability-safe: authentication continues through the existing credential path if the limiter RPC is temporarily unavailable, while the degraded protection is logged.
- Existing signed HttpOnly/Secure/SameSite=Strict admin session behavior remains unchanged.
- Added dependency-free Node stability tests and a GitHub Actions workflow; tests do not create, pay, settle, delete, or modify production loan records.
- Automated checks assert 12 API functions, GET-only service-worker retries, V2.4 metadata alignment, login rate-limit wiring, and migration guard presence.
- Supabase migration `v24_security_hardening` applied successfully on 2026-08-26.
- Pre-migration duplicate UTR audit returned zero duplicates.
- Rate-limit RPC was exercised with a synthetic 64-character test bucket through the lock threshold and then cleared; cleanup verified zero test rows remaining.
- PWA shell: V2.4 `v13`.
- Financial calculation rules changed: No.
- Public direct-data UX changed: No.
- EMI sequence, foreclosure, settlement, recycle and manual Loan ID behavior changed: No.
- New serverless function: No.
- GitHub Stability Checks: PASS.
- Vercel preview: READY, 12/12 functions, errors-only build log clean, `version.json` returned `V2.4 Stable`.
- Production deployment: `dpl_HUV3ktaKV6SpQjezzoWKc77z3iQo` — READY.
- Production verification: 12/12 functions, errors-only build log clean, `version.json` returned `V2.4 Stable`, service worker returned V2.4 `v13`, `/api/auth` unauthenticated GET returned expected HTTP 401 with `authenticated:false`, and `/api/due` returned HTTP 200.
- Runtime verification: no error/fatal logs were found for the V2.4 production deployment during the post-release check.

## Phase 11 — Modal / Form Consistency Polish (2026-09-05)

- Branch: `polish/phase-11-modal-form-consistency`.
- Scope is presentation-only and limited to the existing forms/secondary-screen CSS layer.
- Added consistent 4/8/12/16/24/32 spacing tokens scoped to the forms/secondary UI layer.
- Normalized focus rings, disabled-state presentation, close-button sizing/states, secondary-screen corner treatment, form/grid spacing, sticky action spacing, and dark-mode field surfaces.
- Mobile actionable controls remain at least approximately 44px tall; full-screen mobile secondary screens intentionally keep square viewport edges.
- Existing form IDs, classes, text, button handlers, JS behavior, API shapes, authentication boundary, and financial write behavior changed: No.
- API/server/database files changed: No.
- Database migration: None.
- New npm runtime dependency: None.
- New serverless function: None.
- Production deployment: `dpl_9UEYcTrW46mDJqzav7YfhKDgZB78` — READY, 12/12 functions, errors-only build log clean, live CSS and `/api/due` HTTP 200, no new error/fatal runtime logs observed.

## Phase 12 — Visual System Consolidation / Closeout (2026-09-05)

- Branch: `polish/phase-12-visual-system-closeout`.
- Purpose: bring the previously verified visual-only Phase 7–10 foundation onto the current `main` baseline without merging the old divergent work branch wholesale.
- Consolidates shared button/state tokens, the 4/8/12/16/24/32 spacing scale, shared focus/disabled tokens, 44px shell touch targets, tokenized More-panel spacing, and public loading of `ui_shell.css` before `style.css`.
- Consolidates the verified Home/Collections card-shadow, radius, and empty-state presentation pass.
- Phase 11 modal/form polish remains preserved on top of the shared token system.
- Existing Hindi/Hinglish labels, WhatsApp templates, element IDs/classes, form names, button handlers, and submitted data are unchanged.
- API/server/database/Supabase migration files changed: No.
- Financial/business logic, EMI/payment/UPI/sequential eligibility/foreclosure/settlement/recycle/manual Loan ID/auth behavior changed: No.
- New npm runtime dependency: None.
- New serverless function: None; Hobby function budget remains 12.
- Release label remains `V2.4 Stable`; only the `version.json` notes field is expanded to document this visual pass.
- Verification gate: GitHub Stability Checks, Vercel preview READY, errors-only build log clean, 12/12 functions, touched assets HTTP 200, `/api/due` HTTP 200, and no new error/fatal runtime logs before merge.

## Current known audit note

Vercel runtime diagnostics have reported an intermittent Node `DEP0169 url.parse()` deprecation warning on `/api/dashboard`, `/api/loans`, and `/api/borrowers`. Fresh repository code search on 2026-08-26 again found no direct `url.parse` usage, and the project has no runtime npm dependencies in `package.json`. No stable application code is being rewritten solely to chase this hosting/runtime warning.

This warning is treated as a hosting/runtime maintenance note, not a verified AbhiTools application failure.

## Stable-release decision

V2.4 has passed the database migration, automated checks, Vercel preview, production deployment and runtime verification and is now the designated stable baseline. Future changes should be limited to verified bug fixes, required maintenance, or explicitly requested features.

## Release verification checklist

Before a polish/release PR is merged:

1. Compare branch against `main` and confirm changed files match intended scope.
2. Confirm Vercel preview is READY and serverless count remains within Hobby limit (12).
3. Check errors-only build logs.
4. Run/confirm automated stability tests.
5. Verify any touched public endpoint or static runtime asset returns the expected status/shape.
6. Confirm no financial write route was unintentionally changed.
7. Merge only after PR is mergeable.
8. Verify production deployment READY and check recent runtime errors.
9. Record final production commit/deployment verification in the PR or this audit file.
