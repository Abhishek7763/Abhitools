# AbhiTools V2.2 Stable — Recovery Guide

Use this guide if a future deployment, data edit, settings change or device issue causes trouble.

## 1. Before every major change

1. Login to Admin.
2. Open **Release & Recovery**.
3. Create a server snapshot.
4. Download a Full JSON Backup and store it somewhere outside the website.
5. Confirm the current production deployment is healthy before changing files.

## 2. If a new GitHub upload breaks the website

- Do not change Supabase data immediately.
- Check the latest Vercel deployment/build error first.
- If the issue is only frontend/backend code, restore the last known-good GitHub files or use a known-good deployment rollback.
- Keep the API directory at or below the Vercel Hobby function limit. Do not re-add the retired standalone activity/calendar/search API files.

## 3. If database data is wrong

- Stop editing data.
- Open **Import / Restore → Backup History**.
- Select a known-good server snapshot.
- Review the timestamp and counts.
- Restore only after the typed confirmation. The restore workflow creates a safety snapshot of the current state first.

## 4. Settings recovery

- Phase 22 settings are stored in the Supabase `app_settings` table and are admin-only through the server API.
- Backup format v6 snapshots and Full JSON Backups include app settings.
- Restoring a v6 server snapshot restores the settings captured in that snapshot.
- Restoring an older v5 snapshot intentionally preserves the current settings.
- **Reset All Settings** creates a server snapshot before returning settings to defaults.

## 5. Follow-up / PTP recovery

- Phase 23 follow-up and Promise-to-Pay history is stored in `collection_followups`.
- Backup format v7 snapshots and Full JSON Backups include follow-up/PTP history.
- Restoring a v7 snapshot restores the follow-up history captured in that snapshot.
- Restoring an older v6-or-earlier snapshot cannot reconstruct Phase 23 history from that old payload; the restore workflow creates a fresh pre-restore v7 snapshot first, so the current follow-up history remains recoverable from that safety snapshot.
- Marking PTP Kept/Broken/Cancelled never records EMI money. Actual payments must be entered through the payment workflow.

## 6. Full JSON Backup

The Full JSON Backup contains app settings, follow-up/PTP history, borrower, loan, EMI, settlement, payment, document metadata and recycle-bin records. Document file bytes in storage are not embedded in the JSON. Keep important uploaded files backed up separately when applicable.

## 7. Legacy date safety

Do not mass-fill missing years by guessing. Use the Data Quality Center, review each loan, verify the source year/date, preview every generated EMI date, then apply.

## 8. Security recovery

- Never paste deployment secrets into source files.
- Admin credentials and Supabase service credentials belong in Vercel environment variables.
- If a secret is ever exposed publicly, replace it in the provider and redeploy.

## 9. Stable release identity

- Product: AbhiTools / Abhishek Management Tool
- Stable release: V2.2 / 2.2.0
- Backup format: version 7
- Release manifest: `version.json`
- Changelog: `CHANGELOG_V2.md`
