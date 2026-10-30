# Specification: Character Sheets UI, Schema & Validation Edge Cases

**Slug**: `fix-sheets-character-sheets-ui-schem`  
**Status**: Planned  
**Author**: EPURE Architect  
**Related ADR**: `docs/adr/0014-cleanup-authorities-and-sequencing.md`, `docs/adr/0021-character-sheet-integrity-and-permission-alignment.md`  
**Target Issue**: #152  

---

## 1. Executive Summary & Problem Statement

The CozyVTT character sheet subsystem spans three supported game systems (D&D 5e, Pathfinder 2e, Call of Cthulhu 7e), untyped flexible sheets, and published character templates. Across frontend editors, read-only viewers, backend validation schemas, rules calculation utilities, and routing layers, twenty specific edge cases and defects were identified in `docs/FUTURE_FEATURES.md` and tagged via referenced `TODO(#...)` comments.

These defects lead to:
- Corrupted derived values (e.g., D&D 5e spell DC locking negative bonuses upon selecting a casting ability).
- Client-server save rejections caused by UI buttons exceeding schema bounds (D&D 5e custom skills > 30, damage rolls > 10, CoC 7e Sanity with POW 100).
- Schema rejection of legal game system values (PF2e AC < 10 with negative Dex).
- Frontend rendering bugs (stray `"0"` rendered in CoC 7e Spells & Mythos, duplicate specialization badges, input reset to zero on clear, non-clickable rolls for specialized skills).
- Broken template workflows (raw unformatted schema errors, personal asset selection on public templates, unescaped SQL LIKE queries).
- Permission and viewer inconsistencies (403 when viewing player sheet owner names, inert roll handlers without campaign WebSocket connection, dormant and diverging `canEditCharacter` permission helper).

This specification details the end-to-end technical remediation across all 20 catalogued items, ensuring zero UI regressions, full test coverage, and cleanup of all 20 inline TODO markers.

---

## 2. Architecture & Design Principles

