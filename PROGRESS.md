# الموقع الجديد — سجل التقدم

Ground-up web rebuild in its own repository. SPEC.md is the specification;
nothing here imports from the old desktop project. Newest entry at the bottom.

## المرحلة 1 — الخريطة والعمليات — 2026-08-07

Status: complete pending owner review

Built:
The whole phase-1 scope of SPEC.md as one standalone package: a Fastify +
node:sqlite server (zero native dependencies, one DB file), shared pure rules,
and an Arabic-only RTL React client where the yard drawing is the interface.
First-run setup (password + yard shape with a live preview), login, the
top-down map with pan/zoom/pinch, gate-in by tapping an empty slot, move by
tap-then-tap-green, gate-out and edit and soft-delete from the container card,
search that lights up the map, and full movement history per container.
57 tests: shared rules, ISO 6346, addresses, map model, and 26 API tests
through `app.inject()`.

Decisions:
- **One slot per container, even for 40 ft.** SPEC.md briefly carried the old
  two-slots-per-40ft model in one sentence; with the yard strictly split into a
  20 half and a 40 half, a 40 slot IS a 40 ft ground position, so the split
  makes the two-slot bookkeeping needless. The map draws 40 cells twice as
  wide — the visible promise is kept; the invisible ledger got simpler.
- **node:sqlite over Prisma/Postgres.** One file database, no native build, no
  container. Synchronous single-writer means every handler transaction is
  serialized by construction — the isolation-level machinery of the old stack
  has nothing left to protect against. Backup = copy one file.
- **A partial unique index backs up the rules**: `(zone,row,col,tier) WHERE
  zone IS NOT NULL AND deleted_at IS NULL`. Even a future code path that skips
  `canPlace` cannot double-book a slot; the error handler translates the
  constraint violation into the same `SLOT_TAKEN` the rules would have given.
- **The same rule functions run on both sides.** `src/shared/rules.ts` is the
  server's authority inside the transaction AND the client's green-target
  painter, so the map can never promise what the server refuses.
- **Sessions are stateless HMAC tokens** (`expiry.signature`), scrypt for the
  password, secrets in the settings table. No session table to clean, nothing
  user-controlled to parse.
- **The wire carries codes, ar.ts carries sentences** — same contract as the
  old system, one file of Jordanian-register Arabic.
- **Tap-vs-drag on the map** is a travelled-distance check (8 px slop), so
  panning never fires a cell tap and a shaky finger on a phone still taps.
- **Tapping an illegal empty cell explains instead of ignoring**: the refusal
  reason appears as a toast (e.g. "ما في حاوية تحت — ما بتنحط بالهوا"), which
  teaches the rules without a manual.
- **15-second polling, not sockets.** Two clerks see each other's work within a
  poll; realtime push is not phase-1 scope and the query layer makes adding it
  later a local change.

Verified: `tsc --noEmit` clean, eslint (the repo's strict config) clean, 57/57
tests, production build 83 KB gzip, and a live smoke test over a real socket:
setup → gate-in 20/40 → stack → NO_SUPPORT and BURIED refusals → move → exit →
history IN→OUT → auth guard → SPA serving → Arabic UTF-8 round-trip.

Known gaps (all deliberate phase-1 scope, per the owner's answers):
- No deployment yet: needs a VPS, a domain and HTTPS. The server already
  serves the built client from one process, so deploy = `pnpm build` + run
  `src/server/index.ts` behind Caddy.
- Excel import (دفتر-الساحة.xlsx) not built yet — next phase, before go-live,
  so the staff's interim records are never retyped.
- No user accounts, reports, notifications or label printing (deferred by the
  owner's explicit choice).
- The login throttle is in-memory per-IP; behind a reverse proxy it needs
  `trustProxy` so it sees real client IPs.
- Nothing has been SEEN rendered in a browser in this environment; the visual
  result rests on the build, the tests and the smoke run.
