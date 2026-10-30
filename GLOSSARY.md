# CozyVTT

A self-hosted, browser-based virtual tabletop for narrative-driven RPG campaigns. This Hartorn-Inc copy is an independent clone of CheekyChinchilla/CozyVTT.

## Language

**Instance**:
The running CozyVTT installation: one server, its settings, and its users.
_Avoid_: Installation, site, server (for this object)

**Administrator**:
A user with platform-wide access on the Instance. Distinct from the campaign owner and the sitting DM.
_Avoid_: Admin (unqualified), platform admin, root, owner

**Operator**:
The person who runs the host: Compose, the tunnel, volumes, and off-host backup copies. Distinct from Administrator, campaign owner, and DM.
_Avoid_: Self-hoster, sysadmin, admin (unqualified), host (for this role)

**Bootstrap superuser**:
The PostgreSQL role Compose creates from `DATABASE_USER` on an empty volume. First start after upgrade uses it to create the schema owner. The app does not connect as this role.
_Avoid_: database admin, postgres user (unqualified)

**Schema owner**:
The non-superuser PostgreSQL role (`DATABASE_APP_USER`, default `cozyvtt_app`) that owns the Instance database and `public` schema, runs migrations, and is the backend `DATABASE_URL` user. Distinct from the bootstrap superuser.
_Avoid_: database admin, postgres user (unqualified)

**Instance backup**:
An encrypted archive of the Instance's database and uploads, enough to restore that Instance.
_Avoid_: Backup (unqualified), snapshot, dump (for this object)

**Database dump**:
A database-only export. It does not restore uploads. Distinct from an Instance backup.
_Avoid_: Backup (for this object), Instance backup

**Setup**:
The one-time act that creates the first Administrator and makes the Instance usable.
_Avoid_: Wizard, onboarding, initialization

**Campaign**:
An isolated table: maps, tokens, members, and sessions belonging to one group.
_Avoid_: Game, world, instance (for this object)

**Vibe**:
A Campaign's atmosphere: named periods with colour, a map filter, and optional audio. Distinct from Session status and from the spirit layer.
_Avoid_: Mood, atmosphere (unqualified), ambiance (for this object)

**Campaign owner**:
The user who owns the campaign. Distinct from the sitting DM.
_Avoid_: Host, admin (for this role)

**Member**:
A user with a role in a campaign: DM, player, or spectator.
_Avoid_: Participant, player (for the membership itself)

**Session**:
A live play period on a campaign, with captured table state.
_Avoid_: Game, match, login, sign-in (for this object)

**Login session**:
The signed-in connection of a browser to the instance. Distinct from a play Session.
_Avoid_: Session (for this object)

**DM**:
The member currently running a campaign's table. The seat can be handed to another member without changing campaign ownership.
_Avoid_: GM, narrator, host (for this role)

**Character**:
A playable sheet belonging to one user, assigned to at most one campaign.
_Avoid_: PC, sheet (when meaning this object)

**Character owner**:
The user the character belongs to. Distinct from the campaign owner and the DM.
_Avoid_: Owner (unqualified)

**Character edit permission**:
The authoritative access control check (`canEditCharacter`) governing write operations on a Character, enforcing that spectators cannot edit, character owners can edit, and the sitting DM can edit if and only if the character owner is still an active member of the campaign.
_Avoid_: Sheet permission (unqualified), edit check (for this authorization gate)

**Game system**:
The rules framework a Character's sheet is written for. A Character may have none.
_Avoid_: System (unqualified), ruleset, RPG system

**Flexible sheet**:
A Character or published character template with no game system: the player lays out sections instead of a fixed sheet.
_Avoid_: Custom sheet, generic sheet, untyped sheet

**Starter template**:
A hardcoded starting sheet for a game system, offered by the Instance.
_Avoid_: Template (unqualified), example sheet (for this object)

**Published character template**:
A shareable sheet in the Instance library, readable by every signed-in user. Distinct from a starter template and from a token template. Never carries Keeper's Notes.
_Avoid_: Public template, character template (unqualified), shared template

**Token template**:
A reusable token definition that belongs to one Campaign.
_Avoid_: Template (unqualified), token preset