1. **ADR-0014 & ADR-0021 Adherence**: Clean up competing authorities by unifying access control in `backend/src/services/permissions.ts` and delegating from `backend/src/routes/characters.ts`. Do not leave duplicate or dead permission logic.
2. **Rules Helper Parity**: Any change to Call of Cthulhu 7e derived logic must apply identically to `backend/src/utils/rules/callOfCthulhu7e.ts` and `frontend/src/utils/rules/callOfCthulhu7e.ts`, asserted via `tests/rules/keepInStep.test.ts`.
3. **Safe Structural Defaults**: Editors must never rely on unsafe casts `({} as T)` for nested records (abilities, saving throws, skills, characteristics, appearance). Complete, typed factory defaults must be injected during data initialization.
4. **Privacy-Preserving UI**: Do not weaken endpoint security (`GET /api/users/:id`). Viewers must resolve user metadata from already authorized payloads (campaign roster or character user relation).
5. **SQL Metacharacter Neutralization**: Search endpoints using SQL `ILIKE` must escape `%`, `_`, and `\` using `escapeLikePattern`.

---

## 3. Itemized Technical Specifications (20 Items)

### Item 1: D&D 5e Spellcasting Ability Backfill (`frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`)
- **Problem**: When a legacy D&D 5e sheet has no spellcasting ability chosen, the editor initializes `spellSaveDC` as `8 + proficiency` and `spellAttackBonus` as `proficiency`. When the user subsequently selects an ability in the editor, the reactive `useEffect` treats the existing `spellSaveDC` as a manual override and calculates a negative compensatory bonus (`spellSaveDCOtherBonus = storedDC - (8 + prof + abilityMod)`), artificially freezing the displayed DC.
- **Remediation**:
  - Move the legacy compensation backfill logic entirely out of the continuous reactive effect.
  - Execute the backfill strictly once during the initial state preparation (`initialFormData` hydration).
  - If `data.spellcasting` lacks `spellSaveDCOtherBonus` and `spellAttackOtherBonus`, compute any historic manual difference once upon loading.
  - In the reactive effect that tracks `spellcasting.ability`, `proficiencyBonus`, and ability modifier changes, recompute `spellSaveDC` purely as `8 + proficiencyBonus + abilityModifier + (spellcasting.spellSaveDCOtherBonus || 0)` and `spellAttackBonus` as `proficiencyBonus + abilityModifier + (spellcasting.spellAttackOtherBonus || 0)` without modifying the other bonuses.
- **Files**: `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`.

### Item 2: D&D 5e Custom Skills Limit (`frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`)
- **Problem**: The backend schema `dnd5e.schema.ts` enforces `customSkills: z.array(...).max(30)`. The editor UI allows pressing "Add Skill" indefinitely. Adding a 31st skill allows editing but causes saving to fail with a validation error.
- **Remediation**:
  - In `DnD5eCharacterEditor.tsx`, inspect `formData.customSkills?.length ?? 0`.
  - Disable the "Add Skill" button when `formData.customSkills.length >= 30`.
  - Add a tooltip or helper note indicating `Maximum 30 custom skills reached` when the limit is reached.
- **Files**: `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`.

### Item 3: D&D 5e Other Damage Rolls Limit (`frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`)
- **Problem**: In the attack editor, `otherDamageRolls` is schema-capped at 10 items per attack. The "Add Damage Roll" button has no disabled state, causing sheets with >10 damage rolls to fail saving.
- **Remediation**:
  - In the attack item editor within `DnD5eCharacterEditor.tsx`, disable the "Add Damage Roll" button when `attack.otherDamageRolls?.length >= 10`.
- **Files**: `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`.

### Item 4: D&D 5e Empty Nested Container Defaults (`frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`)
- **Problem**: Unsafe type assertions like `(data.abilities || {}) as DnD5eAbilities` result in empty objects without the 6 core ability keys (`str`, `dex`, `con`, `int`, `wis`, `cha`), causing runtime property access exceptions on `.score` or `.proficient`.
- **Remediation**:
  - Implement a `getDefaultDnD5eData()` factory or deep-merge utility for `abilities`, `savingThrows`, `skills`, and `deathSaves`.
  - Ensure every standard ability exists with `{ score: 10, proficient: false }` if omitted.
  - Ensure every standard skill exists with `{ proficient: false, expertise: false }` if omitted.
- **Files**: `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx`.

### Item 5: Pathfinder 2e AC / Class DC / Spell DC Minimum Bounds (`backend/src/validators/game-systems/pathfinder2e.schema.ts`)
- **Problem**: In `backend/src/validators/game-systems/pathfinder2e.schema.ts`, `armorClassSchema`, `classDCSchema`, and `spellcastingSchema` enforce `.min(10)` on `total`. In Pathfinder 2e, an untrained level 1 character with Dexterity -1 has an AC of `10 + 0 (untrained) - 1 = 9`. Enforcing `min(10)` rejects valid characters.
- **Remediation**:
  - Lower `.min(10)` to `.min(0)` for `total` fields in:
    - `armorClassSchema.shape.total`
    - `classDCSchema.shape.total`
    - `spellcastingEntrySchema.shape.dc.shape.total`
  - Ensure unit tests assert that AC 9 and DC 9 pass validation.
- **Files**: `backend/src/validators/game-systems/pathfinder2e.schema.ts`, `backend/tests/validators/pathfinder2e.test.ts`.

### Item 6: Pathfinder 2e Numeric Bulk String Parsing (`frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`)
- **Problem**: The bulk field in inventory items is stored or typed as a string (e.g., `"2"`). The functions `calculateTotalBulk` and `bulkToNumber` only recognized numeric types or specific symbols (`"L"`, `"-"`), treating numeric strings like `"2"` as 0.
- **Remediation**:
  - In `bulkToNumber(bulk: string | number | undefined): number`:
    - If value is undefined or empty string, return 0.
    - If value is `"L"` or `"l"`, return 0.1.
    - If value is `"-"`, return 0.
    - If `typeof bulk === 'string'`, run `const parsed = parseFloat(bulk); return isNaN(parsed) ? 0 : parsed;`.
    - If `typeof bulk === 'number'`, return `isNaN(bulk) ? 0 : bulk`.
  - Ensure `calculateTotalBulk` uses this robust parser for all items.
- **Files**: `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`.

### Item 7: Pathfinder 2e Starter Template Feat Notes Fallback (`frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`)
- **Problem**: Starter templates for Pathfinder 2e store feat descriptive text under `notes`, while the editor UI only binds `description`. When editing a feat created from a starter template, the description field opens blank, and `notes` cannot be viewed, edited, or cleared.
- **Remediation**:
  - In the feat editor modal and row display, fallback: `const featText = feat.description || feat.notes || '';`.
  - When the user edits or saves the feat in the editor, normalize it to `description: featText`, and clear or harmonize `notes: ''` to prevent divergent descriptions between view and edit modes.
- **Files**: `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`.

### Item 8: Pathfinder 2e Empty Nested Container Defaults (`frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`)
- **Problem**: `(data.appearance || {}) as Pathfinder2eAppearance` and similar fallback casts for `abilities`, `savingThrows`, and `attributes` cause undefined reads on nested properties.
- **Remediation**:
  - Implement `getDefaultPathfinder2eData()` supplying safe defaults for `appearance`, `abilityScores` (STR, DEX, CON, INT, WIS, CHA at 10), `savingThrows` (Fortitude, Reflex, Will), `armorClass`, and `hitPoints`.
- **Files**: `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx`.

### Item 9: Call of Cthulhu 7e POW 100 vs Sanity 99 Cap (`frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx`)
- **Problem**: Call of Cthulhu 7e rules permit rolling a Power (POW) characteristic of 100. By default, starting Sanity equals POW. However, CoC 7e rules strictly cap Sanity at 99 (and current Sanity at `99 - Cthulhu Mythos`). If POW is 100, starting and current Sanity default to 100, which causes the backend schema validation (`sanity.max(99)`) to fail on save.
- **Remediation**:
  - In `CallOfCthulhu7eCharacterEditor.tsx`, when deriving starting Sanity from POW, apply `Math.min(99, powValue)`.
  - When updating or initializing current Sanity, bound it by `Math.min(currentSanity, maxSanity)` where `maxSanity = 99 - (formData.skills?.['Cthulhu Mythos']?.value || formData.spellsAndMythos?.cthulhuMythos || 0)`.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx`.

