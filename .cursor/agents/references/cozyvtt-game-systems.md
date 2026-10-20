# CozyVTT game-system reference

Read `docs/GAME_SYSTEMS.md` and the game-system sections of
`docs/ARCHITECTURE.md`.

A system is a coordinated backend/frontend change: Prisma enum and migration;
backend character type and index; a Zod schema and validator index; starter
templates and template index; frontend enum/type; display metadata and
`GAME_SYSTEM_OPTIONS`; a character-sheet component; and a
`CharacterSheetRouter.tsx` registration. Use the existing systems as patterns,
especially their tests and registration switches.

Schemas are the enforcement point for `Character.data`. Use the shared sheet
text/list limits, keep incremental fields permissive where appropriate, and
ensure every editor-written field is schema-declared and rendered by the view.
The frontend copy of `sheetLimits.ts` must remain byte-identical to the backend
copy. Keeper-only fields are filtered and preserved by the server helpers; UI
hiding is not authorization.

Relevant checks include schema/editor-shape/template/list-limit tests,
`backend/src/__tests__/keepInStep.test.ts`, and the backend/frontend typecheck,
lint, test, and build commands. Add documentation and legal attribution when
the change requires it.
