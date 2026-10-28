# Extracted Issues Backlog

This catalog contains all active backlog items, bug fixes, and feature proposals extracted from `docs/FUTURE_FEATURES.md` prior to its permanent removal, in accordance with ADR 0003 (*GitHub surface is Issues only*) and ADR 0020 (*Backlog cleanup, static roadmap elimination, and code TODO normalization*).

All entries below are formatted as standalone GitHub Issues ready for import or tracking.

---

## Summary of Extracted Issues

| Issue ID | Type | Title | Original Reference |
|---|---|---|---|
| EXT-001 | Bug (Batch) | Character Sheets UI & Validation Edge Cases | Known Issues > Character sheets |
| EXT-002 | Bug (Batch) | Token Manager & Map Canvas Token Interactions | Known Issues > Tokens |
| EXT-003 | Bug (Batch) | Campaign Settings, Assets & Library UI Fixes | Known Issues > Campaigns and assets |
| EXT-004 | Bug (Batch) | Session Lifecycle, Dice Log & Toast Notifications | Known Issues > Play and connection |
| EXT-005 | Bug (Batch) | Map Lighting, Doors & Fog Edge Cases | Known Issues > Maps |
| EXT-006 | Bug | Focus trap on Create User dialog | Known Issues > Accounts |
| EXT-007 | Bug (Batch) | Backup/Restore Cleanup & Container Shutdown | Known Issues > Server and deployment |
| EXT-008 | Feature | Animated Maps and Tokens Support | Backlog > User-facing |
| EXT-009 | Feature | Sound Effects for Dice Rolls and In-App Notifications | Backlog > User-facing |
| EXT-010 | Feature | Desktop Browser Notifications for Turns and Chat | Backlog > User-facing |
| EXT-011 | Feature | Custom Player Dice Colors | Backlog > User-facing |
| EXT-012 | Feature | Bulk Character Export as ZIP Archive | Backlog > User-facing |
| EXT-013 | Feature | Shadowrun 6E Character Sheet Implementation | Backlog > User-facing |
| EXT-014 | Feature | Admin Upload UI for Custom Instance Branding | Backlog > User-facing |
| EXT-015 | Feature | Change User Email Address from App Settings | Backlog > User-facing |
| EXT-016 | Feature | Configurable Per-User Storage Quota | Backlog > User-facing |
| EXT-017 | Feature | Manage and Clear Account Sign-In Locks from Admin Panel | Backlog > User-facing |
| EXT-018 | Feature | Disable and Suspend User Accounts | Backlog > User-facing |
| EXT-019 | Feature | Change Campaign Member Role in App UI | Backlog > DM tools |
| EXT-020 | Feature | Visual Indicator for 0 HP Hidden-Bar Creatures | Backlog > DM tools |
| EXT-021 | Feature | Layered Ambient Soundboard & Multi-Track Audio | Backlog > DM tools |
| EXT-022 | Feature | Per-Player Token Identity Reveal | Backlog > DM tools |
| EXT-023 | Feature | Per-Token Vision Enabled Toggle | Backlog > DM tools |
| EXT-024 | Tech Debt | Raster Caching for Player Fog of War | Backlog > Polish / tech debt |
| EXT-025 | Tech Debt | Upgrade Database to PostgreSQL 19 | Backlog > Polish / tech debt |
| EXT-026 | Tech Debt | Tailwind CSS 4 Migration | Backlog > Polish / tech debt |
| EXT-027 | Tech Debt | Lightweight Arithmetic Evaluator Replacing Mathjs | Backlog > Polish / tech debt |
| EXT-028 | Tech Debt | Unified Dice Expression Parser Architecture | Backlog > Polish / tech debt |
| EXT-029 | Tech Debt | Drop `file-type` Test Stubs | Backlog > Polish / tech debt |
| EXT-030 | Feature | DM-Shared Table-Wide Dice Macros | Backlog > Polish / tech debt |
| EXT-031 | Feature | Advantage and Disadvantage Selector on Initiative Rolls | Backlog > Polish / tech debt |
| EXT-032 | Feature | Reassign Character Ownership to Another Player | Backlog > Polish / tech debt |

---

## Issue Specifications

