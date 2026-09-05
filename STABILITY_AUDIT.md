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

## Improvement Pass Phase 0 — Baseline Freeze & Reconciliation (2026-08-29)

- Improvement branch: `improve/abhitools-safe-polish`.
- Frozen from current `main` HEAD `429b445411c994605dfefc9f740820aa1fb66004` (`Harden paid-first observer against repeat mutations`).
- The documented V2.4 release commit is `6b67fc86a1774110fa52fef74d75724907c0f14a`; current `main` is 12 commits ahead and 0 commits behind that release baseline.
- Post-V2.4 file delta is limited to `STABILITY_AUDIT.md`, `index.html`, `ui_paid_first.js`, `ui_public_dues.js`, `ui_public_dues_compact.js`, and `ui_public_dues_final.js`.
- No post-V2.4 delta exists in `/api`, `/server_routes`, `/supabase/migrations`, or `server_shared.js`; the later changes are therefore treated as the protected current public-UI baseline for this improvement pass.
- Current `index.html` loads `ui_public_dues_final.js` and `ui_paid_first.js`; these current behaviors must be preserved unless a later phase explicitly and safely replaces presentation-only code.
- Existing GitHub `Stability Checks` run for the exact frozen HEAD completed successfully on Node 24; the `Run stability tests` step passed.
- `/api` contains exactly 12 JavaScript serverless functions at the frozen branch baseline.
- Vercel production deployment `dpl_5FWDcCWN89toGZ2rvHT3S1ARoMg2` is READY on the same frozen HEAD and reports 12 Node.js functions; its errors-only build log is clean.
- Live static baseline check returned `V2.4 Stable` from `version.json` and service-worker cache `abhi-tools-shell-v2-4-stable-v13`.
- No application/API/business logic, service worker, dependency, security control, database schema, migration, or Supabase data was changed in Phase 0.
- No Supabase write/test data was created in Phase 0.
- No Vercel deployment command was run by this pass, and no `vercel --prod`, production promotion, or merge to `main` was performed.
- The branch was created specifically so every later phase can remain incremental, independently revertible, preview-only, and manually reviewed before the next phase.

## Recovery setup before Phase 1 — Fresh Supabase rebuild (2026-08-29)

- The previous AbhiTools Supabase project was no longer available, so the user explicitly requested a fresh AbhiTools Supabase setup and planned to re-enter financial records manually.
- New Supabase project ref: `bveseaobfkbrtczzfsds` (`Abhitools`).
- Added `20260823000000_bootstrap_core_schema.sql` on the improvement branch to make the previously untracked foundational schema reproducible for a brand-new Supabase project.
- The bootstrap intentionally creates only foundational tables/views/storage/RLS/service-role access and does not reimplement EMI payment, settlement, sequential UPI, UTR, recycle, or other protected financial RPC logic.
- Existing tracked migrations were then applied in order to the fresh project, including V2.4 duplicate-UTR and DB-backed admin-login throttling hardening.
- A duplicate bootstrap activity-log index detected by Supabase Performance Advisor was removed with `20260829143000_remove_duplicate_activity_index.sql`; no stored financial data or business rule changed.
- Fresh financial row counts were verified at zero for borrowers, loans, EMIs, payments, settlements, documents, recycle items, follow-ups and UPI requests; only intentional default settings/config rows existed.
- Security verification confirmed RLS on protected tables, no direct anon/authenticated table privileges in the checked protected set, and no anon/authenticated execution privilege on checked `abhi_*` functions.
- The V2.4 rate-limit RPC was tested with one synthetic 64-character bucket, reached the expected five-failure lock threshold, was cleared immediately, and cleanup verified zero synthetic rate-limit rows remaining.
- The user updated Vercel Supabase environment variables and performed a production redeploy themselves. Post-redeploy checks returned HTTP 200 for `/api/due`, `/api/loans`, `/api/dashboard`, `/api/borrowers` and `/api/upi-payments`; the old deleted-project `ENOTFOUND` failure was no longer present on the new deployment.
- This recovery work was explicitly requested outside the normal polish phases; it did not authorize future production merges/promotions.

## Improvement Pass Phase 1 — Safety & Regression Guard (2026-08-29)

