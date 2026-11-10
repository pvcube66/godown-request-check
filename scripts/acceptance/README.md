# Acceptance scripts (local only)

These run against a database on **this computer** and refuse to touch anything else (the database name must start with `it_`).
They use made-up data. They never contact the government portal or WhatsApp.

One-time: a local MongoDB that is a replica set (master-data changes use transactions):

    mongod --replSet rs0 --dbpath /some/empty/folder --port 27118 --bind_ip 127.0.0.1 &
    mongosh --port 27118 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27118"}]})'

Then:

    npm test                                          # all automated tests
    npm -w apps/web run build
    npx tsx scripts/acceptance/seed.mts it_accept     # made-up districts, hostels, orders, flags, issues, logins
    scripts/acceptance/start-local-web.sh it_accept   # starts the app on http://127.0.0.1:3199 against that database only
    npx tsx scripts/acceptance/check-access.mts       # about 90 role and district-limit checks, prints PASS/FAIL
    npx tsx scripts/acceptance/load-check.mts         # 25,000 orders: how long the main screens' calculations take

The test logins created by the seed are listed in `seed.mts` (they exist only in the local test database).
