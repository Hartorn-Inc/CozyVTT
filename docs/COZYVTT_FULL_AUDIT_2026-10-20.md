# CozyVTT full code audit

Date: 2026-10-20

Branch: `chore/cursor-agents`

Commit: `b3062ee3`

Pull request: [#22](https://github.com/Hartorn-Inc/CozyVTT/pull/22)

Disposition: read-only audit. No application files, issues, or fixes were
created during the audit.

## Scope and method

The audit covered:

- Backend routes, services, middleware, validators, Prisma schema and
  migrations, scripts, and tests.
- Frontend pages, components, contexts, hooks, services, stores, themes,
  character sheets, browser tests, and accessibility behavior.
- Socket.io handlers, map state, vision filtering, fog, exploration,
  initiative, reconnect behavior, and client/server parity.
- Game-system registration, schemas, templates, derived values, limits, and
  Keeper-only fields.
- Docker Compose, Dockerfiles, nginx, CI, scripts, backups, dependency policy,
  and deployment documentation.
- Architecture, standards, specification parity, dead code, design, and
  GM/DM, player, spectator, and admin workflows.
- Open GitHub issues and the current pull-request checks.

The following specialist audits ran in parallel:

- `backend-reviewer`
- `frontend-reviewer`
- `realtime-reviewer`
- `game-systems-reviewer`
- `infra-reviewer`
- `architecture-reviewer`
- `security-reviewer`
- `standards-reviewer`
- `spec-parity-reviewer`
- `accessibility-reviewer`
- `design-reviewer`
- `user-advocate`
- A repository-wide dead-code and issue sweep

Findings are consolidated where several reviewers identified the same defect.
Each item retains representative evidence and is classified as a confirmed
defect, a likely risk requiring a focused test, a pattern gap, or an
informational cleanup item.

## Executive summary

The repository has strong baseline coverage:

- Frontend typecheck, lint, and 2,549 Vitest tests pass.
- Backend lint and typecheck pass after generating the Prisma client.
- API and WebSocket documentation inventories are structurally aligned.
- The pull request's six GitHub checks pass.
- Authentication, uploads, normal RBAC, Keeper filtering on tested character
  paths, parity files, and several security boundaries have substantial tests.

The audit nevertheless found high-impact gaps outside those gates:

1. Authorization and session state are checked before asynchronous work but not
   always rechecked before mutation or fan-out.
2. REST and WebSocket paths do not always share the same validation,
   authorization, and filtering rules.
3. Several frontend asynchronous responses can overwrite newer campaign or
   character state.
4. Important live-table and sheet interactions are inaccessible by keyboard or
   unavailable on narrow screens.
5. Error states frequently render as successful empty states.
6. Several documented patterns are present as TODOs but are not enforced by
   tests or shared abstractions.
7. Dead and contradictory helpers remain exported, creating competing sources
   of truth.

## Verification performed

### Passed

- Backend lint:
  `cd backend && npm run lint`
- Backend typecheck:
  `npx prisma generate && cd backend && npx tsc --noEmit`
- Frontend typecheck:
  `cd frontend && npm run typecheck`
- Frontend lint:
  `cd frontend && npm run lint`
- Frontend tests:
  `cd frontend && npm run test:run`
  - 262 test files passed.
  - 2,549 tests passed.
- Documentation checks:
  - 161 mounted HTTP routes matched the API catalogue.
  - 138 frontend API requests were present in the catalogue.
  - 43 inbound and 48 outbound WebSocket events were listed.
  - 21 Python documentation/check tests passed.
- Pull request checks:
  - Backend
  - Frontend
  - Docs
  - Dependency advisories
  - Production images, nginx, and smoke tests
  - Zizmor

### Blocked or incomplete

- Backend Jest integration tests were started with the documented test
  database URL but PostgreSQL was unavailable at `127.0.0.1:55500`. The run
  was stopped after repeated connection failures; this is an environment
  limitation, not a product test result.
- A broad export-reference scan was terminated before completion.
- Static parity and documentation checks do not prove behavior under concurrent
  role changes, session expiry, reconnects, map changes, or database races.

## Findings: security, authorization, and data integrity

### High: WebSocket authorization survives session expiry or revocation

After a socket authenticates, handlers trust cached `socket.campaignId`,
`socket.role`, and user state. Session liveness is checked during
authentication, but not consistently before later gameplay events.

Evidence:

- `backend/src/websocket/events.ts:104-110,207-215`
- `backend/src/websocket/handlers/dice.ts:23-37`
- `backend/docs/WEBSOCKET_DOCUMENTATION.md:180-190`

Impact: a socket whose HTTP session expired, was capped, or was revoked may
continue sending chat, dice, token, or DM events.

Required follow-up: add a focused session-expiry/revocation integration test,
then decide whether each event must revalidate the session or whether the
server must actively terminate affected sockets.

### High: Campaign DM authorization has a time-of-check/time-of-use race

`campaignDM` loads the caller's role before the route runs. Several mutating
transactions do not recheck the caller's membership or role before writing.

Evidence:

- `backend/src/middleware/rbac.ts:60-80`
- `backend/src/routes/campaigns.ts:970-1000,1074-1104`

Impact: a caller demoted during an in-flight request may complete a mutation
that should now be forbidden.

### High: Token movement authorizes stale state

`token.move.end` checks token ownership, role, session status, current map, and
related state before asynchronous work. The locked write refreshes the token
array and position but does not recheck all authorization facts.

Evidence:

- `backend/src/websocket/handlers/tokens.ts:430-460,500-534`

Impact: demotion, session revocation, map changes, control changes, or layer
changes during the await window can leave an unauthorized move committed.

### High: Current-map fan-out has a TOCTOU leak

`map.change` checks the current map once, while `broadcastMapData` later sends
the supplied map without rechecking that it remains current.

Evidence:

- `backend/src/websocket/handlers/maps.ts:30-51`
- `backend/src/websocket/shared.ts:448-470`

Impact: a concurrent map switch can send an old map and its filtered tokens to
players.

### High: Session storage can diverge under a custom PostgreSQL schema

Prisma translates `?schema=` into the configured search path, but
`connect-pg-simple` receives the raw `DATABASE_URL` and uses the public schema.
Raw Prisma session queries therefore may target a different `session` table
than Express.

Evidence:

- `backend/src/config/session.ts:15-24`
- `backend/src/config/prismaClient.ts:38-75`
- `backend/src/services/sessionStore.ts:40-50`

Impact: logout, password reset, session revocation, session capping, and
online-user reporting can operate on different session stores.

### High: Password changes can commit before session revocation

Password updates occur before `destroyUserLoginSessions()`. If revocation
fails, the password change remains committed while existing sessions remain
active.

Evidence:

- `backend/src/routes/users.ts:639-659`
- `backend/src/routes/auth.ts:540-579,639-659`
- `backend/src/services/sessionStore.ts:35-50`
- `backend/src/middleware/passwordChange.ts:39-60`

The same ordering risk applies to MFA enable/disable and reset-link password
changes.

### Medium: Admin MFA reset does not revoke existing sessions or sockets

The admin MFA reset path clears MFA fields without destroying the target's
sessions or ending the target's live sockets.

Evidence:

- `backend/src/routes/admin.ts:640-683`
- `backend/src/routes/__tests__/adminRoutes.e2e.test.ts:292-308`

Impact: an existing session or socket can continue using access while MFA is
being reset.

### Medium: Admin MFA policy fails open on policy/database errors

The HTTP and WebSocket admin-MFA gates allow access when the policy check
encounters a database error.

Evidence:

- `backend/src/middleware/adminMfa.ts:52-55`
- `backend/src/services/adminMfaPolicy.ts:150-166`
- `backend/src/websocket/auth.ts:76-84`
- `backend/src/websocket/__tests__/adminMfaDeadlineSocket.integration.test.ts:115-128`

This is currently tested behavior, so changing it requires an explicit
security decision rather than an incidental refactor.

### High: Direct character creation bypasses game-system compatibility

`POST /api/characters` checks campaign membership but does not call the same
compatibility rule used by assignment and invitation flows.

Evidence:

- `backend/src/routes/characters.ts:136-170`
- `backend/src/routes/characters.ts:1088-1100`
- `backend/src/routes/invitations.ts:130-139`

Impact: a Pathfinder character can be created directly in a D&D campaign.

### Medium: Character assignment keeps duplicated state non-atomically

Character campaign membership is represented both by `Character.campaignId` and
`CampaignMembership.characterIds`. Assignment and unassignment do not always
update both representations in one transaction.

Evidence:

- `backend/prisma/schema.prisma:250-266,400-422`
- `backend/src/routes/characters.ts:990-1020,1100-1151`

Impact: concurrent or partially failed operations can leave characters listed
in one campaign representation but not the other.

### High: Keeper's Notes can leak through public character templates

Character template reads return template data without applying the
Keeper-only filtering used by character reads and WebSocket paths.

Evidence:

- `backend/src/routes/characterTemplates.ts:230-240`
- `backend/src/routes/characterTemplates.ts:260-299,340-370`
- `backend/src/utils/keeperNotes.ts:22-64`

Impact: a published Call of Cthulhu template can expose Keeper-only notes to
authenticated users.

### Medium: WebSocket character writes bypass the Zod sheet boundary

Character HP and hit-die WebSocket handlers write modified JSON without
applying the full game-system schema. Fractional or otherwise invalid values
can enter through the socket while REST saves reject them.

Evidence:

- `backend/src/websocket/handlers/characters.ts:100-152,229-235`
- `backend/src/validators/game-systems/`

### Medium: Character copying bypasses migration and schema parsing

Character copy operations copy the original JSON directly rather than applying
the current migration and schema parsing path.

Evidence:

- `backend/src/routes/characters.ts:1223-1237`

Impact: legacy fields, over-limit lists, unknown keys, or malformed data can
survive into the copied character.

### Medium: Character copy names revert on first save

The database column receives a suffixed copy name while the copied sheet keeps
the original sheet name. The normal save path then synchronizes the column
from the sheet.

Evidence:

- `backend/src/routes/characters.ts:1227-1232`
- `backend/src/routes/characters.ts:662-675`

### Medium: Asset metadata bypasses the canonical read policy

`GET /api/assets/:id` implements partial scope checks instead of delegating to
`canReadAsset()`. A campaign asset whose campaign has been deleted can pass
the metadata route because `campaignId` is null.

Evidence:

- `backend/src/routes/assets.ts:550-600`
- `backend/src/services/permissions.ts:640-667`

Impact: authenticated users who know the asset ID may read metadata from an
orphaned campaign asset.

### Low: Cross-campaign WebSocket ping injection

`map.ping` does not verify that the supplied map belongs to the authenticated
campaign.

Evidence:

- `backend/src/websocket/handlers/pings.ts:39-52`
- `backend/src/websocket/utils.ts:145-169`

Impact is currently reduced because clients ignore non-current maps, but the
event still carries a foreign map ID and coordinates to recipients.

### Medium: Exploration memory can be read for former members

Exploration rows survive membership removal, but the request path accepts an
arbitrary user ID without verifying that the user is still a campaign member.

Evidence:

- `backend/src/websocket/handlers/exploration.ts:206-230`
- `backend/prisma/schema.prisma:523-535`

### Medium: Exploration reset can be undone by an in-flight write

Reset clears queued cells and deletes rows but does not cancel a writer already
holding `writing = true`.

Evidence:

- `backend/src/websocket/handlers/exploration.ts:80-140,260-264`
- `backend/src/websocket/__tests__/explorationWrites.integration.test.ts:140-154`

### Medium: Initiative roll visibility ignores dynamic lighting

Initiative token recipient checks filter role, plane, and current map, but do
not apply dynamic-lighting visibility before sending token names and roll data.

Evidence:

- `backend/src/websocket/handlers/initiative.ts:45-69,530-538`
- `backend/src/websocket/__tests__/initiativeProjection.integration.test.ts:59-80`
- `backend/docs/WEBSOCKET_DOCUMENTATION.md:763-764`

### Medium: Secret dice data is logged

Secret dice expressions/results and initiative token details are written to
server logs.

Evidence:

- `backend/src/websocket/handlers/dice.ts:144-145`
- `backend/src/websocket/handlers/initiative.ts:543-544`

### Medium: Account deletion can break shared personal assets

A personal asset used by a campaign can remain after its uploader is deleted,
but the subsequent read policy rejects the asset because the uploader is null.

Evidence:

- `backend/src/services/accountDeletion.ts:147-160`
- `backend/src/services/permissions.ts:510-528,640-653`

### Medium: Concurrent session starts can duplicate session numbers

Session start checks status, calculates a number, creates a session, and updates
the campaign in separate operations. The schema has no per-campaign session
number uniqueness constraint.

Evidence:

- `backend/src/routes/campaigns.ts:1890-1934`
- `backend/src/services/sessionState.ts:90-111`
- `backend/prisma/schema.prisma:380-397`

### Medium: Upload rate limiting accepts unsafe `NaN`

`ASSET_UPLOAD_RATE_LIMIT=invalid` becomes `NaN` instead of using the shared
positive-integer environment parser.

Evidence:

- `backend/src/routes/assets.ts:63-75`
- `backend/src/config/env.ts:8-29`

### Medium: Restore archive extraction can leak file descriptors

Stopping an archive entry stream midway can leave the archive file open.
Repeated refusal paths can accumulate descriptors.

Evidence:

- `backend/src/utils/archive.ts:99-112`

### Medium: Search wildcards are not escaped

The following endpoints pass `%` and `_` through to `contains` search:

- `backend/src/routes/assets.ts:180-222`
- `backend/src/routes/creatures.ts:117-149`
- `backend/src/routes/characterTemplates.ts:190-200`
- `backend/src/routes/tokenTemplates.ts:39-45`

Impact: literal search characters behave as wildcards instead of literal input.

### Medium: Repeated query parameters can produce 500 responses

Several query parsers cast repeated query values to strings instead of
rejecting arrays with a 400 response.

Evidence:

- `backend/src/routes/assets.ts:180-222`
- `backend/src/routes/creatures.ts:117-149`
- `backend/src/routes/characterTemplates.ts:190-200`
- `backend/src/routes/tokenTemplates.ts:39-45`

### Medium: Raw request bodies bypass documented Zod boundaries

The architecture requires request bodies to be validated at route boundaries,
but several routes read raw body values, including maps, session ending, role
changes, vibe updates, user updates, and admin account creation.

Evidence:

- `backend/src/routes/maps.ts:253-288,1265-1301,1470-1609`
- `backend/src/routes/campaigns.ts:2050-2088`
- `backend/src/routes/users.ts`
- `backend/src/routes/admin.ts`

### Medium: Session-ending route accepts arbitrary values

The session-ending route coerces `saveState` and `notes` instead of applying the
documented schema. Objects become `"[object Object]"`, non-boolean values can
be truthy, and notes are truncated silently.

Evidence:

- `backend/src/routes/campaigns.ts:2045-2090`
- `backend/src/routes/__tests__/routeInventory.test.ts:181-190`

### Low: Dice division by zero returns `Infinity` or `NaN`

The dice parser does not reject division by zero.

Evidence:

- `backend/src/utils/dice-parser.ts:258-265`
- `backend/src/utils/dice-parser.test.ts`

### Low: Registration sanitizes email after validation

An address such as `jo<x>@example.com` can be stored differently from the
submitted value and cannot be used to sign in consistently.

Evidence:

- `backend/src/services/auth.ts:121-129`

## Findings: realtime state and live-table correctness

### High: REST responses can overwrite newer realtime state

Campaign and map REST responses write state unconditionally after awaits.
Reconnect catch-up has a generation check in one path but ordinary load and map
refresh paths do not have the same protection.

Evidence:

- `frontend/src/contexts/CampaignContext.tsx:188-240`
- `frontend/src/contexts/CampaignContext.tsx:272-282`
- `frontend/src/contexts/CampaignContext.tsx:294-320`

### Medium: Delayed token events can affect the wrong displayed map

`token.moved` handling does not verify `event.mapId` against the currently
displayed map before mutating or animating token state.

Evidence:

- `frontend/src/components/campaign/MapCanvas.tsx:972-1004`

### Medium: Ambient atmosphere/audio uses unsynchronized read-modify-write

Atmosphere and audio updates modify the whole `vibeSettings` JSON object without
serialization.

Evidence:

- `backend/src/services/atmosphereAudio.ts:64-80`
- `backend/src/websocket/handlers/atmosphere.ts:36-49`

### Low: Map ping broadcasts directly to the room during transitions

`emitToMapReaders` can broadcast to the whole room when a current-map lookup
and room transition overlap, instead of using the per-socket filtering path.

Evidence:

- `backend/src/websocket/utils.ts:154-166`

### Medium: Fog operations have no maximum cell-array length

Fog validation has no equivalent maximum array size to exploration reports.

Evidence:

- `backend/src/validators/walls.ts:90-100`

### Informational: Client exposes dead Socket.io event APIs

The frontend exposes `sync.request`, `sync.state`, and session events that have
no corresponding backend handlers; sessions are REST-only.

Evidence:

- `frontend/src/services/socket.ts:448-464,563-573`

### Informational: Socket reconnect listeners are attached to the wrong object

`SocketClient` listens for manager reconnect events on the Socket object. A
separate `WebSocketContext` contains the working Manager implementation, so the
impact is partly masked.

Evidence:

- `frontend/src/services/socket.ts:300-316`
- `frontend/src/contexts/WebSocketContext.tsx:176-201`

### High: Initiative rolls are not persisted

Initiative roll writes token initiative and broadcasts dice data but does not
create a `DiceRoll` history row.

Evidence:

- `backend/src/websocket/handlers/initiative.ts:510-540`
- `backend/src/routes/campaigns.ts:1510-1590`

## Findings: frontend correctness and user workflows

### Blocker: Imported campaigns navigate to a nonexistent route

The import success action navigates to `/campaign/:id`, while the router defines
`/campaigns/:id`.

Evidence:

- `frontend/src/components/campaign/CampaignImportDialog.tsx:330-333`
- `frontend/src/App.tsx:104-112`

### High: Campaign and character loads have stale-response races

Slow responses from a previous campaign or character can overwrite the state
for the newly selected route.

Evidence:

- `frontend/src/contexts/CampaignContext.tsx:180-255`
- `frontend/src/pages/CharacterEditorPage.tsx:68-129`

The character editor also performs a duplicate permission request and falls
back to owner-only access when that request fails.

### High: Chat messages can remain permanently optimistic

Chat emits without acknowledgement or resend handling. A disconnect during send
leaves an optimistic message in a sending state indefinitely.

Evidence:

- `frontend/src/components/campaign/ChatPanel.tsx:400-450`
- `docs/FUTURE_FEATURES.md:80-88`

### Medium: Asset search only searches the current page

The API supports search, but the asset library filters only the currently
loaded page and reports counts as if they described the entire library.

Evidence:

- `frontend/src/pages/AssetLibraryPage.tsx:64-121,308-318`
- `frontend/src/services/api.ts:893-900`
- `docs/FUTURE_FEATURES.md:74`

### Medium: Dashboard and roster errors look like empty data

Failed character, invitation, campaign, and roster requests fall through to
messages such as “No characters yet” or “No members yet”.

Evidence:

- `frontend/src/pages/DashboardPage.tsx:47-67,200-250,450-480`
- `frontend/src/pages/CharactersPage.tsx:273-300`
- `frontend/src/components/campaign/CampaignRoster.tsx:43-68,300-310`

### Medium: Campaign load errors offer no retry

The campaign page offers only a dashboard escape after a load failure.

Evidence:

- `frontend/src/pages/CampaignPage.tsx:230-260`

### Medium: Campaign settings refresh disrupts the live table

Saving settings reloads the entire campaign, triggers a page-level spinner,
refetches token assets, and resets the settings tab.

Evidence:

- `frontend/src/contexts/CampaignContext.tsx:260-269`
- `docs/FUTURE_FEATURES.md:84-88`

### Medium: Map visibility failures can be silent

Hide/reveal, obscure, or plane-transfer actions close the menu even when the
server rejects the request.

Evidence:

- `frontend/src/components/campaign/MapCanvas.tsx:4270-4288,4302-4351`

### Medium: Map export failures are invisible

The map manager can download an error response without reporting the server
failure to the DM.

Evidence:

- `frontend/src/components/campaign/MapManager.tsx:374-390`

### Medium: Campaign permissions are presented inconsistently

Handed-over DMs can see owner-only danger-zone actions, and asset cards omit
actions available to the campaign DM.

Evidence:

- `frontend/src/components/campaign/CampaignSettingsModal.tsx:277-300`
- `frontend/src/components/assets/AssetCard.tsx:40-46`
- `frontend/src/components/assets/AssetDetailPanel.tsx:80-90`
- `docs/FUTURE_FEATURES.md:60-65`

### Medium: Campaign descriptions can fail to clear

The UI reports success when an empty description may not be sent as the null
value required to clear the server field.

Evidence:

- `frontend/src/components/campaign/CampaignSettingsModal.tsx:126-133`

### Medium: Character creation promises a redirect that does not occur

The new-character flow says it will enter the editor, but the page callback
only updates the library list.

Evidence:

- `frontend/src/components/character/NewCharacterModal.tsx:430-435`
- `frontend/src/pages/CharactersPage.tsx:65-69`

### Medium: Gallery roll controls are no-ops without a socket

Character sheet viewers outside a live campaign can render rollable-looking
stats, but the handler silently does nothing when no socket exists.

Evidence:

- `frontend/src/components/character/CharacterSheetViewerModal.tsx:180-198`

### Medium: Character owner names can show as “Unknown Player”

The viewer requests a user endpoint that is not available to DMs instead of
using campaign roster data.

Evidence:

- `frontend/src/components/character/CharacterSheetViewerModal.tsx:72-90`

### Medium: Spectators see active dice controls

Spectator rejection exists, but quick-roll buttons and the main roll button
remain enabled.

Evidence:

- `frontend/src/components/campaign/DiceRoller.tsx:490-499,780-810,920-930`

### Medium: Local storage access can crash the campaign page

Session sidebar reads and writes localStorage without a guarded fallback.

Evidence:

- `frontend/src/components/campaign/SessionSidebar.tsx:30-63`

### Low: Clipboard actions fail silently on HTTP

Admin copy uses `navigator.clipboard` directly despite an existing fallback
utility.

Evidence:

- `frontend/src/pages/AdminPage.tsx:626-638`
- `frontend/README.md:27-29`

### Low: Toast timers restart on unrelated renders

The toast dismissal callback is recreated on each render, restarting timeout
effects when the queue changes.

Evidence:

- `frontend/src/components/common/ToastContainer.tsx:15-21,100-108`

### Informational: Duplicated toast systems

The global toast queue and local `Toast` instances differ in stacking,
dismissal, and timing behavior.

Evidence:

- `frontend/src/App.tsx:65-79`
- `frontend/src/components/common/ToastContainer.tsx:91-109`
- Asset Library, Campaign Roster, Map Canvas, Session Controls, and campaign
  modal components

## Findings: accessibility

### High: Global skip link targets missing landmarks

The application skip link targets `#main-content`, but that ID is missing on
several routes, including Campaign, Documents, Register, MFA, Setup Wizard,
Character Editor, and Welcome.

Evidence:

- `frontend/src/App.tsx:68-77`

### High: Slide-over panels lack dialog semantics

Campaign settings, map/token/creature/template managers, atmosphere, spirit
controls, NPC editor, and asset detail panels lack consistent dialog roles,
`aria-modal`, labelled headings, focus trapping, and focus restoration.

Evidence:

- `frontend/src/components/campaign/CampaignSettingsModal.tsx:240-251`
- `frontend/src/components/campaign/AtmospherePanel.tsx:205-217`
- `frontend/src/components/campaign/MapManager.tsx:553-561`
- `frontend/src/components/campaign/TokenManager.tsx:350-370`
- `frontend/src/components/assets/AssetDetailPanel.tsx:217-255`

### High: Focus trap overrides intentional autofocus

The shared focus trap always focuses the first control, overriding an
intentional autofocus field. An existing test codifies the current behavior.

Evidence:

- `frontend/src/hooks/useFocusTrap.ts:42-55`
- `frontend/src/test/dialogFocus.test.tsx:43-52`

### High: Core map and DM actions are pointer-only

Panning, token movement, wall/light/fog editing, ruler/AoE placement, context
menus, avatar cropping, DM tool dragging, and several controls have no
keyboard-equivalent interaction.

Evidence:

- `frontend/src/components/campaign/MapCanvas.tsx:3302-3334,4090-4100`
- `frontend/src/pages/ProfilePage.tsx:198-207`
- `frontend/src/components/campaign/DmFogControls.tsx:77-88`
- `frontend/src/components/campaign/DmWallControls.tsx:113-125`
- `frontend/src/components/campaign/DmLightControls.tsx:176-190`

### High: Initiative editing and reordering exclude keyboard users

Initiative rows use native drag behavior without keyboard reordering, values
are edited through clickable spans, and icon buttons rely on titles.

Evidence:

- `frontend/src/components/campaign/InitiativeTracker.tsx:197-210,260-300`

### High: Non-semantic clickable cards and nested controls

Dashboard cards, invitation cards, and roster character rows use clickable
`div` elements without keyboard semantics. `CharacterCard` contains a nested
menu button inside a parent button-like element.

Evidence:

- `frontend/src/pages/DashboardPage.tsx:202-220,400-421`
- `frontend/src/components/campaign/CampaignRoster.tsx:535-555`
- `frontend/src/components/character/CharacterCard.tsx:90-110`

### High: Form labels and validation errors are inconsistently associated

Representative failures occur in registration, setup wizard, MFA verification,
profile, admin search, asset search, dice roller, and custom roll inputs.

Evidence:

- `frontend/src/pages/auth/RegisterPage.tsx:320-350`
- `frontend/src/pages/SetupWizardPage.tsx:491-630`
- `frontend/src/pages/MFAVerifyPage.tsx:170-202`
- `frontend/src/pages/MFASetupPage.tsx:263-289`
- `frontend/src/pages/ProfilePage.tsx:740-890`
- `frontend/src/pages/AdminPage.tsx:1195-1205`
- `frontend/src/pages/AssetLibraryPage.tsx:214-272`
- `frontend/src/components/campaign/DiceRoller.tsx:855-890`

### High: Character sheet editors contain unlabeled and pointer-only controls

Death-save checkboxes, sheet fields, list/table controls, delete actions, and
drag reordering lack complete names, focus-visible behavior, or keyboard
alternatives.

Evidence:

- `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx:1890-1924`
- `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx:895-915`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx:660-720`
- `frontend/src/components/character-sheets/flexible/ListEditor.tsx:50-83`
- `frontend/src/components/character-sheets/flexible/SectionEditor.tsx:30-50`

### High: Custom menus and roll pickers lack menu/focus semantics

Map menus, character action menus, door menus, and roll pickers use floating
containers without consistent menu/dialog roles, focus placement, focus return,
or labelled close controls.

Evidence:

- `frontend/src/components/campaign/MapCanvas.tsx:4090-4100`
- `frontend/src/components/character/CharacterRollPicker.tsx:230-281`
- `frontend/src/components/campaign/NpcRollPicker.tsx:170-220`
- `frontend/src/components/character/CharacterCard.tsx:120-180`

### High: Switch controls lack accessible names

Several `role="switch"` controls rely on nearby visual text without
`aria-label` or `aria-labelledby`.

Evidence:

- `frontend/src/components/campaign/CampaignSettingsModal.tsx:398-410,450-470`
- `frontend/src/pages/AdminPage.tsx:1994-2030`
- `frontend/src/components/campaign/CampaignImportDialog.tsx:250-267`

### High: Theme-dependent contrast failures

Raw colors and plain fill tokens are used as text in shared UI and DM
overlays. The theme test does not scan all CSS, `white`, `black`, or every
semantic fill-token text combination.

Evidence:

- `frontend/src/index.css:80-105`
- `frontend/src/components/ui/Field.tsx:50-63`
- `frontend/src/components/campaign/SessionToolbar.tsx:78-81`
- `frontend/src/components/campaign/DmFogControls.tsx:149-200`
- `frontend/src/utils/__tests__/themeTokens.test.ts:31-38`

### High: Campaign view is blocked below desktop width

The campaign main area is hidden below `lg`, followed by a Desktop Required
overlay. Mobile and narrow-viewport users cannot access the table.

Evidence:

- `frontend/src/pages/CampaignPage.tsx:405-410,553-565`

### Medium: Touch targets and live updates need review

- Campaign roster HP controls are `20x20px`, below the WCAG 2.2 AA 24px
  minimum unless an exception applies:
  `frontend/src/components/campaign/CampaignRoster.tsx:620-641`.
- Connection, chat, and other live errors are not consistently announced with
  status/live-region semantics:
  `frontend/src/components/ConnectionStatus.tsx:18-66`,
  `frontend/src/components/campaign/ChatPanel.tsx:530-536,620-626`.
- Loading announcements use generic `aria-live` containers instead of
  consistent `role="status"` regions:
  `frontend/src/App.tsx:47-52`,
  `frontend/src/pages/SetupWizardPage.tsx:280-287`,
  `frontend/src/pages/CampaignPage.tsx:440-444`.

## Findings: game systems

### High: Pathfinder derived values can be stale outside the editor

The editor recalculates saves, Perception, skills, lore, and spellcasting, but
the view and backend initiative resolver can read stored values directly.

Evidence:

- `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx:406-453,620-640`
- `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterView.tsx:287-309,319-358,530-580,780-800`
- `backend/src/utils/rules/initiative.ts:210-223`

### High: Call of Cthulhu derived values can be stale outside the editor

HP, MP, movement, damage bonus, build, Dodge, and sanity are recalculated in
the editor but the view, roster, or backend may read stored derived fields.

Evidence:

- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx:286-359`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx:350-450`
- `backend/src/utils/characterHp.ts:26-32`

### Medium: Call of Cthulhu sanity can become unsaveable

`cocMaxSanity()` returns `99 - Mythos` without clamping, while the editor
allows Mythos 100 and the schema requires non-negative sanity maximum.

Evidence:

- `frontend/src/components/character-sheets/call-of-cthulhu-7e/derivedStats.ts:19-21`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx:1114-1120`
- `backend/src/validators/game-systems/callOfCthulhu7e.schema.ts:50-57`

### Medium: Flexible editors do not enforce server count limits

Section, list, stat, table-column, and table-row controls can exceed the
server's limits and produce a sheet that cannot be saved.

Evidence:

- `frontend/src/components/character-sheets/flexible/FlexibleCharacterSheetEdit.tsx:168-177`
- `frontend/src/components/character-sheets/flexible/ListEditor.tsx:16-29`
- `frontend/src/components/character-sheets/flexible/StatsEditor.tsx:15-29`
- `frontend/src/components/character-sheets/flexible/TableEditor.tsx:16-61`
- `backend/src/validators/game-systems/flexible.schema.ts:40-109`

### Medium: D&D add-row controls create schema-invalid entries

Several add controls create blank required names for hit dice, attacks, spells,
or inventory.

Evidence:

- `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx:1799-1803,2008-2013,2431-2436,2544-2560`
- `backend/src/validators/game-systems/dnd5e.schema.ts:159-173,205-218,237-247,282-287`

### Medium: Typed editors lack shared text-length enforcement

Representative fields omit client-side max lengths even though schema limits
exist.

Evidence:

- `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx:1226-1305,2700-2743`
- `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx:905-915`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx:678-720`

### Medium: Call of Cthulhu editor/view/schema drift

Contacts, `pulpTalents`, `wealth.notes`, and `luck.notes` can be accepted or
stored without matching editor/view controls.

Evidence:

- `backend/src/validators/game-systems/callOfCthulhu7e.schema.ts:350-360`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx:546-560`

### Medium: Custom theme colors can produce unreadable headers

D&D and Call of Cthulhu views hardcode light text against arbitrary custom
colors instead of using the contrast-selection pattern already used elsewhere.

Evidence:

- `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterView.tsx:160-170`
- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx:123-128`

### Medium/High: Rules-content attribution is incomplete

Template files contain rules prose while attribution documents claim no such
content is shipped.

Evidence:

- `backend/src/utils/character-templates/dnd5e-templates.ts:318-325`
- `backend/src/utils/character-templates/pathfinder2e-templates.ts:254-270`
- `SRD_ATTRIBUTION.md:3-8`
- `THIRD_PARTY_LICENSES.md:34-37`
- `docs/GAME_SYSTEMS.md:900-902`

### Low: Call of Cthulhu view can render a stray `0`

Numeric values are rendered directly through `||` expressions on the Backstory
tab.

Evidence:

- `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx:623-626`

### Informational: Shadowrun placeholder is intentional but user-visible

Shadowrun is documented as incomplete, but API-created characters can still
reach a placeholder viewer/editor. Either finish the workflow or consistently
disable creation/editing.

Evidence:

- `frontend/src/constants/game-systems.ts:65-71`
- `frontend/src/components/character-sheets/shadowrun6e/Shadowrun6eCharacterSheet.tsx:8-22`
- `frontend/src/components/character/CharacterSheetEditorModal.tsx:180-190`
- `docs/GAME_SYSTEMS.md:5`

## Findings: infrastructure, deployment, and CI

### High: Development and production Compose stacks collide

Both stacks reuse container names and the `postgres_data` volume.

Evidence:

- `docker-compose.yml:43,89,192,232,327`
- `docker-compose.dev.yml:16,31,42,92,109`

Impact: running both stacks can replace containers or expose production data to
development; `down -v` can remove shared data.

### Medium: Database healthcheck does not validate the configured database

`pg_isready` omits the configured database name.

Evidence:

- `docker-compose.yml:69,74,125`
- `docker-compose.dev.yml:32-33`

### Medium: Default UVTT uploads exceed the default nginx body limit

Backend UVTT acceptance can exceed the default nginx 55 MB body limit while
the map default is 50 MB and UVTT overhead is higher.

Evidence:

- `.env.example:137,158,167`
- `docker-compose.yml:148,273`
- `backend/src/routes/maps.ts:47-56`
- `backend/src/utils/proxyLimits.ts:47-51`
- `docs/DEPLOYMENT.md:1081-1083`

### Medium: Production images are not fully reproducible

Node, PostgreSQL, nginx, Alpine packages, and apk dependencies use floating
tags or package versions. Production builds also lack `--pull`.

Evidence:

- `backend/Dockerfile:3,8`
- `backend/Dockerfile.prod:3,5,18,25`
- `frontend/Dockerfile:3`
- `frontend/Dockerfile.prod:3,16`
- `docker-compose.yml:42,231`
- `.github/workflows/ci.yml:212`

### Medium: CI pinning is incomplete

Actions are SHA-pinned, but the runner label and `pip install pyyaml` are
mutable. The workflow comment says the runner is pinned even though
`ubuntu-26.04` is a label.

Evidence:

- `.github/workflows/ci.yml:20,40,85,146,167,204,258`
- `.github/workflows/ci.yml:153,213`

### Medium: No base-image vulnerability gate exists

CI checks npm advisories but not Node, nginx, PostgreSQL, Alpine, or installed
OS package CVEs.

Evidence:

- `.github/workflows/ci.yml:160-213`

### Medium: Manual deployment instructions bypass lockfile policy

Manual production instructions use `npm install` and floating latest `pm2`
instead of the repository's reproducible install policy.

Evidence:

- `docs/DEPLOYMENT.md:819,828,840,1692,1698`

### Medium: Deployment references point to the wrong repository

Several documents still name `CheekyChinchilla/CozyVTT`, contradicting the
active `Hartorn-Inc/CozyVTT` repository.

Evidence:

- `README.md:157`
- `docs/DEPLOYMENT.md:48,1750`
- `.github/ISSUE_TEMPLATE/bug_report.md:10`
- `SECURITY.md:17`
- `docs/adr/0001-independent-clone.md:1-3`

### High: PostgreSQL uses a superuser on a non-internal bridge network

The Compose-created PostgreSQL user is the official image's initial
superuser, and the `internal` network is not declared with
`internal: true`.

Evidence:

- `docker-compose.yml:69,334-336`
- `SECURITY.md:54`

### High: Backups contain plaintext MFA secrets

Backups contain database records including TOTP secrets and credentials. File
permissions restrict local access but do not encrypt stored backups.

Evidence:

- `SECURITY.md:50`
- `backend/scripts/backup.sh:17-30`
- `docs/DEPLOYMENT.md:1174`

### Medium: `backup.sh` lacks locking and atomic finalization

Timestamp resolution and direct writes to the final filename permit concurrent
runs or interrupted gzip operations to leave a corrupted file that looks
complete.

Evidence:

- `backend/scripts/backup.sh:20-21,66-69`

### Informational: Operational scripts are orphaned

`migrate-asset-urls.ts` and `seedCreatures.ts` are not package scripts or
documented operational commands. `prisma:seed` is an explicit no-op.

Evidence:

- `backend/src/scripts/migrate-asset-urls.ts:12-18`
- `backend/src/scripts/seedCreatures.ts:4-10`
- `backend/prisma/seed.ts:8-14`
- `backend/package.json:17`
- `docs/DEVELOPMENT.md:225`

### Informational: CI does not exercise several operational paths

Dev Compose, manual nginx/Let's Encrypt renewal, real backup restore, and some
resource-limit paths are not exercised in CI.

## Findings: architecture and standards

### High: HTTP routes bypass the service layer

Several core routes directly query Prisma, implement permission logic,
transactions, and response shaping despite the documented route/service
boundary.

Evidence:

- `docs/ARCHITECTURE.md:88-190,220-230`
- `backend/src/routes/campaigns.ts:5-30,130-220`
- `backend/src/routes/assets.ts:5-40,180-310`
- `backend/src/routes/characters.ts:5-30,130-280`
- `backend/src/routes/maps.ts:1-44`

### High: REST routes are coupled to WebSocket internals

Campaign and map routes import initiative handlers, socket utilities, fan-out,
and in-memory combat state.

Evidence:

- `backend/src/routes/campaigns.ts:9-12`
- `backend/src/routes/maps.ts:13-14,40-44`

### High: Frontend state ownership violates the one-datum rule

Campaign context owns a REST-loaded map while also copying map tokens into
Zustand. MapCanvas then updates Zustand while the context map remains stale.

Evidence:

- `docs/ARCHITECTURE.md:294-307`
- `frontend/src/contexts/CampaignContext.tsx:188-238,276-281`
- `frontend/src/components/campaign/MapCanvas.tsx:1056-1060,1288-1300`

### High: Permission helpers are dead and contradictory

`services/permissions.ts` contains exported helpers that are unused or disagree
with route behavior. `canEditCharacter` trusts a caller-supplied campaign ID
and allows policies the route rejects.

Evidence:

- `backend/src/services/permissions.ts:43-100`
- `backend/src/services/permissions.ts:176-231,329-355`
- `backend/src/routes/characters.ts:560-599`
- `backend/RBAC_QUICK_REFERENCE.md:120-130`

### Medium: Invitation ownership is labelled as DM

The invitation route returns the campaign owner while the UI labels that person
as the DM. Ownership and DM seat are distinct after a handover.

Evidence:

- `backend/src/routes/invitations.ts:39-52`
- `frontend/src/components/campaign/InvitationModal.tsx:130-140`
- `docs/ARCHITECTURE.md:690-706`

### Medium: Frontend types misrepresent metadata-only API payloads

The backend returns metadata-only maps and characters, but frontend types
describe them as full `Map[]` and `Character[]`.

Evidence:

- `backend/src/routes/campaigns.ts:289-326`
- `frontend/src/types/index.ts:550-560`

### Medium: Route inventory can make false coverage claims

The inventory verifies that mapped test filenames exist but does not verify
that the file actually sends a request to the mapped route.

Evidence:

- `backend/src/routes/__tests__/routeInventory.test.ts:218-223,254-262`

### Medium: Seven routes remain intentionally untested

The route inventory lists registration status, session end, token-template
mutations, invitation listing, and invitation decline as untested.

Evidence:

- `backend/src/routes/__tests__/routeInventory.test.ts:181-191`

### Medium: Theme tests do not cover the whole documented rule

The theme-token test misses CSS, `white`, `black`, and several semantic
fill-token-as-text cases.

Evidence:

- `frontend/src/utils/__tests__/themeTokens.test.ts:30-38`
- `frontend/src/index.css:80-105`

### Medium: Duplicate validators create drift

Vibe settings are validated differently by campaign update/import and the vibe
route.

Evidence:

- `backend/src/validators/campaigns.ts:49-78`
- `backend/src/utils/vibe-presets.ts:91-166`

### Medium: Password and MFA allowlists are duplicated

The allowed-path lists can drift independently.

Evidence:

- `backend/src/middleware/passwordChange.ts:24-36`
- `backend/src/middleware/adminMfa.ts:29-39`

### Medium: Documentation has version and behavior drift

Examples include PostgreSQL 14/15/18 references, stale repository ownership,
inconsistent player-guide fog/initiative behavior, and incomplete composite
heading parsing in spec coverage.

Evidence:

- `backend/prisma/README.md:1-2`
- `CHANGELOG.md:37`
- `docs/adr/0005-postgresql-18.md:1`
- `docs/PLAYER_GUIDE.md:325,362`
- `backend/docs/WEBSOCKET_DOCUMENTATION.md:775`
- `scripts/spec-coverage.py:239-246`

## Findings: dead code and unused surfaces

These items should be verified against the intended public API policy before
removal. They are not all runtime defects, but they create maintenance and
security drift.

### Frontend

- `frontend/src/components/PasswordStrengthIndicator.tsx:14`
  has no production or test imports.
- `frontend/src/components/common/LoadingOverlay.tsx:18,58`
  has no consumers.
- `frontend/src/hooks/useWebSocketEvent.ts:29,84`
  has no production or test imports.
- `frontend/src/components/character-sheets/index.ts:6-11`
  is an orphaned barrel.
- `frontend/src/utils/character-export.ts:161-168`
  exports an unused placeholder named `downloadMultipleCharactersZIP` that
  downloads separate JSON files instead of a ZIP.
- `frontend/src/components/ConnectionStatus.tsx:75-121`
  contains an unused compact export.
- `frontend/src/components/common/LoadingOverlay.tsx` and
  `UploadProgressBar` appear to be incomplete loading-pattern migrations.
- `use-sync-external-store` is declared directly in
  `frontend/package.json:33` but has no source import.

### Backend

- `backend/src/game-systems/index.ts:55-220`
  contains legacy structural guards and `getTypedCharacterData` with no
  production callers.
- `backend/src/services/permissions.ts:31,39,60-98,176-231,329-355`
  contains an unused permission-helper cluster and contradictory policy
  sources.
- `backend/src/utils/character-templates/index.ts:33-95`
  contains batch template aggregators that are used only by tests while
  runtime uses another path.
- `backend/prisma/seed.ts:8-14`
  is an executable no-op seed stub.
- `backend/src/scripts/migrate-asset-urls.ts:12-18` and
  `backend/src/scripts/seedCreatures.ts:4-10`
  are undocumented standalone script candidates.

### Duplicated or dead behavior

- Two frontend toast systems coexist.
- Two dice-expression validators exist:
  `frontend/src/utils/validation.ts:99` and
  `frontend/src/utils/diceExpression.ts:9`.
- Vibe settings have duplicate validators.
- Character-sheet headers and controls are duplicated between systems.
- Socket lifecycle listeners exist in both the socket wrapper and context.
- `ThemeContext` exposes `logoUrl`, but no page consumes it:
  `frontend/src/contexts/ThemeContext.tsx:57-71,262-271`.

## Findings: design and persona workflows

### GM/DM

- Imported campaigns cannot be opened after a successful import.
- Campaign settings saves disrupt the live table.
- Map visibility actions can fail silently.
- Map export failures can be invisible.
- The danger zone is shown to a handed-over DM who cannot delete.
- Campaign asset actions do not consistently reflect DM permissions.
- Stale token controllers are presented as valid controls.
- Important tools rely on icon hover and right-click discovery.

### Player

- Invitations remain hidden until a manual dashboard refresh.
- Character owner names can appear as “Unknown Player”.
- Gallery roll controls can look active but do nothing.
- Character creation promises an editor redirect that does not happen.
- Flexible sheets can be made impossible to save by exceeding server limits.
- PDF reading is unreliable in common browser iframe contexts.
- Core live-table workflows are unavailable below desktop width.

### Spectator

- Dice controls appear available despite spectator restrictions.
- Pointer-only map and initiative operations exclude keyboard users.
- Current-map and event filtering must be strengthened to avoid stale or
  cross-map information.

### Admin

- Clipboard copy can fail silently on HTTP.
- Admin tabs do not have robust narrow-screen overflow behavior.
- Backup, restore, MFA reset, and destructive operations need stronger
  operator feedback and isolation.

## Existing strengths

The audit also confirmed:

- Session regeneration on login, MFA, and registration.
- SameSite cookies, Fetch Metadata/origin checks, and cross-site tests.
- Route-level campaign membership, ownership, DM/player/spectator authorization.
- Magic-byte upload validation, extension normalization, `nosniff`, safe archive
  extraction, zip-bomb limits, and path traversal defenses.
- Server-side token masking, Keeper filtering on tested character REST/socket
  paths, initiative projection, current-map filtering, and recipient-aware
  fan-out.
- Backend/frontend sheet-limit copies are byte-identical.
- Schema list/text-limit walkers, template schema-parity tests, and template
  key-survival tests exist.
- Vision, raycasting, spatial-index, token-mask, style-allowlist, and other
  parity files have dedicated checks.
- Reduced-motion handling is comparatively strong:
  `frontend/src/App.tsx:56-64`,
  `frontend/src/index.css:210-224`, and
  `frontend/src/__tests__/reducedMotion.test.tsx`.
- The shared `Modal`, `Field`, and `Button` primitives establish better
  accessibility patterns than several older feature-specific overlays.
- The session sidebar has tab roles, roving keyboard behavior, selected state,
  and unread badges.

## Issue tracker status

The only open GitHub issue found during the audit was
[Issue #6: Dependency Dashboard](https://github.com/Hartorn-Inc/CozyVTT/issues/6).
It tracks dependency automation and does not cover the confirmed application
defects above.

Several invitation, chat, asset, and UI problems are mentioned internally in
`docs/FUTURE_FEATURES.md`, but most backend authorization, data-integrity, and
WebSocket findings have no corresponding GitHub issue.

## Recommended remediation order

1. Establish a security/correctness tranche:
   session/socket revocation, campaign-system compatibility, orphaned asset
   access, cross-campaign pings, Keeper template filtering, stale mutation
   authorization, and custom-schema session storage.
2. Add concurrency and security regression tests before refactoring:
   role demotion during writes, session expiry during events, map switching
   during fan-out, exploration reset/write overlap, and recipient visibility.
3. Fix user-visible correctness:
   imported-campaign navigation, stale async responses, chat acknowledgements,
   error-versus-empty states, spectator controls, and permission-matched UI.
4. Run an accessibility tranche:
   landmarks, dialog semantics, focus restoration, keyboard alternatives,
   labels/errors, live regions, theme contrast, and narrow-screen behavior.
5. Stabilize game-system boundaries:
   derived-value calculation, editor/schema/view agreement, limits, blank-row
   behavior, custom theme contrast, and attribution.
6. Stabilize operations:
   Compose isolation, UVTT body limits, database least privilege, backup
   encryption/atomicity, image pinning/scanning, and deployment-doc drift.
7. Remove or centralize dead code only after the authoritative seams are
   decided:
   permission helpers, validators, socket APIs, template aggregators, loading
   components, unused dependencies, and no-op scripts.

## Planning recommendation from `/ask-matt`

This audit is too broad for one implementation pass. The recommended flow is:

1. Use `/wayfinder` if the remediation order, ownership, or architectural
   decisions are still unclear. It should create decision tickets and resolve
   blocking questions rather than immediately changing code.
2. Once the decisions are clear, use `/to-spec` to turn the audit into a
   buildable remediation specification.
3. Use `/to-tickets` to split the specification into small tickets with
   explicit blocking edges.
4. Use `/implement-spec` to orchestrate independent ready tickets on one
   integration branch, or use `/implement` per ticket when tighter manual
   control is preferred.
5. Drive each implementation slice with `/tdd`.
6. Close the integration branch with `/code-review`, then use `/pr` for the
   pull-request body.
7. Run `/retro` after the remediation cycle to turn recurring audit findings
   into repository rules, tests, or tooling.

For the first remediation tranche, `/diagnosing-bugs` is appropriate for the
individual race/security defects once each has a tight reproducing test. The
audit itself should not be treated as a single implementation ticket.
