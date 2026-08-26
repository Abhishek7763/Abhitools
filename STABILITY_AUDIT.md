# AbhiTools Stability Audit

Last updated: 2026-08-26

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
- Production verification: READY, 12/12 functions, build errors 0, live service worker 200, `/api/due` fresh → cooldown behavior preserved.

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

## Current known audit note

Vercel runtime diagnostics still report an intermittent Node `DEP0169 url.parse()` deprecation warning on older `/api/dashboard`, `/api/loans`, and `/api/borrowers` executions. Repo inspection has not found direct `url.parse()` usage in the application code, so no working code is being changed solely to silence that hosting/runtime warning.

This warning is currently treated as a hosting/runtime maintenance note, not a verified AbhiTools application failure.

## Stable-release decision

V2.3.3 has passed final production verification and is the designated stable baseline. Additional changes should be made only for a verified bug, required maintenance, or an explicitly requested new feature; further speculative polish should not be layered onto the stable baseline.

## Release verification checklist

Before a polish/release PR is merged:

1. Compare branch against `main` and confirm changed files match intended scope.
2. Confirm Vercel preview is READY and serverless count remains within Hobby limit (12).
3. Check errors-only build logs.
4. Verify any touched public endpoint or static runtime asset returns the expected status/shape.
5. Confirm no financial write route was unintentionally changed.
6. Merge only after PR is mergeable.
7. Verify production deployment READY and check recent runtime errors.
8. Record final production commit/deployment verification in the PR or this audit file.
