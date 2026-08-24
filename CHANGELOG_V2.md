# AbhiTools V2.0 Stable — Changelog

Release date: 2026-08-24

This release consolidates the Phase 1–21 production work into a stable recovery-aware baseline.

## Major capabilities

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
- Phase 21 Release & Recovery Center with visible versioning and operational recovery checklist.

## Compatibility and safety

- Vercel Hobby architecture remains within the 12 Serverless Function limit.
- Legacy EMI years/dates are not invented automatically.
- Collection Priority Insights are operational collection aids, not credit scores or automated lending decisions.
- Secrets are expected only in deployment environment variables and are not stored in this repository.