- Scope is test/audit/CI only: `tests/security-hardening.test.mjs`, `.github/workflows/stability-checks.yml`, and this audit file.
- No application, API implementation, CSS, client JS, service worker, financial formula, or database migration is modified by Phase 1.
- Existing 12-function count guard is strengthened to require the exact protected API filename inventory, preventing a required function from being silently replaced while the count remains 12.
- Added a guard that `/api/upi-payments` remains a Vercel rewrite to `/api/dashboard?mode=upi-payments` and that no thirteenth `api/upi-payments.js` function appears.
- Added a fresh-Supabase bootstrap guard requiring the five foundational core tables, RLS enablement, service-role-only borrower access, and absence of duplicated protected payment/settlement/UPI RPC definitions in the bootstrap migration.
- Existing guards for GET-only service-worker retries, V2.4 UTR uniqueness/rate-limit wiring, auth route shape, session endpoints and V2.4 release metadata remain intact.
- `Stability Checks` is extended to run on `improve/**` pushes as well as `main` and pull requests, so every subsequent improvement-phase push gets the same Node 24 `npm test` gate.
- Dependency added: None.
- Service worker/precache asset changed: No; cache remains `abhi-tools-shell-v2-4-stable-v13` and no cache bump is required in this phase.
- Supabase data write/test data created in Phase 1: None.
- Financial/business logic changed: No.
- API function implementation changed: No.
- Production merge/promotion/deploy performed by Phase 1: No.

## Improvement Pass Phase 2 — Dead Public Dues Cleanup (2026-08-29)

- Remove only the two superseded public-dues variants: `ui_public_dues.js` and `ui_public_dues_compact.js`.
- Preserve the current protected public UI path: `index.html` continues to load `ui_public_dues_final.js` followed by `ui_paid_first.js`.
- GitHub code search reported incomplete indexing, so deletion safety is enforced by a full-checkout Node regression test that recursively scans runtime `.html`, `.js`, `.css`, `.json`, `.yml`, and `.yaml` files for references to either deleted filename; the phase is considered valid only if that scan passes in Stability Checks.
- The same test requires both dead files to be absent, `ui_public_dues_final.js` to remain present, and the service-worker shell to contain neither deleted filename.
- Service-worker cache is bumped from `abhi-tools-shell-v2-4-stable-v13` to `abhi-tools-shell-v2-4-stable-v14` for this cleanup phase, per the explicit cache-discipline rule. The precache list already did not contain either dead file, so no live precache asset entry is removed; the list is explicitly re-verified by tests.
- No financial calculation, payment ledger, sequential EMI, UPI/UTR, settlement/foreclosure, recycle, Loan ID, auth, API route, or database behavior is changed.
- API/server/Supabase migration files changed: No.
- Dependency added: None.
- Supabase data write/test data created in Phase 2: None.
- Production merge/promotion/deploy authorized by this phase: No.

## Improvement Pass Phase 3 — CSP Narrowing & Login Asset Extraction (2026-08-30)

- Scope: `vercel.json`, `advanced_admin_login_panel.html`, new `admin_login.css`, new `admin_login.js`, `tests/security-hardening.test.mjs`, and this audit file.
- The admin login page's inline `<style>` and inline `<script>` blocks were moved into same-origin external assets. Its inline form submit and password-toggle event attributes were replaced by `addEventListener`, preserving the existing login flow and user-facing text.
- Broad CSP allowances were narrowed from `script-src 'self' 'unsafe-inline'` / `style-src 'self' 'unsafe-inline'` to `script-src 'self'` + `script-src-elem 'self'` and `style-src 'self'` + `style-src-elem 'self'`.
- Existing legacy inline event handlers and `style=""` attributes in `index.html` and `admin.html` remain the known blocker to full inline removal. Compatibility is therefore retained only in the narrower `script-src-attr 'unsafe-inline'` and `style-src-attr 'unsafe-inline'` directives; no risky whole-app handler/style rewrite was attempted in this phase.
- Added a dependency-free regression test that requires the broad script/style directives to remain free of `'unsafe-inline'`, requires the login page to contain no inline script/style/event/style attributes, and requires both external login assets to exist.
- Phase 3 implementation commit: `a7caebd784276141b9bc0754ca159090cb934971` (`Tighten CSP and externalize admin login assets`).
- GitHub Stability Checks: PASS — run #17 / ID `33294991099` on the exact implementation commit.
- Vercel Preview deployment: `dpl_8k7qdXShEU6bxd2uhiBxiyRbFTRQ` — READY, preview target only (`target: null`), branch `improve/abhitools-safe-polish`, exact implementation SHA, 12 Node.js functions, errors-only build log clean.
- Preview login HTML returned HTTP 200 and exposed the expected narrowed CSP header plus `admin_login.css` / `admin_login.js` references. Vercel's preview toolbar injects its own external `vercel.live` script, which the app CSP intentionally does not whitelist; no application dependency on that preview-only toolbar was introduced.
- API/server/Supabase migration/service-worker files changed: No.
- Dependency added: None.
- Financial/business logic changed: No.
- Admin authentication boundary or `/api/auth` semantics changed: No; credential verification and signed session behavior remain server-side as before.
- Supabase data write/test data created in Phase 3: None.
- Production merge/promotion/deploy performed by Phase 3: No.