### Item 10: Call of Cthulhu 7e Empty Nested Container Defaults (`frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx`)
- **Problem**: Type casts `(data.characteristics || {}) as CallOfCthulhu7eCharacteristics` lead to undefined access when characteristics or skills dictionaries are missing from the raw payload.
- **Remediation**:
  - Ensure safe structural defaults for `characteristics` (STR, CON, SIZ, DEX, APP, INT, POW, EDU, MOV all defaulting to 50 or base values), `sanity` (`{ current: 50, start: 50, max: 99 }`), `hitPoints`, and `magicPoints`.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx`.

### Item 11: Call of Cthulhu 7e Stray "0" in Spells & Mythos View (`frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx`)
- **Problem**: The expression `(data.spellsAndMythos?.cthulhuMythos || data.spellsAndMythos?.spells?.length)` evaluates to `0` when `cthulhuMythos === 0` and `spells` is empty or undefined. In React JSX, `{0 && <Component />}` or `{0 || false}` prints literal string `"0"` onto the DOM.
- **Remediation**:
  - Update condition to strict boolean check:  
    `Boolean((data.spellsAndMythos?.cthulhuMythos ?? 0) > 0 || (data.spellsAndMythos?.spells?.length ?? 0) > 0)` or  
    `((data.spellsAndMythos?.cthulhuMythos ?? 0) > 0 || (data.spellsAndMythos?.spells?.length ?? 0) > 0)`.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx`.

### Item 12: Call of Cthulhu 7e Duplicate Specialization Label (`frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`)
- **Problem**: For specialized skills (e.g. `Science (Physics)`, `Other Language (Latin)`), `displayName` already includes the parenthesized specialization name. `SkillRow` renders `{displayName}` followed by a secondary `({specialization})` tag, resulting in duplicate renderings like `"Science (Physics) (Physics)"`.
- **Remediation**:
  - In `SkillsList.tsx`, only render the secondary specialization badge/tag if `specialization` is defined AND `!displayName.includes(specialization)`.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`.

### Item 13: Call of Cthulhu 7e Skill Input Reset on Clear (`frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`)
- **Problem**: When editing a skill value, `onChange` runs `parseInt(e.target.value) || 0`. As soon as the user backspaces or clears the text box to type a new two-digit value, the input snaps to `0` instead of the base skill value or an empty temporary state, frustrating user input.
- **Remediation**:
  - Manage local input string state or handle blank string on change without committing `0` immediately.
  - On blur, if empty or invalid, fallback to the base skill rating (`skill.baseValue ?? 0`) or previous valid number, and clamp between base value and 99.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`.

