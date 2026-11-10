# Hand-over notes (for the person who will run this)

**Status:** the parts that do not depend on the client's server are written here. Moving to the client's server (Phase 10) waits for the hosting details.

## What runs where today
- **Web app** (`apps/web`, Next.js): the dashboard. Built with `npm -w apps/web run build`, started with `npm -w apps/web run start` (port 3100).
- **Hourly job** (`apps/worker`): `npm run worker -- serve` runs once at start and then every hour (India time). It logs into each godown, reads the portal (read-only), finds unusual requests, follows issues, reads supplied quantities and suppliers, and sends WhatsApp reminders if switched on. `npm run worker -- cycle` runs one pass and exits.
- **Database**: MongoDB (must be a replica set or Atlas: master-data changes use transactions).
- The system **never writes to the government portal**.

## Settings (environment variables, in `.env` at the repo root, or the server's secret store)
| Name | What it is |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | the database |
| `CREDENTIAL_ENC_KEY` | 64 hex characters; encrypts godown passwords and WhatsApp keys. **Do not lose it**: without it stored passwords cannot be read. |
| `DASHBOARD_PASSWORD` | the emergency login (`admin` + this password) and part of what signs sessions. Changing it signs everyone out. |
| `PORTAL_API_BASE` | the portal's API address |
| `COOKIE_INSECURE=1` | only for testing over plain http; never in production |

WhatsApp keys are entered on the WhatsApp page, not in the environment.

## Everyday jobs
- **Add a godown**: Godowns page → add the portal login and password (admin). Then Master data → assign its districts.
- **Add a person**: Users page.
- **Morning check (one minute)**: first page has no red bar; Godowns shows all "Working"; Issues "overdue" count; WhatsApp page shows no error line.
- **Is the hourly job alive?** `GET /api/health` returns 200 while the last good check is under 2 hours old, otherwise 503. Point an uptime monitor at it.
- **Backups**: `scripts/backup.sh` (needs `mongodump`); schedule nightly; keep a copy off the machine. Restore line is at the bottom of the script. Atlas also has its own backups.
- **Full copy of the data** for the year-end hand-over: Full copy page (Excel).

## Updating
Pull the new code, `npm install`, `npm test`, `npm -w apps/web run build`, restart the web app and the hourly job. Database indexes are created on start. Never run tests against the real database; use `scripts/acceptance/` (see its README).

## Still to do when hosting details arrive (Phase 10)
Move web app, hourly job and database; HTTPS and a reverse proxy; run the hourly job as a managed service that restarts itself; decide where backups go; run both old and new for a few days and compare counts; then switch the address. Keep the current Vercel site as a fallback until sign-off.
