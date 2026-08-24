# AbhiTools V2.1 — Release Checklist

Before marking a future build stable, verify all of these:

- [ ] Latest Vercel production deployment is READY.
- [ ] Vercel Serverless Function count is 12 or fewer.
- [ ] Build logs have no build errors.
- [ ] Public site loads.
- [ ] Public loan API works as intended.
- [ ] Admin-only dashboard routes return 401 without a valid session.
- [ ] Admin login works with the existing environment-based credentials.
- [ ] Settings route is admin-only and server-synced settings load correctly.
- [ ] Reminder window and WhatsApp template settings work without changing legacy financial data.
- [ ] Full JSON backup and server snapshots include app settings (format v6 or newer).
- [ ] Service worker never caches `/api/*` responses.
- [ ] Security headers are present.
- [ ] Supabase Security Advisor has no unresolved security lints.
- [ ] Borrower/loan/EMI counts match expectations.
- [ ] Recycle Bin contains only expected recoverable items.
- [ ] A fresh server snapshot exists.
- [ ] A Full JSON Backup has been downloaded externally.
- [ ] Legacy missing dates have not been auto-guessed.