**Keeper's Notes**:
The Call of Cthulhu field on a Character that only the DM of that Character's Campaign may read or write. It is a field, not a role. Published character templates never carry it.
_Avoid_: Keeper (as a role), GM notes, private notes (for this field)

**Derived value**:
A number the sheet can recompute from inputs the user entered. Distinct from a current resource and from a printed creature total.
_Avoid_: Cached total (as the concept), calculated field, computed stat (for this object)

**Current resource**:
The remaining amount of a pool the table spends at play, such as current hit points or remaining hit dice. Distinct from a derived value.
_Avoid_: HP (unqualified), pool (unqualified)

**Printed total**:
A creature number stored as printed, not recomputed from parts. Distinct from a Character derived value.
_Avoid_: Derived value (for this)

**Spellcasting ability backfill**:
A one-time initialization migration for legacy D&D 5e sheets without stored other-bonus properties, establishing initial values without contaminating interactive ability modifier updates with negative compensatory offsets.
_Avoid_: Spell backfill, auto-modifier, DC sync

**Sanity cap**:
The Call of Cthulhu 7e rules boundary where starting Sanity is strictly capped at 99 even when Power (POW) reaches 100, and current Sanity is bounded by maximum Sanity (`99 - Cthulhu Mythos`).
_Avoid_: SAN limit, max sanity (unqualified)

**Safe structural default**:
A typed fallback factory that guarantees full initial object structures for nested sheet properties (such as abilities, saving throws, characteristics, and appearance) to prevent undefined property reads on incomplete or legacy sheets.
_Avoid_: Empty cast, object fallback, dummy default

**Bulk parsing**:
The explicit conversion of textual and numeric bulk representation into standardized numerical units (e.g. integer or fractional light bulk) within Pathfinder 2e inventory and encumbrance calculations.
_Avoid_: String bulk, bulk conversion (unqualified)

**Uploader**:
The user who added an asset. Distinct from campaign owner and character owner.
_Avoid_: Owner, author (for this role)

**Personal asset**:
An asset that belongs to one user, not to a campaign.
_Avoid_: Private asset, user asset, shared asset (as a kind of ownership)

**Campaign asset**:
An asset that belongs to one campaign.
_Avoid_: Table asset, global asset (for this scope)

**Leftover file**:
A file on disk with no asset record. Distinct from a campaign asset whose campaign is gone.
_Avoid_: Orphaned asset (for this leftover)

**Token**:
A piece on a campaign map (player, NPC, or object) with position, image, and optional stats. It can exist without a bound character.
_Avoid_: Sprite, pawn, miniature

**Current map**:
The map the campaign is showing at the table.
_Avoid_: Active map, live map, shown map

**Prepared map**:
A campaign map that is not the current map.
_Avoid_: Inactive map, background map, draft map

**Fog**:
The DM's manual reveal grid on a map. Distinct from dynamic lighting and from explored memory.
_Avoid_: Darkness, vision, exploration (for this object)

**Fog raster cache**:
An offscreen canvas buffer sized at 1 pixel per grid cell representing the static manual fog state (unrevealed cells), blitted onto the main viewport in a single `drawImage` operation. Distinct from the dynamic lighting explored raster.
_Avoid_: Explored raster (for manual fog), fog bitmap, fog texture

**Explored memory**:
Per-member grey overlay of cells that member has already seen on a map. Distinct from fog. It is not used to decide whether a token is sent.
_Avoid_: Exploration (unqualified), vision history

**Dynamic lighting**:
Line-of-sight lighting on a map that can hide tokens from members who cannot see them. Distinct from fog.
_Avoid_: Vision, LOS, lighting (unqualified)

**Spirit layer**:
The second plane of a map, distinct from the material plane. A token lives on one or the other.
_Avoid_: Spirit plane, overlay (for this object)

**Spirit realm**:
The view a member has when they see the spirit layer instead of the material plane.
_Avoid_: Spirit plane (for this view)

**Initiative**:
The DM's combat turn order for a campaign. Distinct from the dice history of those rolls.
_Avoid_: Encounter, combat log (for this object)

