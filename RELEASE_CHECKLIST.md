# AbhiTools V2.2 — Release Checklist

Before marking a future build stable, verify all of these:

- [ ] Latest Vercel production deployment is READY.
- [ ] Vercel Serverless Function count is 12 or fewer.
- [ ] Build logs have no build errors.
- [ ] Public site loads.
- [ ] Public loan API works as intended.
- [ ] Admin-only dashboard routes return 401 without a valid session.
- [ ] Admin login works with the existing environment-based credentials.
- [ ] Settings route is admin-only and server-synced settings load correctly.
- [ ] Follow-up/PTP route is admin-only and returns 401 without a valid session.
- [ ] Follow-up create / next-action / PTP status workflows do not mutate EMI payment ledger.
- [ ] Reminder window and WhatsApp template settings work without changing legacy financial data.
- [ ] Full JSON backup and server snapshots include app settings and follow-up/PTP history (format v7 or newer).
- [ ] Service worker never caches `/api/*` responses.
- [ ] Security headers are present.
- [ ] Supabase Security Advisor has no unresolved security lints.
- [ ] Borrower/loan/EMI counts match expectations.
- [ ] Recycle Bin contains only expected recoverable items.
- [ ] A fresh server snapshot exists.
- [ ] A Full JSON Backup has been downloaded externally.
- [ ] Legacy missing dates have not been auto-guessed.
