ABHITOOLS V2.1 STABLE — FULL RELEASE
Release date: 2026-08-24

This package is a full source snapshot of the stable Phase 1–22 application.

DEPLOYMENT NOTES
1. Use the repository root structure exactly as packaged.
2. Keep existing Vercel environment variables configured in the project; secrets are not included here.
3. Vercel Hobby serverless function budget is 12. The api/ folder in this release contains exactly 12 functions.
4. Do NOT re-add retired api/activity.js, api/calendar.js, or api/search.js. Those routes are consolidated through api/dashboard.js + server_routes/.
5. Phase 22 adds server-side app_settings and backup format v6; production Supabase migrations are recorded under supabase/migrations/.
6. Before any future major update, create a server snapshot and download a Full JSON Backup from Admin → Release & Recovery.

REFERENCE
- version.json: machine-readable release identity
- CHANGELOG_V2.md: feature summary
- RECOVERY_GUIDE.md: recovery workflow
- RELEASE_CHECKLIST.md: future release verification
- RELEASE_FILE_HASHES_SHA256.txt: source integrity hashes