### EXT-001: [Extracted] Character Sheets UI & Validation Edge Cases
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Character sheets)
- **Description**:
  Fix multiple known character sheet validation and UI anomalies across game systems:
  1. **D&D 5e**: Renaming the spellcasting ability after raising the score leaves spell save DC and attack bonus unchanged due to backfill arithmetic in `DnD5eCharacterEditor.tsx`.
  2. **Characters Page**: Stats look clickable/rollable in read-only preview but do nothing because `CharacterSheetViewerModal.tsx` passes an inert roll handler.
  3. **Call of Cthulhu**: Firearms, Other Language, and Science rows do not roll from the sheet, and language/specialization prints twice in `components/SkillsList.tsx`.
  4. **Pathfinder 2e**: AC, Class DC, or Spell DC calculating below 10 prevents saving because `pathfinder2e.schema.ts` strictly enforces a minimum of 10.
  5. **Call of Cthulhu**: Read-only view displays a stray "0" when Cthulhu Mythos is 0 and spells list is empty (`CallOfCthulhu7eCharacterView.tsx`).
  6. **Pathfinder 2e**: Feat description from templates cannot be edited because templates save to `notes` while the editor writes to `description`.
  7. **Call of Cthulhu**: Investigator with POW 100 cannot be saved because starting Sanity defaults to POW but schema caps Sanity at 99 (`CallOfCthulhu7eCharacterEditor.tsx`).
  8. **Pathfinder 2e**: Numeric bulk inputs are not recognized by `calculateTotalBulk` and `BulkTracker`.
  9. **Call of Cthulhu**: Clearing a skill input field temporarily resets the value to 0 instead of using `NumberField` blank-state handling.
  10. **DM Character View**: Viewing a player's character sheet displays "Unknown Player" because the endpoint requires owner/admin privileges (`CharacterSheetViewerModal.tsx`).
  11. **Character Template Picker**: Uploading an image in template editor creates a personal asset instead of requiring or converting to a global asset (`CharacterTemplateEditorModal.tsx`).
- **Acceptance Criteria**:
  - [ ] All 11 character sheet issues are reproduced and addressed with unit/integration tests.
  - [ ] Schema constraints reflect system rules accurately without blocking valid edge cases (e.g., POW 100, PF2e untrained ranks).
  - [ ] Roll handlers trigger properly or indicate non-interactive status.

---

### EXT-002: [Extracted] Token Manager & Map Canvas Token Interactions
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Tokens)
- **Description**:
  Fix edge cases and state synchronization issues in the Token Manager and canvas context menus:
  1. Token Manager offers "Send to Spirit Realm" for Object tokens, which map context menus restrict to material plane.
  2. Token Manager shows a "Player" chip on tokens whose assigned controller is no longer in the campaign.
  3. Token editor "Controlled By" dropdown lacks an entry for spectator or former member still bound to the token.
  4. Token template copy to another campaign lacks user feedback on success and shows a generic error on refusal.
  5. Refused token placement on the map fails to display the server's specific refusal reason.
  6. Right-click Hide, Obscure, and Spirit Realm toggles fail silently to the console on network errors.
  7. DM's spirit-token toggle label displays inverted status text ("Hiding spirit tokens (click to show)" while visible).
  8. Token mutations via REST endpoints (`routes/maps.ts`) do not emit live WebSocket events for real-time map synchronization.
- **Acceptance Criteria**:
  - [ ] Object tokens cannot be sent to the spirit realm from any UI control.
  - [ ] Controlled By lists accurately represent current eligible controllers.
  - [ ] User notifications (toasts) provide clear server error descriptions.
  - [ ] REST token updates broadcast WebSocket events matching real-time handler behavior.

---

