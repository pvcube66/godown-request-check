# Running the hourly check where the site is hosted

The hourly check (read the portal, find unusual requests, follow issues, send reminders) no longer has to run from one person's computer. It can be started three ways. All of them run the same code and take a short lock in the database, so two starts at once never overlap.

## 1. On Vercel today (free)
1. In the Vercel project settings add an environment variable `CRON_SECRET` with a long random value (at least 16 characters; 32+ is better).
2. In the GitHub repository add two secrets (Settings, Secrets and variables, Actions): `CRON_SECRET` (the same value) and `SITE_URL` (for example `https://vivtejhostels.vercel.app`).
3. The workflow `.github/workflows/hourly-check.yml` then calls `POST /api/cron/cycle` at five past every hour. It can also be started by hand from the Actions tab ("Run workflow").
4. `vercel.json` also asks Vercel's own scheduler to call the same address once a day as a backup (the free Vercel plan allows once a day only).
The address refuses every request that does not carry the secret.
Each call has about 40 seconds for the optional catch-up steps (item details, student counts, supplied quantities, suppliers). Anything it does not reach continues on the next call; nothing is lost.

## 2. Hostinger or any server (later)
Run the worker as a long-running service. It starts an hourly schedule (India time) by itself:

    npm ci && npm run build
    npm run worker -- serve

Settings are the same as the website (`MONGODB_URI`, `MONGODB_DB`, `CREDENTIAL_ENC_KEY`, `PORTAL_API_BASE` if changed). Keep it alive with pm2 (`pm2 start "npm run worker -- serve" --name godown-check`) or a systemd unit with `Restart=always`. Nothing else changes when moving the site: stop the GitHub workflow (or leave it, the lock makes it harmless).

## 3. The old way
`scripts/hourly-cycle.sh` from cron on a computer still works. It only runs while that computer is on.

## Checks you can run by hand (read-only)
- `npm run worker -- check-students <hostelCode>`: what the portal's attendance report says for one hostel over the last 7 days.
- `npm run worker -- check-order <requestId>`: asked-for and supplied quantity per item for one order, as the portal gives them.