### Item 14: Call of Cthulhu 7e Missing `onRoll` on Specialized Skill Rows (`frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`)
- **Problem**: Regular skill rows receive the `onRoll` callback, allowing players to roll dice checks directly from the sheet. Specialized skill rows (`Firearms`, `Other Language`, `Science`, `Art and Craft`) omit `onRoll`, leaving them unclickable.
- **Remediation**:
  - Ensure the `onRoll` prop is forwarded to all specialized skill sub-rows with the correct skill name, value, and half/fifth thresholds.
- **Files**: `frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx`.

### Item 15: Call of Cthulhu 7e Damage Bonus & Build Table Extension Above 524 (`backend/src/utils/rules/callOfCthulhu7e.ts` & `frontend/src/utils/rules/callOfCthulhu7e.ts`)
- **Problem**: The helper `cocDamageBonusAndBuild(str, siz)` stops at `sum <= 524` (`+5D6`, build `6`). According to Call of Cthulhu 7e Keeper Rulebook (Table I: Damage Bonus and Build), for sums over 524, each additional 80 points or fraction thereof adds `+1D6` damage bonus and `+1` build (e.g., 525-604 is `+6D6` / `7`, 605-684 is `+7D6` / `8`, etc.).
- **Remediation**:
  - In both `backend/src/utils/rules/callOfCthulhu7e.ts` and `frontend/src/utils/rules/callOfCthulhu7e.ts`:
    ```typescript
    if (sum > 524) {
      const extraSteps = Math.ceil((sum - 524) / 80);
      const dice = 5 + extraSteps;
      const build = 6 + extraSteps;
      return { damageBonus: `+${dice}D6`, build };
    }
    ```
  - Ensure `tests/rules/keepInStep.test.ts` passes and tests boundary conditions (524, 525, 604, 605, 1000).
- **Files**: `backend/src/utils/rules/callOfCthulhu7e.ts`, `frontend/src/utils/rules/callOfCthulhu7e.ts`, `backend/tests/utils/rules/callOfCthulhu7e.test.ts`, `tests/rules/keepInStep.test.ts`.

### Item 16: Character Sheet Viewer Owner Name 403 (`frontend/src/components/character/CharacterSheetViewerModal.tsx`)
- **Problem**: In `CharacterSheetViewerModal.tsx`, when viewing another user's sheet in a campaign, the component invokes `GET /api/users/:userId`. This endpoint correctly enforces privacy and returns `403 Forbidden` for non-admins, displaying `"Unknown Player"` for legitimate campaign DMs or players.
- **Remediation**:
  - Do not weaken or change `GET /api/users/:id`.
  - Resolve the owner display name through the campaign context:
    1. Check `campaign?.members?.find(m => m.userId === character.userId)?.user?.displayName`.
    2. Fallback to `character.user?.displayName` (populated by backend character queries).
    3. If current user is viewing their own sheet or is an Administrator, fetch via `GET /api/users/:userId` if not already present.
    4. Fallback to `"Player"` or `"Campaign Member"` if completely unresolvable, never throwing an uncaught 403 toast.
- **Files**: `frontend/src/components/character/CharacterSheetViewerModal.tsx`.

### Item 17: Character Sheet Viewer Inert Roll Handler (`frontend/src/components/character/CharacterSheetViewerModal.tsx`)
- **Problem**: When opening `CharacterSheetViewerModal` from the standalone `/characters` route (outside of any active campaign session), `rollHandler` is still passed to the sheet view components. Stat badges appear clickable, but clicking them does nothing because no WebSocket connection exists.
- **Remediation**:
  - Check whether a live campaign WebSocket connection is active (`Boolean(campaignId && isConnected)`).
  - If not in an active campaign session with a connected socket, pass `rollHandler={undefined}` so that clickable hover styles and roll prompts are disabled.