### EXT-003: [Extracted] Campaign Settings, Assets & Library UI Fixes
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Campaigns and assets)
- **Description**:
  Tackle UI anomalies and asset handling defects across campaigns and libraries:
  1. Clearing campaign description sends `undefined`, preventing empty string persistence.
  2. Non-owner DMs are shown the "Delete Campaign" option despite server refusal.
  3. Refused asset move shows generic "Forbidden" instead of the server error message.
  4. Campaign name and description form inputs have stricter character caps (100/1000) than backend schema limits (200/5000).
  5. Dashboard invitation banner requires manual browser refresh to reflect newly received invitations.
  6. Campaign invitation modal labels the campaign owner as "DM:" even after DM seat reassignment.
  7. Asset library Delete and Move actions use inconsistent client-side visibility logic instead of backend `canChange` flag.
  8. Creature Library rows contain nested `<button>` tags causing DOM validation warnings.
  9. Deleting a favorited creature does not immediately remove it from the Favorites sub-list.
  10. Creature and token template forms fail to display the 64 KB stat block size refusal reason.
  11. Campaign export does not enforce entity count limits that cause campaign import failure (e.g. >50 maps, >200 custom creatures).
  12. Asset uploads with non-ASCII filenames decode UTF-8 bytes as latin1, corrupting stored filenames.
  13. Asset library search input only filters current page results instead of querying the full asset collection.
  14. Sandboxed document reader frame blocks PDF rendering on Google Chrome.
  15. Firefox CSS animation glitches (double fade-in on asset cards, audio upload MIME type rejection for Ogg/WAV).
- **Acceptance Criteria**:
  - [ ] Form limits align with backend validation schemas.
  - [ ] Asset permissions in UI rely exclusively on `canChange` metadata from the API.
  - [ ] UTF-8 filenames are preserved across upload and download flows.
  - [ ] PDF reader opens reliably in Chrome or falls back cleanly.

---

### EXT-004: [Extracted] Session Lifecycle, Dice Log & Toast Notifications
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Play and connection)
- **Description**:
  Fix anomalies in session lifecycle, toast notification dismissal, and dice history:
  1. Chat message sent while connection drops is lost and permanently stuck in "sending..." state.
  2. Initiative rolls broadcast over WebSocket but are not stored in the database, disappearing on reload.
  3. Offline members who rejoin after DM clears dice history may retain old rolls due to catch-up logic only appending.
  4. Obscured token initiative roll logs as "Unknown creature" even for the controlling player.
  5. Starting a session via API while paused leaves the paused session in an un-ended state.
  6. Ending a session with `saveState: false` overwrites/discards paused snapshot state.
  7. Toast messages arriving in succession are closed prematurely when the newest message timer expires.
  8. Dice formulas dividing by zero (e.g. `5/0`) fail with unhandled errors instead of validation messages.
- **Acceptance Criteria**:
  - [ ] Disconnected chat messages retry or show a failed-to-send status with retry action.
  - [ ] Initiative rolls persist across reloads in session roll history.
  - [ ] Dice parser gracefully handles mathematical anomalies (division by zero) with clear error messaging.
  - [ ] Toast notifications dismiss individually based on their independent timeouts.

---

### EXT-005: [Extracted] Map Lighting, Doors & Fog Edge Cases
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Maps)
- **Description**:
  Fix UI and rendering edge cases on map canvas:
  1. Preview Player View button disappears and gets stuck if both lighting and fog are toggled off during preview.
  2. Light placement and selection tools remain active while in player view preview where markers are invisible.
  3. Player door toggle occurring during DM wall segment move is discarded when the DM finishes the move.
  4. At zoom levels fitted to screen, clicking a token adjacent to a door inadvertently triggers the door toggle.
- **Acceptance Criteria**:
  - [ ] Preview Player View can always be exited regardless of map layer toggle states.
  - [ ] DM drawing and placement tools are disabled during player view preview.
  - [ ] Concurrent door toggles and wall moves merge without dropping door states.
  - [ ] Token pickup click radius takes precedence over door interaction when disambiguating at low zoom.

---

### EXT-006: [Extracted] Focus Trap on Create User Dialog
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Accounts)
- **Description**:
  In the Admin Panel's Create User dialog, the email input field loses focus immediately upon dialog open because `useFocusTrap` transfers focus to the modal's first interactive element (close button).
- **Acceptance Criteria**:
  - [ ] Opening the Create User modal sets autofocus on the primary form input (email or username).
  - [ ] Focus trapping keeps keyboard navigation cycling within the modal.

---

