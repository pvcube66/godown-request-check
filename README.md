# Godown Request Check

Watches goods requests from hostels to a godown on the Telangana welfare portal and flags requests that are
much bigger than they should be: a jump against the hostel's own history, a mismatch with hostels of a similar
size (per student), the same big number typed for many items, a typed extra zero, or a whole order that is far
too large for the number of students.

- `packages/core`  login, portal client, database, detector (the logic lives in `detector.ts`)
- `apps/worker`    hourly job (`npm run worker -- cycle` or `serve`) and the detector benchmark
- `apps/web`       dashboard (`npm run web`, password in `.env`)

## Measuring the detector
`npm run worker -- bench` plants known mistakes into the real data and reports how many are caught, how many
false alarms normal noise causes, and which requests cannot be judged at all.
`npm run worker -- sweep` tries many settings and prints the same measures side by side.
Run `npm run worker -- bench` after changing anything in `detector.ts`.

Nothing in the detector names a hostel, item or value: everything is learned from the data each time.
