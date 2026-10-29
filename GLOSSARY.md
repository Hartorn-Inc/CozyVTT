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

**Sitting DM**:
The user currently running a campaign session. A campaign owner may hand this role to another member.
_Avoid_: DM (unqualified), GM, host

**Member**:
A user who belongs to a Campaign. May be the owner, a sitting DM, or a player.
_Avoid_: User (within a campaign context), participant, player (for the role)

**Player**:
A campaign member who is neither the owner nor the sitting DM for that session.
_Avoid_: User, member (when role distinction matters)

**Session**:
A scheduled or active play period within a Campaign.
_Avoid_: Game, meet, event

**Active session**:
A Session currently in progress. Only one may be active per Campaign at a time.
_Avoid_: Current game, live session

**Map**:
A play area within a Campaign, backed by an image asset and optionally layered with a grid, walls, lights, and tokens.
_Avoid_: Board, scene, canvas

**Grid**:
The coordinate overlay on a Map (square or hexagonal) that defines movement units.
_Avoid_: Overlay (unqualified), mesh

**Fog of war**:
The DM-controlled layer masking portions of a Map from players until revealed.
_Avoid_: Shroud, mask (unqualified), darkness

**Token**:
A visual marker placed on a Map representing a character, monster, or object.
_Avoid_: Pawn, piece, figure, avatar

**Wall**:
A line segment on a Map that blocks line of sight, light, or movement for tokens.
_Avoid_: Barrier, obstacle, line (unqualified)

**Asset**:
An uploaded file (image or audio) stored by CozyVTT and referenced by maps, tokens, or audio tracks.
_Avoid_: File, upload (unqualified), media

**Spirit layer**:
The second plane of a map, distinct from the material plane. A token lives on one or the other.
_Avoid_: Spirit plane, overlay (for this object)

**Spirit realm**:
The view a member has when they see the spirit layer instead of the material plane.
_Avoid_: Spirit plane (for this view)

**Initiative**:
The DM's combat turn order for a campaign. Distinct from the dice history of those rolls.
_Avoid_: Encounter, combat log (for this object)

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

## Dice Notation and Parsing

**Dice Expression**:
A mathematical string describing one or more die rolls with optional modifiers and arithmetic operations (e.g., `1d20+5`, `4d6kh3`, `2d20kl1-2`, `d%`).
_Avoid_: Dice formula, roll command, dice string (unqualified)

**Dice AST**:
The deterministic Abstract Syntax Tree generated by `parseDiceAST` representing tokenized dice groups, constant modifiers, and binary operations without invoking random roll generation.
_Avoid_: Parsed roll, roll tree, math expression

**Roll Evaluation**:
The execution phase that traverses a validated `DiceAST`, samples random numbers via a designated RNG provider for each die node, calculates keep/drop sets, and computes final arithmetic totals.
_Avoid_: Parsing, rolling (unqualified when separating AST from roll execution)

**Dice Selection Modifier**:
A qualifier affixed to a dice term instructing the evaluator to retain or omit specific subsets of rolled dice: Keep Highest (`kh`), Keep Lowest (`kl`), Drop Highest (`dh`), or Drop Lowest (`dl`).
_Avoid_: Die filter, roll option, dice flag

**Grammar Parity**:
The strict requirement that frontend validation (`frontend/src/utils/diceExpression.ts`) and backend expression handling (`backend/src/utils/dice-parser.ts`) accept and reject identical expression subsets, enforced continuously by automated tests (`keepInStep.test.ts`).
_Avoid_: Loose validation, syntax alignment