### EXT-007: [Extracted] Backup/Restore Cleanup & Container Shutdown
- **Labels**: `scope:extracted-feature`, `type:bug`
- **Source**: `docs/FUTURE_FEATURES.md` (Known issues > Server and deployment)
- **Description**:
  Address deployment and file handling cleanup issues:
  1. Terminated or aborted archive unpack retains file descriptors and disk space until backend process restart (`utils/archive.ts`).
  2. When players are connected via WebSocket, `docker compose stop` or recreation forces nginx shutdown after 10s timeout because long-lived connections do not close spontaneously.
  3. Legacy backup folder `backend/uploads/backups` from versions prior to 1.5.0 causes an empty nested directory to be included in new backups.
  4. `DATABASE_URL` with `sslmode=no-verify` is accepted by Prisma but rejected by `pg_dump` and `psql` during backup/restore.
- **Acceptance Criteria**:
  - [ ] Aborted archive extractions explicitly close underlying file streams.
  - [ ] Nginx gracefully handles active WebSocket connection drains during Compose stop.
  - [ ] `sslmode=no-verify` is properly sanitized or flagged prior to invoking `pg_dump`.

---

### EXT-008: [Extracted] Animated Maps and Tokens Support
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Provide safe support for animated WebP, APNG, and GIF assets on the map canvas:
  - Enforce backend resource boundaries (pixel limits, frame count, dimension checks, first-frame thumbnail generation) to prevent decompression bombs.
  - Canvas rendering optimizations: repaint animation frames on dedicated layers without full wall, light, and fog recalculation.
  - Provide a client-side setting to pause or disable animations (reduced-motion compliance).
- **Acceptance Criteria**:
  - [ ] Animated uploads validate frame counts and pixel totals before acceptance.
  - [ ] Animated maps play smoothly without triggering full canvas redraw cycles.
  - [ ] `prefers-reduced-motion` or user setting freezes animated map frames.

---

### EXT-009: [Extracted] Sound Effects for Dice Rolls and In-App Notifications
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Integrate lightweight audio effects for dice rolls and turn notifications:
  - Bundle royalty-free audio assets under `frontend/public/sounds/`.
  - Implement a `useSound()` React hook with volume control and muted fallback.
  - Add per-user opt-in toggle in Profile settings.
- **Acceptance Criteria**:
  - [ ] Audio plays when dice are rolled or turns advance, when enabled by user.
  - [ ] Sound is muted by default or easily disabled in settings.

---

### EXT-010: [Extracted] Desktop Browser Notifications for Turns and Chat
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Add web browser notifications for when a player's turn comes up in initiative order or when direct/campaign chat messages arrive while the CozyVTT tab is in the background.
- **Acceptance Criteria**:
  - [ ] User is prompted for Notification permission only upon enabling the feature.
  - [ ] Backgrounded tab triggers notification on turn transition.
  - [ ] Clicking notification focuses the campaign tab.

---

### EXT-011: [Extracted] Custom Player Dice Colors
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Allow players to customize their personal dice accent color in Profile settings. When rolling dice, this color is broadcast in socket roll metadata and displayed as the badge/highlight color in the table dice log.
- **Acceptance Criteria**:
  - [ ] Profile page provides a color picker for dice accent.
  - [ ] Dice log renders rolls with roller's selected accent color.

---

### EXT-012: [Extracted] Bulk Character Export as ZIP Archive
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Allow users to select multiple characters from the Characters page and download them as a single `.zip` archive containing individual character JSON files, expanding on the uncalled helper in `character-export.ts`.
- **Acceptance Criteria**:
  - [ ] Multi-select UI available on Characters page.
  - [ ] Generates valid `.zip` file containing JSON sheets of selected characters.

---

### EXT-013: [Extracted] Shadowrun 6E Character Sheet Implementation
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Implement the complete frontend character sheet UI for Shadowrun 6th Edition (backend schemas and validation already exist). Once completed, expose Shadowrun 6E in the game system dropdown.
- **Acceptance Criteria**:
  - [ ] Attributes, skills, cyberware, weapons, and edge tracking implemented.
  - [ ] Shadowrun 6E enabled in campaign and character creation dropdowns.

---

