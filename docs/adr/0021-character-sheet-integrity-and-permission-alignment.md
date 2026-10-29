# 21. Character Sheet Integrity, Permissions Unification, and System Rules Parity

## Context

During character sheet development across D&D 5e, Pathfinder 2e, and Call of Cthulhu 7e, several inconsistencies and edge-case defects accumulated across backend validators, routes, and frontend editor/viewer components. Furthermore, twenty inline debt comments (`// TODO(#...): ...`) were catalogued across twelve files.

Two architectural tensions required explicit decisions:
1. **Authority on Character Edit Access Control (ADR-0014 reconciliation)**: `backend/src/services/permissions.ts` contained a dormant `canEditCharacter` function that diverged from `PUT /api/characters/:id` in `backend/src/routes/characters.ts`. Specifically, the helper bypassed campaign membership checks for platform administrators outside campaign context, failed to disallow editing for spectators who own a character, and required callers to pass campaign identifiers explicitly. ADR-0014 dictates that permission helpers must not be blindly deleted or duplicated when multiple authorities compete.
2. **State Backfill vs Interactive Reactivity in D&D 5e**: The legacy backfill logic in `DnD5eCharacterEditor.tsx` was executing inside a continuous `useEffect`. When a character lacked a spellcasting ability, the default spell DC (`8 + proficiency`) was misidentified as an intentional manual override, prompting the backfill to record `- modifier` into `spellSaveDCOtherBonus` upon ability selection. This froze derived calculations.
3. **User Privacy vs Character Owner Display in Viewers**: `GET /api/users/:id` intentionally returns `403 Forbidden` for non-admin, non-self queries to prevent profile harvesting. In campaign contexts, DMs viewing player sheets received 403s and saw fallback placeholder names (`"Unknown Player"`).
4. **Validation Bounds vs System Rules**: Pathfinder 2e derived totals for Armor Class, Class DC, and Spell DC enforced a schema-level `min(10)`. In Pathfinder 2e rules, an untrained character with a negative ability modifier (e.g., Dexterity -1) can legitimately have an AC of 9, leading to un-saveable legal characters.

## Decision

1. **Single Source of Truth for Character Editing**:
   - Refactor `canEditCharacter` in `backend/src/services/permissions.ts` to strictly mirror the domain rules of `PUT /api/characters/:id`:
     - System/Campaign role `SPECTATOR` is strictly prohibited from editing characters.
     - Character owner (`character.userId === userId`) is permitted, provided their membership role in the assigned campaign is not `SPECTATOR`.
     - The sitting `DM` of the campaign is permitted to edit a character if and only if the character owner remains an active member of that campaign (`ownerStillIn(character.userId, character.campaignId)`).
     - Platform administrators have no contextual bypass inside a campaign unless they hold an editing role (DM/Owner).
   - Route `PUT /api/characters/:id` delegates directly to `canEditCharacter`, eliminating redundant access logic.

2. **Initialization-Only Backfill Migration**:
   - Legacy compatibility backfill for D&D 5e spell save DC and attack bonus runs strictly once during initial `formData` parsing/hydration from character `data`.
   - Subsequent interactive updates to `spellcasting.ability` or scores purely recompute derived totals (`8 + proficiency + abilityModifier + otherBonus`) without mutating `otherBonus`.

3. **Owner Resolution via Campaign Context and Payload**:
   - Keep `GET /api/users/:id` access restrictions unchanged to preserve user privacy.
   - In `CharacterSheetViewerModal.tsx`, resolve the owner's display name from the campaign membership roster (`campaign.members`) or from the character response payload (`character.user?.displayName`), avoiding direct unauthorized user fetches.

4. **Relaxation of Pathfinder 2e Derived Bounds**:
   - Change `.min(10)` to `.min(0)` for derived totals in `armorClassSchema`, `classDCSchema`, and `spellcastingSchema` in `backend/src/validators/game-systems/pathfinder2e.schema.ts`.

5. **Safe Structural Defaults and Rules Parity**:
   - Replace all `({} as T)` casts in sheet editors with typed fallback factories that provide complete initial structures.
   - Cap Call of Cthulhu 7e starting Sanity at 99 for POW 100, and current Sanity at `maxSanity` (`99 - Cthulhu Mythos`).
   - Extend Call of Cthulhu 7e Table I damage bonus and build formulas past 524 (+1D6 and +1 build per 80 points) in both backend and frontend rules helpers, verified by `keepInStep.test.ts`.
   - Escape SQL LIKE search patterns in `backend/src/routes/characterTemplates.ts` using `escapeLikePattern`.

## Consequences

- Write authorization for characters is centralized in a reusable, unit-tested permission helper aligned with ADR-0014.
- D&D 5e spellcasting calculations react smoothly to ability modifier changes without corrupted compensatory bonuses.
- Campaign participants view accurate character owner names without relaxing Instance user profile privacy boundaries.
- Valid Pathfinder 2e characters with low attribute modifiers can be saved and edited without rejection.
- Call of Cthulhu 7e extreme stat characters (POW 100, STR+SIZ > 524) behave according to official rules on both backend and frontend.
- All 20 referenced `TODO(#...)` comments across the 12 files are resolved and retired.

**Status**: accepted