## Improvement Pass Phase 4 — Intentional Public Due Endpoint Documentation (2026-09-05)

- Scope: `api/due.js` comment-only documentation plus this audit file.
- Confirmed `public_script.js` intentionally calls unauthenticated `GET /api/due` before loading `/api/loans`, and uses its public summary/business-date response for the public dashboard.
- Added a short comment immediately above the `/api/due` handler stating that the unauthenticated public read exposure is intentional for borrower names/due amounts and must not be converted to admin-only access accidentally; existing admin sessions still only add internal `emi_id` / `loan_id` fields.
- Phase 4 implementation commit: `f969e6d46a4a092a6b2c86d5464be649f3cbef0d` (`Document intentional public due endpoint`).
- Diff verification against the Phase 3 audit HEAD showed exactly one executable file changed, `api/due.js`, with 3 comment lines added and 0 deletions; no runtime statement, formula, request field, response field, method guard, auth check, or financial write endpoint changed.
- GitHub Stability Checks: PASS — run #19 / ID `33949805414` on the exact implementation commit.
- Vercel Preview deployment: `dpl_2A4D7P2sGqeZjFCp9D6tgUgj7HWa` — READY, preview target only (`target: null`), exact Phase 4 implementation SHA, 12 Node.js functions, errors-only build log clean.
- Direct preview `/api/due` smoke fetch is gated by Vercel preview authentication and returned the expected preview-auth redirect rather than exercising application auth; production `/api/due` remained publicly reachable and returned HTTP 200 with the established response shape on 2026-09-05.
- Service worker/precache changed: No; this is a server-comment/audit-only phase, so no cache bump is required.
- Dependency added: None.
- Database/Supabase migration/data write: None.
- Financial/business logic changed: No.
- EMI/payment ledger, sequential EMI, UPI/UTR, foreclosure/settlement, recycle, manual Loan ID, and admin-authentication behavior changed: No.
- API request/response field names or shapes changed: No.
- Production merge/promotion/deploy performed by Phase 4: No.

## Improvement Pass Phase 5 — Financial Calculation Regression Tests (2026-09-05)

- Scope: new `tests/financial-calculations.test.mjs` plus this audit file; no production implementation file is changed.
- Added 8 dependency-free `node --test` regression tests covering protected EMI remaining calculation, due/overdue/today/tomorrow/next7/month bucketing, sequential next-unpaid EMI eligibility/order, and foreclosure/settlement outstanding/final/waiver calculations.
- Test fixtures are pure in-memory data. Tests make no HTTP request, Supabase request, database connection, payment, settlement, delete, recycle, UPI, or other live-data mutation.
- Because sequential/foreclosure/settlement authoritative rules live in existing Supabase SQL RPC migrations, production SQL was not refactored merely for testability. Source guards verify the protected formulas/order/error guards remain present in `api/due.js`, `20260825170000_upi_next_emi_foreclosure_utr.sql`, and `20260824092529_phase11_loan_settlement_closing.sql`.
- Phase 5 implementation commit: `13694a15faf5b911390c2299ced0d39084696016` (`Add Phase 5 financial regression tests`).
- Diff from the Phase 4 audit HEAD contains exactly one implementation file: new `tests/financial-calculations.test.mjs` (215 additions, 0 deletions). No `/api`, `/server_routes`, `/supabase/migrations`, `server_shared.js`, frontend runtime asset, service worker, or package/dependency file changed.
- GitHub Stability Checks: PASS — run #21 / ID `33950277974` on the exact implementation commit.
- Vercel Preview deployment: `dpl_9fjHJc4oGm6wuE3RC6nTwjpuXeSm` — READY, preview target only (`target: null`), exact implementation SHA, 12 Node.js functions, errors-only build log clean.
- Dependency added: None.
- Service worker/precache changed: No; this is a tests/audit-only phase, so no cache bump is required.
- Database/Supabase migration/data write: None.
- Financial/business logic changed: No.
- EMI/payment ledger, due bucketing, sequential EMI, UPI/UTR, foreclosure/settlement, recycle, manual Loan ID, admin auth, and API request/response behavior changed: No.
- Production merge/promotion/deploy performed by Phase 5: No.