### EXT-014: [Extracted] Admin Upload UI for Custom Instance Branding
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Add an upload interface in the Admin Panel Appearance tab allowing administrators to upload instance logo, favicon, and mascot images directly through the web UI instead of manually rebuilding containers with swapped files in `frontend/public/`.
- **Acceptance Criteria**:
  - [ ] Admin Appearance tab includes image upload dropzones for logo, favicon, and mascot.
  - [ ] Dynamic asset URLs are updated in `SystemSettings` and immediately reflected across client sessions.

---

### EXT-015: [Extracted] Change User Email Address from App Settings
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Provide a form in Profile Settings allowing users to update their email address with current password confirmation, calling the existing backend endpoint `PUT /api/users/:id`.
- **Acceptance Criteria**:
  - [ ] Form prompts for new email and password confirmation.
  - [ ] Validation prevents duplicate emails and handles verification if SMTP is configured.

---

### EXT-016: [Extracted] Configurable Per-User Storage Quota
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Introduce an optional per-user storage quota setting in Admin Settings (`SystemSettings`). Compute total file usage across user uploads and reject uploads exceeding the quota with a descriptive error.
- **Acceptance Criteria**:
  - [ ] Setting in Admin Panel (default disabled / unlimited).
  - [ ] Upload endpoints check cumulative user asset size prior to receiving large payloads.

---

### EXT-017: [Extracted] Manage and Clear Account Sign-In Locks from Admin Panel
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Provide an admin UI control in Admin -> Users showing currently rate-limited accounts (locked after 10 failed sign-in attempts) with an action to immediately unlock the account without requiring a password change.
- **Acceptance Criteria**:
  - [ ] Admin user list shows locked badge and unlock button.
  - [ ] Unlocking resets the in-memory failure counter in `failureLimiter.ts`.

---

### EXT-018: [Extracted] Disable and Suspend User Accounts
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > User-facing)
- **Description**:
  Allow administrators to suspend/disable user accounts without deleting them. Suspended users cannot authenticate, active sessions are immediately revoked, and data remains intact.
- **Acceptance Criteria**:
  - [ ] `disabled` flag in user schema.
  - [ ] Authentication middleware blocks disabled accounts.
  - [ ] Disabling revokes active sessions and WebSocket connections.

---

### EXT-019: [Extracted] Change Campaign Member Role in App UI
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > DM tools)
- **Description**:
  Expose a UI dropdown in Campaign Settings -> Members allowing the DM to change a member's role (Player, Spectator), calling the existing backend route `PUT /api/campaigns/:id/members/:userId`.
- **Acceptance Criteria**:
  - [ ] Role selector available per member in campaign settings.
  - [ ] Role transition updates live permissions without removing user.

---

### EXT-020: [Extracted] Visual Indicator for 0 HP Hidden-Bar Creatures
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > DM tools)
- **Description**:
  When a creature with a hidden HP bar reaches 0 HP, broadcast a defeated/down flag without revealing exact hit point numbers, allowing the token to visually fade or render downed so players know the space is accessible.
- **Acceptance Criteria**:
  - [ ] Defeated state visible to players without exposing numerical HP.
  - [ ] Downed token visual treatment applied on canvas.

---

### EXT-021: [Extracted] Layered Ambient Soundboard & Multi-Track Audio
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > DM tools)
- **Description**:
  Support dual-channel audio allowing the DM to trigger one-shot ambient sound effects (soundboard) over an ongoing ambient music track without interrupting or resetting the background vibe track.
- **Acceptance Criteria**:
  - [ ] Second audio channel on backend and frontend player.
  - [ ] Soundboard trigger plays concurrently with ambient music.

---

### EXT-022: [Extracted] Per-Player Token Identity Reveal
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > DM tools)
- **Description**:
  Support revealing an obscured token's true name and portrait to specific players (e.g. after a successful Perception or Knowledge check) while keeping it obscured for the rest of the table.
- **Acceptance Criteria**:
  - [ ] Per-player reveal state recorded on map exploration / token data.
  - [ ] Obscured filtering respects player-specific reveal state.

---

### EXT-023: [Extracted] Per-Token Vision Enabled Toggle
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > DM tools)
- **Description**:
  Add a `visionEnabled` boolean property to tokens. When disabled, the token does not contribute its position or darkvision to the controlling player's dynamic lighting sightline calculation (useful for mounts, familiars, or unconscious tokens).
