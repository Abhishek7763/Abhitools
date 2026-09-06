# AbhiTools / Abhishek Management Tool

> **Purpose:** A production loan, EMI, borrower, collection, payment, reminder, backup, reporting, and admin-management system hosted on Vercel with Supabase PostgreSQL as the primary database.
>
> **Current stable product line:** V2.4 Stable (`package.json` version `2.4.0`)
>
> **Production:** `https://abhi-tools.vercel.app`
>
> **Source of truth:** GitHub repository `Abhishek7763/Abhitools`, branch `main`

---

## 1. System Overview

AbhiTools is a mobile-friendly management application with two main user experiences:

1. **Public / borrower-facing view** — read-only loan and EMI information, borrower folders, month-based browsing, EMI due visibility, payment-related UI, search, sorting, list/grid layouts, dark mode, and PWA support.
2. **Admin panel** — authenticated management of loans, borrowers, EMI payments, settlements, reminders, follow-ups, reports, backups, recycle bin, settings, data-quality tools, documents, activity history, and other operational workflows.

The application is intentionally lightweight on the frontend: plain HTML, CSS, and JavaScript are served by Vercel, while serverless API routes handle protected database access and business operations.

---

## 2. Core Architecture

### Frontend

- HTML pages: `index.html`, `admin.html`, `advanced_admin_login_panel.html`, `offline.html`
- Main styling: `style.css`
- Shared UI shell: `ui_shell.css`, `ui_shell.js`
- Public logic: `public_script.js`
- Admin logic: `admin_script.js`
- PWA lifecycle/install support: `pwa.js`, `service-worker.js`, `manifest.json`
- Additional UI modules provide focused enhancements without changing database architecture.

### Backend

- Vercel serverless API routes live in `api/`
- Shared server helpers live in `server_shared.js`
- Larger functional route modules live in `server_routes/`
- API functions have a configured maximum duration of 10 seconds.

### Database

- Supabase PostgreSQL is the primary persistent datastore.
- Database history and schema evolution are stored in `supabase/migrations/`.
- Migrations must be treated as historical infrastructure and should not be deleted casually.

### Hosting / Source

- Source control: GitHub
- Production hosting: Vercel
- Database: Supabase PostgreSQL
- Node runtime: Node 24.x

---

## 3. Public Application

### Entry point

`index.html`

### Main features

The public application provides:

- Active-loan dashboard summary
- Active loan total
- Due-this-month summary
- Overdue summary
- Tomorrow-due summary
- Next-7-days summary
- Borrower search
- Loan ID search
- Sort by borrower name
- Sort by highest amount
- Sort by lowest amount
- Browse **By Name**
- Browse **By Month**
- Grid/List layout switching
- Month-level amount sorting
- Borrower loan summary
- EMI total, paid amount, and remaining amount visibility
- Due-date clarity and EMI priority presentation
- Dark mode
- Contact/help actions
- Admin login entry
- PWA install support
- Mobile navigation

### Current public script load order

`index.html` currently loads the public experience using:

- `pwa.js`
- `public_script.js`
- `ui_public_compact.js`
- `ui_public_dues_final.js`
- `ui_upi_payments.js`
- `ui_emi_clarity_preview.js`
- `ui_emi_due_priority_preview.js`
- `ui_manager_workflow_preview.js`

**Important:** some filenames still contain `preview`, but these files are currently loaded by production and therefore are production dependencies. Do not delete or rename them without updating `index.html` and fully testing the public UI.

---

## 4. Public Loan / EMI Logic

The public application reads loan data from the server and works mainly with active loans.

Important concepts:

- `loan.amount` represents the loan amount.
- EMI records live under each loan's `emis` collection.
- `paid_amount` is normalized against the scheduled EMI amount.
- Remaining EMI amount is calculated as scheduled amount minus valid paid amount, never below zero.
- Past-due logic compares the EMI due date with the server/business date returned by the due API.
- Public totals and due summaries should use server-derived due data whenever available instead of relying only on the client device clock.

The current public UI also provides borrower-level EMI remaining summaries, month cards, due priority, and mobile readability improvements.

---

## 5. Admin Application

### Entry points

- Login: `advanced_admin_login_panel.html`
- Main admin dashboard: `admin.html`
- Main admin logic: `admin_script.js`

### Major admin capabilities

The admin system contains operational workflows for:

- Borrower management
- Loan management
- EMI schedule management
- Payment recording
- UPI payment workflows
- Settlement / loan closing
- Dashboard analytics
- Due / overdue center
- Today / tomorrow / next-7-day collection views
- Reminder center
- Follow-up / promise-to-pay workflows
- Collection calendar
- Reports
- Advanced search
- Activity history
- Data-quality review
- Document / receipt management
- Backup export/import
- Recycle bin and restore/purge flows
- Settings and business rules
- WhatsApp/message templates
- Release / recovery tools
- Mobile quick navigation
- Dark mode / responsive admin UI