**Dice expression**:
A text string specifying dice notation (such as `2d6`, `4d6kh3`, `1d20`) and arithmetic modifiers evaluated together to produce a roll result.
_Avoid_: Dice macro (when referring to expression syntax), roll formula

**Dice roll**:
The outcome and breakdown of an individual set of rolled dice within an expression, tracking rolls, kept values, and subtotals. Distinct from a static modifier.
_Avoid_: Roll result (for an individual dice group)

**Dice modifier**:
A constant numeric offset combined with dice rolls in a dice expression through addition, subtraction, multiplication, or division.
_Avoid_: Flat bonus, bonus (unqualified), stat offset

**Dice arithmetic evaluator**:
The internal, zero-dependency calculation engine embedded in CozyVTT that computes basic arithmetic operations (`+`, `-`, `*`, `/`), unary signs, and operator precedence for dice totals without external math packages.
_Avoid_: Math engine, mathjs evaluator

**Token controller**:
The member explicitly assigned control of a token, giving them permission to move and interact with it on the map canvas.
_Avoid_: Token owner, player (for the controller assignment)

## Contribution

**EPURE orchestration**:
The GitHub Actions workflow suite (`Giskard-AI/epure`) that plans specifications (`/epure plan`), fans out approved implementation tasks (`/epure approve`) on `feature/**` integration branches, and enforces the blocking `ai-review` check on pull requests.
_Avoid_: Cloud Agent (for this workflow), advisory review, Bugbot

**`ai-review`**:
The required, blocking GitHub check run (`epure-check.yml`) that dispatches the applicable readonly reviewers from `.cursor/agents/*.md` against a pull request diff and fails when any reviewer reports a `must_fix` finding.
_Avoid_: Advisory review, Codex review, Luna review, Grok review

**Reviewer pass**:
One readonly roster role from `.cursor/agents/*.md` run against a pull request or design gate, returning structured JSON findings (`must_fix`, `informational`, `no_action`).
_Avoid_: Codex pass, Luna pass, review (unqualified)

## Backlog and Documentation Governance

**Triage Matrix**:
A structured table classifying documented backlog items and technical debts into concrete actions: drop/delete, group, extract to GitHub Issue, or retain.
_Avoid_: Backlog list, todo list (for this audit tool)

**Extracted Feature Issue**:
A GitHub issue created to track a feature proposal, enhancement, or bug fix migrated from static documentation, carrying the label `scope:extracted-feature` and referencing its original source context.
_Avoid_: Story, ticket (unqualified), task (for this GitHub item)

**Referenced TODO**:
A source code comment adhering to the strict format `// TODO(#<issue_id>): <description>`, binding in-code debt directly to an active GitHub issue and eliminating unreferenced, floating TODOs.
_Avoid_: Raw TODO, FIXME (unreferenced), code note

**Markdown link integrity**:
The property where every internal relative hyperlink and header anchor (`#slug`) across repository Markdown files resolves to an existing file and heading without network requests.
_Avoid_: Link check (for the property itself)

**Dead backlog documentation**:
Static markdown documents (such as `docs/FUTURE_FEATURES.md`) storing unmanaged feature proposals or outdated bug lists outside the primary issue tracker.
_Avoid_: Archive, backlog file, future roadmap (for static documents)

## Binary Content Verification

**Magic Bytes**:
The initial byte sequence of a binary file used by file format sniffers to deterministically identify the real media format, independent of the filename extension or HTTP `Content-Type` header.
_Avoid_: File signature (unqualified), file header (when referring specifically to sniffer magic numbers)

**Binary Fixture Helper**:
A centralized test helper module (`backend/src/__tests__/helpers/binaryFixtures.ts`) providing minimal valid in-memory byte buffers for supported and unsupported media formats, ensuring tests run against the production `file-type` detector without external disk fixtures or stubs.
_Avoid_: Mock file, fake buffer, test stub

**Audio Fallback Sniffer**:
The application-level frame sniffer invoked when the primary `file-type` detector returns undefined on raw, headerless audio streams (such as MPEG audio frames without ID3 tags).
_Avoid_: Custom audio parser, fallback codec
