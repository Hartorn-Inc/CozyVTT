# CozyVTT architecture reference

Read the source docs for detail: `docs/ARCHITECTURE.md`,
`docs/CONTRIBUTING.md`, and `docs/DEVELOPMENT.md`.

## Backend

The backend is Node.js/TypeScript, Express 5, Socket.io, Prisma 7, PostgreSQL,
and Zod. `src/app.ts` is the single application assembly point. HTTP routes in
`src/routes/` parse requests and format responses; business logic belongs in
`src/services/`; authentication, campaign RBAC, rate limits, uploads, and
other request gates belong in `src/middleware/`; request schemas belong in
`src/validators/`; configuration belongs in `src/config/`. Prisma access uses
the shared clients in `src/config/`, and schema changes require migrations.

Every protected action is authorized server-side. Campaign role comes from the
membership for the path `:campaignId`, never from the request body. Routes
should compose the existing guards, validate bodies with Zod, avoid sensitive
logging, and test new routes in the route inventory.

## Frontend

The frontend is React 19 + Vite + TypeScript strict mode. Pages in
`frontend/src/pages/` are thin; reusable UI is in `components/`; REST calls go
through `services/api.ts` or `auth.service.ts`; React Query owns REST-fetched
server resources; `contexts/` owns app/session wiring and low-frequency
metadata; Zustand `stores/gameStore.ts` owns live socket-fed table state.
Do not represent one datum in more than one state layer.

Themed UI uses semantic CSS/Tailwind tokens from `frontend/src/index.css` and
`themes.ts`, never raw palette colors on themed surfaces. Use the shared UI
primitives, strict types, and no `any`.

## Scope boundaries

Live table internals are the WebSocket handlers, `frontend/src/stores/gameStore.ts`,
map rendering/state, and `services/socket.ts`. Game-system work includes both
backend validators/types/templates and frontend character-sheet files. Docker,
nginx, scripts, `.github/`, dependency policy, and production packaging are
ops work. Do not import architecture, tools, or terminology from other
repositories.
