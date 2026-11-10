#!/bin/bash
# Starts the BUILT web app on http://127.0.0.1:3199 against a LOCAL test database only.
# The database address is given here, on the command line, so the app can never fall back to the real one in .env.
#   npm -w apps/web run build && scripts/acceptance/start-local-web.sh [dbName]
set -e
cd "$(dirname "$0")/../.."
DB=${1:-it_accept}
case "$DB" in it_*|test_*|accept*) ;; *) echo "Refusing: '$DB' does not look like a test database"; exit 1;; esac
DP=$(grep '^DASHBOARD_PASSWORD=' .env | cut -d= -f2-); CK=$(grep '^CREDENTIAL_ENC_KEY=' .env | cut -d= -f2-)
mkdir -p /tmp/opencode
tmux kill-session -t web-accept 2>/dev/null || true
tmux new-session -d -s web-accept "cd $(pwd)/apps/web && MONGODB_URI='mongodb://127.0.0.1:27118/?replicaSet=rs0' MONGODB_DB=$DB DASHBOARD_PASSWORD='$DP' CREDENTIAL_ENC_KEY='$CK' COOKIE_INSECURE=1 PORTAL_API_BASE=http://127.0.0.1:9 npx next start -p 3199 2>&1 | tee /tmp/opencode/web-accept.log"
sleep 5; tail -2 /tmp/opencode/web-accept.log