The admin page is intentionally large because many operational tools are integrated into the same authenticated workspace.

---

## 6. API Route Map

### `api/auth.js`
Authentication-related server logic for protected admin access.

### `api/loans.js`
Loan read/write operations and core loan data access.

### `api/borrowers.js`
Borrower-related operations.

### `api/payments.js`
Payment processing / payment-record operations.

### `api/due.js`
Due-date refresh and due-summary data used by public and admin views.

### `api/dashboard.js`
Dashboard-related server data and shared dashboard modes. `vercel.json` rewrites `/api/upi-payments` to `/api/dashboard?mode=upi-payments`.

### `api/backup.js`
Backup-generation and related data-protection operations.

### `api/import.js`
Backup/data import workflows.

### `api/recycle.js`
Recycle-bin operations.

### `api/settlements.js`
Loan settlement / closing workflows.

### `api/documents.js`
Document/receipt metadata operations.

### `api/upload.js`
Upload-related server operations.

---

## 7. Extended Server Route Modules

The `server_routes/` directory contains larger feature modules used by the backend:

- `activity.js` — activity/history workflows
- `calendar.js` — collection calendar data
- `data_quality.js` — data-quality inspection and review
- `followups.js` — follow-up and promise-to-pay logic
- `home.js` — admin home/command-center data
- `reminders.js` — reminder-center logic
- `reports.js` — reports and analytics
- `risk.js` — risk-related analysis
- `search.js` — advanced search
- `settings.js` — application settings
- `settings_config.js` — settings configuration/defaults
- `upi_payments.js` — UPI payment workflows

`server_shared.js` contains shared server-side utilities used across backend operations.

---

## 8. Database and Migration History

All SQL migration files under `supabase/migrations/` are important historical records of the live database schema and behavior.

The migration history includes areas such as:

- API-access hardening
- legacy-record compatibility
- backup/import support
- EMI payment tables and actions
- due/overdue engine
- document/receipt support
- settlement and closing
- recycle bin
- activity indexes
- legacy data-quality cleanup
- app settings
- follow-up / PTP support
- core foreign-key indexes
- stale recycle purge fix
- UPI payment requests and indexes
- next-EMI / foreclosure / UTR workflows
- security hardening

**Rule:** do not delete old migrations merely because a newer migration exists. They form the database evolution history and are useful for rebuilding and auditing the schema.

---

## 9. Backup and Recovery

The stable release metadata records backup format version **7**.

Backup-related behavior is spread across:

- `api/backup.js`
- `api/import.js`
- relevant Supabase migrations
- admin backup/recovery UI
- release/recovery center in `admin.html`

Before risky schema or financial-logic changes, create and verify a fresh backup.

---

## 10. PWA / Offline Support

PWA-related files:

- `manifest.json`
- `pwa.js`
- `service-worker.js`
- `offline.html`
- `icon-192.png`
- `icon-512.png`

The service worker is deliberately served with `no-cache, no-store, must-revalidate` headers to reduce stale service-worker problems during updates.

The app supports install behavior and mobile-app-style navigation.

---

## 11. Security Baseline

`vercel.json` applies security headers across the application, including:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- restricted camera/microphone/geolocation permissions
- DNS prefetch disabled
- cross-domain policy disabled
- Content Security Policy limiting resources mainly to same-origin content

Admin pages are configured with `no-store` cache headers.

The stable release metadata identifies V2.4 as the security baseline.

Security-related migration and test coverage must not be removed without inspection.

---

## 12. Tests and CI

### Test command

```bash
npm test
```

This runs Node's built-in test runner against:

- `tests/security-hardening.test.mjs`

### GitHub Actions

`.github/workflows/stability-checks.yml` runs stability tests on:

- pull requests
- pushes to `main`

The workflow uses Node 24.

---

## 13. Important UI Modules

### Public / shared

- `ui_public_compact.js` — public presentation and compact behavior
- `ui_public_dues_final.js` — current public due UI
- `ui_upi_payments.js` — UPI-related UI
- `ui_emi_clarity_preview.js` — production-loaded EMI clarity layer
- `ui_emi_due_priority_preview.js` — production-loaded due-priority layer
- `ui_manager_workflow_preview.js` — production-loaded borrower/month/list-grid workflow layer
- `ui_shell.css` / `ui_shell.js` — shared UI shell
- `ui_smoothness.css` — UI smoothness/presentation support

### Admin-focused

- `ui_forms_secondary.css` / `ui_forms_secondary.js`
- `ui_home_collections.css` / `ui_home_collections.js`
- `ui_loans.css` / `ui_loans.js`
- `ui_paid_first.js`
- `ui_performance.js`

Do not classify a UI file as unused only from its name. Search references in `index.html`, `admin.html`, `admin_script.js`, and other loaded modules before deletion.

