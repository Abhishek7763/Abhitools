# AbhiTools V2.1 Stable — Changelog

Release date: 2026-08-24

V2.1 extends the Phase 1–21 stable production baseline with Phase 22 server-synced settings and business rules.

## V2.1 / Phase 22

- Added **Settings & Business Rules Center** in Admin.
- Settings are stored server-side in Supabase and are available across mobile/desktop sessions.
- Added configurable business display name and message signature.
- Added configurable default payment method.
- Added configurable Reminder Center window from 1–14 days; UI shows the active window dynamically.
- Added configurable default Reminder Center view.
- Added default admin list/grid and Command Center expanded/compact preferences, with an explicit **Apply to This Device** action.
- Added editable WhatsApp templates for due, overdue, payment-received and loan-closing messages.
- Added safe template variables such as `{name}`, `{loan_id}`, `{due_date}`, `{amount}`, `{payment_amount}` and `{signature}` with live preview.
- Settings changes are recorded in Activity History.
- Reset All Settings requires typed confirmation and creates a safety snapshot before reset.
- Full JSON backup and server snapshots upgraded to **backup format v6**, which includes `app_settings`.
- Restoring older v5 snapshots preserves current settings; v6 snapshots restore settings with the data snapshot.
- Vercel Hobby architecture remains at 12 serverless functions by routing settings through `api/dashboard.js`.

## Existing major capabilities

- Secure server-side admin authentication with signed HttpOnly session cookies.
- Supabase-backed borrowers, loans, EMIs, payments, documents, settlements, recycle bin, backups and audit history.
- Smart import, full JSON export, database snapshots and guarded restore.
- EMI payment add/correct/reverse workflows and due/overdue engine.
- Advanced borrower profiles, statements, receipts and document/photo support.
- WhatsApp collection tools, collection calendar, advanced search and dashboard.
- Loan settlement/reopen workflows and recoverable safe-delete/recycle workflows.
- Activity History / Audit Timeline and Reports & Analytics.
- Secure installable PWA with API/financial data explicitly excluded from offline cache.
- Reminder Center, Data Quality / Legacy Cleanup Center, Daily Command Center and Collection Priority Insights.
- Release & Recovery Center with visible versioning and operational recovery checklist.

## Compatibility and safety

- Vercel Hobby architecture remains within the 12 Serverless Function limit.
- Legacy EMI years/dates are not invented automatically.
- Settings do not automatically rewrite borrower, loan or EMI financial records.
- Collection Priority Insights are operational collection aids, not credit scores or automated lending decisions.
- Secrets are expected only in deployment environment variables and are not stored in this repository.