## Improvement Pass Phase 6 — Rollback Prep & Release Hygiene (2026-09-05)

- Scope: release/rollback documentation and verification only. Added `RELEASE_ROLLBACK_CHECKLIST.md`; no runtime implementation, financial rule, API route, database schema, package/dependency, or service-worker behavior was changed by Phase 6.
- Final Phase 6 branch HEAD: `e2db5e2463d63b8b29631c0cde5fc7f7a4ecb498` (`Record Phase 6 final release hygiene verification`).
- At closeout the improvement branch was 13 commits ahead of `main` and 0 behind; no rebase or merge-from-main was required and no open pull request existed for the branch.
- Primary emergency production rollback anchor documented as Vercel deployment `dpl_w6LmXeCDqHXRbgUedgb9DpRznL33`, commit `6781a2833128262738b2853718fca421f4c04cbb`, READY, production target, 12 Node.js functions.
- GitHub Stability Checks: PASS — run #24 / ID `33951300322` on exact final Phase 6 HEAD.
- Vercel preview: `dpl_CDuT1gLcttswEC5AF2Wuv8TDCtNA` — READY, preview target only, exact Phase 6 HEAD, 12 Node.js functions, errors-only build log clean.
- Runtime review found no new application failure; the only grouped production diagnostic remained the pre-existing Node `DEP0169 url.parse()` deprecation warning.
- Production merge/promotion/deploy performed by Phase 6: No.

## Improvement Pass Phase 7 — UI Token Unification: Base Buttons (2026-09-05)

- Scope is deliberately limited to the base `.btn` visual family as the first Part 2 styling section: `ui_shell.css`, `style.css`, required service-worker cache bump, and the matching cache regression assertion.
- Added shared button tokens in `ui_shell.css`: primary, success, warning, secondary, text-on-fill, outline light/dark colors, and button shadow. `style.css` now consumes those tokens only for `.btn`, `.btn-danger`, `.btn-success`, `.btn-warning`, `.btn-secondary`, and `.btn-view`.
- The token values preserve the previous exact light-mode and dark-mode colors; this phase centralizes values without redesigning controls or changing layout/spacing. Special feature controls such as report periods, reminder buckets, and other non-base button systems are intentionally deferred to later incremental styling passes.
- No selector name, element ID, form field, onclick/action wiring, user-facing Hindi/Hinglish text, data payload, or financial calculation was changed.
- Because both `style.css` and `ui_shell.css` are service-worker shell assets, cache discipline required `abhi-tools-shell-v2-4-stable-v14` → `abhi-tools-shell-v2-4-stable-v15`; the existing GET-only retry/non-GET bypass behavior is unchanged. The cache assertion in `tests/security-hardening.test.mjs` was updated to `v15`.
- Phase 7 implementation HEAD: `dec3e28b5d2ba7394c68a8dc254dd4fa29bb12a1` (`Align cache guard with button token build`). Diff from Phase 6 final HEAD contains exactly four files: `ui_shell.css` (+11), `style.css` (+9/-9), `service-worker.js` (+1/-1), and `tests/security-hardening.test.mjs` (+1/-1).
- No `/api`, `/server_routes`, `/supabase/migrations`, `server_shared.js`, package/dependency file, or financial write endpoint changed.
- GitHub Stability Checks: PASS — run #28 / ID `33951916724` on the exact implementation HEAD.
- Vercel Preview deployment: `dpl_94TFdpGx6uL15BpB5hLPXBNpaoQT` — READY, preview target only (`target: null`), exact implementation SHA, 12 Node.js functions, errors-only build log clean.
- Automated browser visual verification could not be completed in the current execution environment: Chromium navigation to the authenticated preview was blocked by administrator network policy, and direct preview asset fetch remained behind Vercel SSO. This is recorded as a verification-environment gap, not as a visual pass or an application failure.
- Source-level light/dark parity was verified: all migrated button tokens resolve to the same legacy values they replaced, so no intentional visual color change is introduced by this tokenization step.
- Dependency added: None.
- Database/Supabase migration/data write: None.
- Financial/business logic changed: No.
- EMI/payment ledger, sequential EMI, UPI/UTR, foreclosure/settlement, recycle, manual Loan ID, admin authentication, and API request/response behavior changed: No.
- `version.json` changed: No; release metadata remains reserved for final closeout.
- Production merge/promotion/deploy performed by Phase 7: No.