- **Acceptance Criteria**:
  - [ ] Vision toggle in Token Settings modal.
  - [ ] Dynamic lighting sightline calculation excludes tokens with vision disabled.

---

### EXT-024: [Extracted] Raster Caching for Player Fog of War
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Optimize player fog of war rendering on large maps by caching revealed/hidden state into an offscreen raster canvas at 1 pixel per grid cell, avoiding per-mouse-move iteration over thousands of fog rects.
- **Acceptance Criteria**:
  - [ ] Offscreen canvas maintains fog raster state.
  - [ ] Raster invalidates and redraws only upon fog change events.

---

### EXT-025: [Extracted] Upgrade Database to PostgreSQL 19
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Plan and execute database engine migration to PostgreSQL 19 before PostgreSQL 18 reaches end-of-life, including backup/restore data migration procedures and client tool alignment.
- **Acceptance Criteria**:
  - [ ] Upgraded Docker Compose database definitions and scripts.
  - [ ] Automated migration rehearsal tested against PostgreSQL 19.

---

### EXT-026: [Extracted] Tailwind CSS 4 Migration
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Migrate frontend styling from Tailwind CSS 3 to Tailwind CSS 4, resolving class name deprecations and clearing upstream advisory overrides in `package.json`.
- **Acceptance Criteria**:
  - [ ] All 16 built-in themes and custom color picker verified visual parity.
  - [ ] Zero lint or typecheck regressions across components.

---

### EXT-027: [Extracted] Lightweight Arithmetic Evaluator Replacing Mathjs
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Replace `mathjs` in `backend/src/utils/dice-parser.ts` with a small, self-contained arithmetic evaluator supporting `+`, `-`, `*`, `/` on evaluated dice integers, removing ~18 MB of dependencies.
- **Acceptance Criteria**:
  - [ ] Zero external dependencies used in dice calculation.
  - [ ] 100% test coverage matching existing dice parser suite results.

---

### EXT-028: [Extracted] Unified Dice Expression Parser Architecture
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Unify dice grammar validation between frontend client validators and backend parser, eliminating duplicate expression checks (`utils/diceExpression.ts` and `DiceRoller`).
- **Acceptance Criteria**:
  - [ ] Single authoritative dice grammar specification.
  - [ ] Frontend and backend reject identically formatted invalid expressions.

---

### EXT-029: [Extracted] Drop `file-type` Test Stubs
- **Labels**: `scope:extracted-feature`, `type:refactor`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Replace stubbed `file-type` mocks in `campaignImportAllowlist.e2e.test.ts` and `campaignArchiveAudio.test.ts` with genuine binary fixtures.
- **Acceptance Criteria**:
  - [ ] Real file fixtures utilized across import tests.
  - [ ] `file-type` library executes un-mocked.

---

### EXT-030: [Extracted] DM-Shared Table-Wide Dice Macros
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Support campaign-wide shared dice macros created by the DM (e.g. Wild Magic Surge, random encounters) that appear in every player's dice panel.
- **Acceptance Criteria**:
  - [ ] `shared` flag on `DiceMacro` model.
  - [ ] Shared macros visible to all campaign participants.

---

### EXT-031: [Extracted] Advantage and Disadvantage Selector on Initiative Rolls
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Support advantage/disadvantage modifier on initiative rolls (e.g., D&D 5e Sentinel Shield or Barbarian Feral Instinct) utilizing the existing `2d20kh1` / `2d20kl1` dice evaluator logic.
- **Acceptance Criteria**:
  - [ ] Initiative modal offers Advantage / Normal / Disadvantage toggle.
  - [ ] Roll resolver executes appropriate keep-highest or keep-lowest formula.

---

### EXT-032: [Extracted] Reassign Character Ownership to Another Player
- **Labels**: `scope:extracted-feature`, `type:feature`
- **Source**: `docs/FUTURE_FEATURES.md` (Backlog > Polish / tech debt)
- **Description**:
  Allow campaign DM to reassign character sheet ownership to another player in the same campaign (e.g. when a player leaves and another takes over the character).
- **Acceptance Criteria**:
  - [ ] `POST /api/characters/:id/transfer-owner` endpoint (DM only).
  - [ ] Character ownership updates in campaign roster and character list.