- **Files**: `frontend/src/components/character/CharacterSheetViewerModal.tsx`.

### Item 18: Published Character Template Validation & Picture Picker (`frontend/src/components/character/CharacterTemplateEditorModal.tsx`)
- **Problem**:
  1. When saving a published template fails schema validation, the error modal displays a generic message `"Template data does not match game system schema"` without pinpointing the invalid fields.
  2. The token image picker allows uploading personal assets, but published character templates require global assets (`asset.campaignId === null && asset.isGlobal === true`), causing template saves with personal pictures to be rejected by the backend.
- **Remediation**:
  - Use `refusedSaveMessage` formatting (parsing Zod issues from API responses) to highlight invalid field paths and reasons.
  - For published templates, restrict the asset selector strictly to global library assets, or hide the personal upload tab when editing templates.
- **Files**: `frontend/src/components/character/CharacterTemplateEditorModal.tsx`.

### Item 19: New Character Modal Name Limit & Creation Note (`frontend/src/components/character/NewCharacterModal.tsx`)
- **Problem**: In `NewCharacterModal.tsx`, client-side validation enforces `< 100` characters, displaying `"Name must be less than 100 characters"`, while backend schema and editors allow up to 200 characters (`SHEET_NAME_MAX = 200`). Additionally, a helper note claims the user will be automatically redirected to the editor upon creation, which does not match actual modal closure behavior.
- **Remediation**:
  - Align client validation to `SHEET_NAME_MAX = 200` (`name.length <= 200`). Update error message to `"Name must be 200 characters or less"`.
  - Align the modal footer note to reflect actual post-creation behavior (e.g. "Character created and added to your collection").
- **Files**: `frontend/src/components/character/NewCharacterModal.tsx`.

### Item 20: Character Templates Search LIKE Escaping & `canEditCharacter` Unification (`backend/src/routes/characterTemplates.ts` & `backend/src/services/permissions.ts`)
- **Problem**:
  1. In `backend/src/routes/characterTemplates.ts`, the `search` query parameter is interpolated directly into `LIKE` / `ILIKE` queries without escaping `%` and `_` characters, allowing wildcard pattern injections.
  2. In `backend/src/services/permissions.ts`, `canEditCharacter` was uncalled, diverged from `PUT /api/characters/:id` in `backend/src/routes/characters.ts`, permitted arbitrary global admins without campaign membership checks, and did not properly forbid spectators who own characters.
- **Remediation**:
  - In `backend/src/routes/characterTemplates.ts`, import `escapeLikePattern` and escape `search` prior to constructing SQL queries:
    ```typescript
    const escapedSearch = escapeLikePattern(search);
    // Use escapedSearch with %${escapedSearch}%
    ```
  - In `backend/src/services/permissions.ts`, align `canEditCharacter` to become the canonical authority for character editing:
    ```typescript
    export async function canEditCharacter(params: {
      userId: string;
      character: { userId: string; campaignId: string | null };
      membership?: { role: CampaignRole } | null;
      ownerStillIn?: boolean;
    }): Promise<boolean>
    ```
    - If `membership?.role === 'SPECTATOR'`, return `false`.
    - If `character.userId === userId`, return `true` (if member in campaign, membership cannot be SPECTATOR).
    - If `character.campaignId` is present and `membership?.role === 'DM'`, return `Boolean(ownerStillIn)`.
    - Otherwise return `false`.
  - In `backend/src/routes/characters.ts` (specifically `PUT /api/characters/:id`), invoke `canEditCharacter(...)` rather than duplicating ad-hoc inline access control.
- **Files**: `backend/src/routes/characterTemplates.ts`, `backend/src/services/permissions.ts`, `backend/src/routes/characters.ts`, `backend/tests/services/permissions.test.ts`.

---

## 4. Referenced TODO Removal Inventory