---

## 14. Release Metadata

`version.json` is the release marker and records:

- product name
- stable channel
- release label
- architecture summary
- backup format version
- release notes

`package.json` currently reports version `2.4.0` and Node `24.x`.

When a future release is formally completed, update release metadata intentionally rather than casually changing version files during minor UI work.

---

## 15. Vercel Configuration

`vercel.json` currently defines:

- serverless functions under `api/*.js`
- max function duration: 10 seconds
- `/api/upi-payments` rewrite
- global security headers
- no-cache service worker
- no-store admin/login pages

Do not increase serverless function count or alter routing without checking the Vercel Hobby-plan constraints and existing architecture.

---

## 16. Repository Structure

```text
.github/workflows/              CI stability tests
api/                            Vercel serverless API endpoints
server_routes/                  Extended backend feature modules
supabase/migrations/            Database schema/history migrations
tests/                          Automated stability/security tests
index.html                      Public application
public_script.js                Public core logic
admin.html                      Admin workspace
admin_script.js                 Admin core logic
advanced_admin_login_panel.html Admin login
style.css                       Main global styling
ui_*.js / ui_*.css              Feature-focused UI layers
pwa.js                          PWA lifecycle/install logic
service-worker.js               PWA cache/offline worker
manifest.json                   PWA manifest
offline.html                    Offline fallback
server_shared.js                Shared backend helpers
vercel.json                     Deployment/routing/security config
version.json                    Stable release marker
package.json                    Node/runtime/test configuration
README.md                       System documentation and AI inspection guide
```

---

## 17. Files That Must Be Treated Carefully

High-risk or core files include:

- `admin_script.js`
- `public_script.js`
- `api/*.js`
- `server_routes/*.js`
- `server_shared.js`
- `supabase/migrations/*.sql`
- `vercel.json`
- `service-worker.js`
- `manifest.json`
- `version.json`

Changes to these may affect financial values, payments, authentication, database operations, backup compatibility, production routing, or PWA behavior.

---

## 18. Safe Change Principles

When modifying AbhiTools:

1. Do not change financial calculations unless the requested task explicitly requires it.
2. Preserve `paid_amount`, EMI totals, remaining amounts, settlement logic, and due logic unless verified end-to-end.
3. Do not casually change API response shapes used by the public/admin frontend.
4. Preserve authentication boundaries.
5. Do not auto-correct legacy database records without explicit review.
6. Do not delete Supabase migrations.
7. Avoid repeated DOM timers/intervals for UI enhancements; prefer direct event-driven updates.
8. Keep mobile behavior first-class.
9. Verify both light and dark mode after UI changes.
10. Verify list and grid modes when touching browse layouts.
11. Run `npm test` before a production release.
12. Check Vercel build/runtime status after production deployment.
13. Batch small changes into a stable phase/build where practical instead of unnecessary repeated production deployments.

---

## 19. AI Inspection Guide

When using an AI coding/inspection tool on this repository, provide this README first and ask it to inspect the current files before proposing changes.

Recommended inspection order:

1. `README.md`
2. `version.json`
3. `package.json`
4. `vercel.json`
5. target HTML page (`index.html` or `admin.html`)
6. target core script (`public_script.js` or `admin_script.js`)
7. relevant `ui_*` modules
8. relevant `api/*` endpoint
9. relevant `server_routes/*` module
10. relevant Supabase migrations
11. tests and CI workflow

For any proposed cleanup, the AI should verify that a file is not referenced by HTML, JavaScript, Vercel routing, service-worker caching, package scripts, CI, or server imports before deleting it.

For any production fix, the AI should state whether the change affects:

- UI only
- financial calculations
- API contract
- authentication/security
- database schema/data
- backup format
- PWA/service worker
- Vercel routing/function budget

This classification makes review much safer.

---

## 20. Current Cleanup Status

As of 2026-09-06, obsolete/superseded repository artifacts were cleaned from `main`, including:

- old standalone stability audit documentation
- superseded public dues UI versions
- obsolete standalone stability preview layer

The authoritative human/AI reference document is now this `README.md`.

---

## 21. Production Stability Note

The current production UI contains several layers added over time. Some production-loaded files still include `preview` in their filenames. Their filename is historical; their runtime status is determined by whether production pages load them.

Before future cleanup, prefer consolidation only after full behavior comparison. A file that looks old may still be actively responsible for borrower summaries, EMI clarity, month sorting, list/grid controls, dark-mode readability, or other production behavior.

---

## 22. Final Reference

If a future developer or AI is unsure whether a change is safe:

- inspect references first,
- preserve core financial behavior,
- preserve API compatibility,
- preserve database history,
- test before production,
- and prefer small, reversible, clearly scoped changes.

This repository is a live financial-management application; cleanup should improve clarity without removing active behavior.