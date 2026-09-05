# AbhiTools Improvement Release & Rollback Checklist

Prepared for `improve/abhitools-safe-polish` before any merge to `main`.

## Release candidate anchors

- Base `main` commit: `429b445411c994605dfefc9f740820aa1fb66004` (`Harden paid-first observer against repeat mutations`).
- Phase 5 verified branch HEAD before this checklist: `a36b747e98b300a7c785dda800ffbc035971d2ff`.
- Branch state at Phase 6 start: 11 commits ahead of `main`, 0 commits behind. No rebase or merge-from-main is required.
- No open pull request existed for this branch at Phase 6 start.

## Current production rollback anchor

Primary emergency rollback target:

- Vercel deployment: `dpl_w6LmXeCDqHXRbgUedgb9DpRznL33`
- Git commit: `6781a2833128262738b2853718fca421f4c04cbb` (`Strengthen Phase 1 regression guards`)
- State: READY
- Target: production
- Functions: 12 Node.js functions

Secondary original-main anchor:

- Vercel deployment: `dpl_ACE5hH62TaM87BEuyZxiK2mGvi9P`
- Git commit: `429b445411c994605dfefc9f740820aa1fb66004`
- State: READY
- Target: production

The current production diagnostics still show only the pre-existing Node `DEP0169 url.parse()` deprecation warning group; no new AbhiTools application failure was identified during Phase 6 preparation.

## Phase rollback checkpoints

- Phase 1 regression guards: `6781a2833128262738b2853718fca421f4c04cbb`
- Phase 2 dead public-dues cleanup: `900a8a3e2a8573b0fcfb091405b5028f8e62819e`
- Phase 3 CSP/login extraction: `a7caebd784276141b9bc0754ca159090cb934971`
- Phase 4 public `/api/due` documentation: `f969e6d46a4a092a6b2c86d5464be649f3cbef0d`
- Phase 5 financial regression tests: `13694a15faf5b911390c2299ced0d39084696016`

## Final diff summary versus main

Expected changed files before Phase 6 documentation:

### Runtime / deployment behavior

- `advanced_admin_login_panel.html` — login inline CSS/JS removed in favor of same-origin external assets.
- `admin_login.css` — extracted login styles.
- `admin_login.js` — extracted login behavior; credentials still verified only by `/api/auth`.
- `vercel.json` — CSP narrows broad inline script/style permission while retaining legacy attribute compatibility.
- `service-worker.js` — shell cache name only changes from V2.4 `v13` to `v14` for the dead-file cleanup; API write requests remain untouched.
- `api/due.js` — comment-only documentation of the intentional public read endpoint.
- `ui_public_dues.js` — removed superseded implementation.
- `ui_public_dues_compact.js` — removed superseded implementation.

### Reproducibility / database maintenance already reconciled during recovery

- `supabase/migrations/20260823000000_bootstrap_core_schema.sql` — reproducible foundational schema for a fresh Supabase project; intentionally excludes protected financial RPC reimplementation.
- `supabase/migrations/20260829143000_remove_duplicate_activity_index.sql` — removes only the duplicate bootstrap activity index.

### Tests / CI / audit

- `.github/workflows/stability-checks.yml`
- `tests/security-hardening.test.mjs`
- `tests/financial-calculations.test.mjs`
- `STABILITY_AUDIT.md`

No other file was present in the `main...improve/abhitools-safe-polish` diff at Phase 6 start.

## Protected behavior review

Before merge, verify all of the following remain true:

- `/api` remains exactly 12 serverless functions.
- No financial write route was added, removed, renamed, or auto-retried.
- `POST`, `PUT`, and `DELETE` requests are never retried by the service worker.
- EMI/payment ledger calculations are unchanged.
- Sequential EMI eligibility is unchanged.
- UPI/UTR verification and confirmation semantics are unchanged.
- Foreclosure/settlement rules are unchanged.
- Recycle restore/purge behavior is unchanged.
- Manual Loan ID behavior is unchanged.
- Admin credentials remain server-side; no hardcoded client credential exists.
- Public borrower/loan direct-data behavior remains intentionally public.

## Rollback procedure

### If a release causes a runtime/UI/API regression

1. Prefer Vercel rollback/promote to the known READY production deployment `dpl_w6LmXeCDqHXRbgUedgb9DpRznL33`.
2. Verify the public dashboard and admin login recover before making additional changes.
3. In Git, revert the release merge commit through a normal revert commit/PR. Do not force-reset `main`.
4. Re-run Stability Checks and verify the restored deployment still reports 12 functions and clean build errors.

### If one improvement phase is isolated as the cause before merge

Revert only that phase's commit from the improvement branch using the phase rollback checkpoint above, then rerun the full test suite and preview deployment before continuing.

### Database rollback rule

Do not perform a destructive database rollback as the first response to an application release issue. The recovery bootstrap and duplicate-index cleanup were already reconciled on the fresh Supabase project and do not rewrite protected financial RPC logic. Roll back the application deployment first. Any database reversal requires a separately verified, forward-safe migration plan.

### Service-worker rollback rule

If the shell/cache change is implicated, deploy/promote the previous known-good app build rather than manually editing browser caches. The previous service worker version will replace the newer shell through the normal deployment/update lifecycle.

## Final pre-merge gate

A release is ready for manual merge review only when:

- branch is 0 commits behind `main`,
- final diff contains only the intended files documented above plus Phase 6 documentation,
- full GitHub Stability Checks pass on the final branch HEAD,
- a fresh Vercel preview for that exact HEAD is READY,
- preview reports exactly 12 Node.js functions,
- errors-only build logs are clean,
- no new dependency or serverless function appears,
- no production promotion/deployment has been performed automatically.

## Phase 6 verification record

- Phase 6 implementation commit: `4533ab3c0e312101f1042a7d4393173d43fbbfd2` (`Add Phase 6 release rollback checklist`).
- The implementation commit changed only this documentation file; no runtime, API, frontend, service-worker, Supabase migration, package, or financial implementation file changed in Phase 6.
- GitHub Stability Checks run #23 / ID `33951213488`: PASS on the exact implementation commit.
- Fresh Vercel preview: `dpl_B18HPoGGRdASqReNpuPK4Q2DJWDN` — READY, preview target only, exact implementation SHA, 12 Node.js functions, errors-only build log clean.
- Preview error/fatal runtime-log query returned no matching logs.
- Final branch review after the implementation commit: 12 commits ahead of `main`, 0 commits behind, with only the intended improvement files plus this Phase 6 checklist in the diff.
- Open pull requests from `improve/abhitools-safe-polish`: none at verification time.
- Production runtime diagnostics still show only the pre-existing Node `DEP0169 url.parse()` deprecation warning group; no new application failure was identified.
- Production merge, promotion, rollback, or deployment performed by Phase 6: No.

This checklist authorizes no production merge or deployment by itself.
