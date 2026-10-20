# CozyVTT verification commands

Use commands from the package manifests and `docs/DEVELOPMENT.md`. Do not use
`npm test` for a one-shot frontend run: it starts Vitest watch mode.

## Backend

From `backend/`:

```bash
npm run build
npx tsc --noEmit
npm run lint
npx prisma generate
DATABASE_URL=postgresql://cozyvtt:cozyvtt@localhost:55500/cozyvtt_test npx jest
```

Backend integration tests require a database whose name contains `test`.

## Frontend

From `frontend/`:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

## Documentation and full gates

From the repository root:

```bash
python3 scripts/spec-coverage.py
python3 scripts/websocket-events.py --check
python3 -m unittest discover -s scripts/tests
```

If WebSocket handlers changed, refresh the generated event inventory with
`python3 scripts/websocket-events.py --write`, then run its check. Do not
commit, reset, clean, or alter a plan as part of verification.