## Improvement Pass Phase 8 — Spacing Scale Foundation: More Shell Panel (2026-09-05)

- Scope follows Part 2.2 incrementally: spacing usage was reviewed across `style.css`, `ui_shell.css`, `ui_loans.css`, `ui_home_collections.css`, `ui_forms_secondary.css`, and `ui_smoothness.css`; mixed ad-hoc spacing remains intentionally for later section-by-section passes rather than a global replace.
- Added one shared spacing scale to `ui_shell.css`: `--ui-space-1` through `--ui-space-6` = 4/8/12/16/24/32px.
- Applied the new scale only to the existing More shell panel. Existing exact 8px/12px values were tokenized; selected off-scale values were normalized narrowly: panel bottom offset 14→16px, header padding 14/14/10→16/16/12px, content bottom padding 18→24px, grid gap 7→8px, action gap 9→8px, and action padding 9/10→8/12px. Desktop panel top/bottom remain visually 12px via token.
- No selector/class/ID, action wiring, form field, user-facing text, data shape, or layout hook queried by JavaScript was renamed or removed.
- Because `ui_shell.css` is a service-worker shell asset, cache changed `v15` → `v16`; GET-only retry, non-GET bypass, and API no-cache behavior are unchanged.
- Updated the existing cache guard to `v16` and added a dependency-free source-level regression test requiring the 4/8/12/16/24/32 token scale and More-panel token usage. The test performs no network or live-data mutation.
- Phase 8 implementation commit: `a3f4a9314cc350f053d064b87579b86418258e2c` (`Add Phase 8 spacing scale foundation`). Diff from the Phase 7 final audit HEAD contains exactly `ui_shell.css`, `service-worker.js`, and `tests/security-hardening.test.mjs`.
- GitHub Stability Checks: PASS — run #30 / ID `33954273705` on the exact implementation SHA.
- Vercel preview: `dpl_Cvyehu8yxoeaTaDKzTVe7AiPqr3Q` — READY, preview target only (`target: null`), exact implementation SHA, 12 Node.js functions, errors-only build log clean.
- Visual verification: a representative More-panel fixture using the exact modified Phase 8 CSS rules was rendered with Chromium at 390×844 in both light and dark modes. Panel geometry matched in both modes (x=8, y=414, width=374, height=346), six actions were visible, and inspected screenshots showed no clipping, overlap, horizontal overflow, or dark-mode contrast regression. Live authenticated admin interaction was not exercised because that requires an app admin session.
- Dependency added: None.
- Database/Supabase migration/data write: None.
- `/api`, `/server_routes`, `/supabase/migrations`, `server_shared.js`, and financial write implementations changed: No.
- Financial/business logic changed: No.
- EMI/payment ledger, sequential EMI, UPI/UTR, foreclosure/settlement, recycle, manual Loan ID, admin authentication, and API request/response behavior changed: No.
- `version.json` changed: No; final release metadata remains deferred to the end of the improvement pass.
- Production merge/promotion/deploy performed by Phase 8: No.