All 20 referenced `// TODO(#152): ...` comments located in the following 12 files must be removed as part of this implementation:
1. `backend/src/routes/characterTemplates.ts` (Item 20a)
2. `backend/src/services/permissions.ts` (Item 20b)
3. `backend/src/validators/game-systems/pathfinder2e.schema.ts` (Item 5)
4. `backend/src/utils/rules/callOfCthulhu7e.ts` (Item 15)
5. `frontend/src/utils/rules/callOfCthulhu7e.ts` (Item 15)
6. `frontend/src/components/character-sheets/dnd5e/DnD5eCharacterEditor.tsx` (Items 1, 2, 3, 4)
7. `frontend/src/components/character-sheets/pathfinder2e/Pathfinder2eCharacterEditor.tsx` (Items 6, 7, 8)
8. `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor.tsx` (Items 9, 10)
9. `frontend/src/components/character-sheets/call-of-cthulhu-7e/CallOfCthulhu7eCharacterView.tsx` (Item 11)
10. `frontend/src/components/character-sheets/call-of-cthulhu-7e/components/SkillsList.tsx` (Items 12, 13, 14)
11. `frontend/src/components/character/CharacterSheetViewerModal.tsx` (Items 16, 17)
12. `frontend/src/components/character/CharacterTemplateEditorModal.tsx` (Item 18)
13. `frontend/src/components/character/NewCharacterModal.tsx` (Item 19)

---

## 5. Security & Threat Modeling (OWASP)

- **OWASP A01: Broken Access Control**: Unifying character edit checks into `canEditCharacter` eliminates authorization bypasses. Spectators are strictly blocked from editing sheets, even if they own them within that campaign.
- **OWASP A03: Injection**: Escaping search queries in `characterTemplates.ts` with `escapeLikePattern` prevents SQL LIKE pattern manipulation.
- **OWASP A04: Insecure Design & Privacy**: Preserving 403 restrictions on `GET /api/users/:id` ensures non-admin users cannot scrape user account details. Owner names are surfaced only via authorized campaign membership lists.

---

## 6. Verification & Test Plan

### 6.1 Backend Automated Tests
- `backend/tests/services/permissions.test.ts`:
  - Character owner can edit when role is `PLAYER`.
  - Character owner CANNOT edit when role is `SPECTATOR`.
  - Campaign DM can edit character if owner is still in campaign.
  - Campaign DM CANNOT edit character if owner has left campaign.
  - Unrelated user cannot edit.
- `backend/tests/validators/pathfinder2e.test.ts`:
  - Armor class total of 9 passes validation.
  - Class DC total of 9 passes validation.
  - Negative totals (< 0) are rejected.
- `backend/tests/routes/characterTemplates.test.ts`:
  - Searching with `%` and `_` treats characters literally and returns correct matches.
- `backend/tests/utils/rules/callOfCthulhu7e.test.ts` & `tests/rules/keepInStep.test.ts`:
  - Str + Siz = 524 -> `+5D6`, build 6.
  - Str + Siz = 525 -> `+6D6`, build 7.
  - Str + Siz = 604 -> `+6D6`, build 7.
  - Str + Siz = 605 -> `+7D6`, build 8.
  - Keep-in-step test verifies identical outputs between backend and frontend modules.

### 6.2 Frontend Automated & Component Tests
- `DnD5eCharacterEditor.test.tsx`:
  - Changing ability does not inject negative compensatory bonus to other bonus.
  - Add custom skill button disabled at 30 skills.
  - Add other damage roll button disabled at 10 damage rolls.
  - Missing nested ability blocks do not crash editor.
- `Pathfinder2eCharacterEditor.test.tsx`:
  - Inventory item with bulk `"2"` properly contributes 2 to total bulk.
  - Starter template feat with `notes` renders text in description input.
- `CallOfCthulhu7eCharacterEditor.test.tsx`:
  - Investigator with POW 100 receives max 99 starting Sanity and valid save.
- `CallOfCthulhu7eCharacterView.test.tsx`:
  - Zero cthulhu mythos and empty spells do not display literal `"0"`.
- `SkillsList.test.tsx`:
  - Specialized skill row `Science (Physics)` does not display duplicate `(Physics)`.
  - Clearing skill value input does not force immediate reset to 0.
  - Specialized skill rows receive and trigger `onRoll`.
- `CharacterSheetViewerModal.test.tsx`:
  - Does not call `GET /api/users/:id` for other users; resolves name from campaign roster.
  - Disables roll handler when not in active campaign session.
- `NewCharacterModal.test.tsx`:
  - Accepts name up to 200 characters.
