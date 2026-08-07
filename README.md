# ساحة العقبة — الموقع

Arabic web app for the Aqaba container yard. `SPEC.md` is the specification,
`PROGRESS.md` the session log, `CLAUDE.md` the working rules. This repository
stands alone — it imports nothing from any other project.

## Run it

```bash
pnpm install

# development — Vite on :5180, API on :8787, /api proxied
pnpm dev

# production — one process serves the API and the built client
pnpm build
pnpm start          # http://localhost:8787
```

The database is one SQLite file, `data/yard.db` by default (`YARD_DB`
overrides). Backup = copy the file. `PORT` and `HOST` override the listener.

First visit walks through setup: one site password plus the yard's shape.
To reset a forgotten password: stop the server and delete the `password` row
from the `settings` table — the next visit runs setup again (the yard and
containers are untouched).

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
```
