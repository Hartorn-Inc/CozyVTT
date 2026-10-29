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

**Cluster Upgrade**:
A controlled migration of an existing PostgreSQL data cluster from one major version directory (e.g. `18/docker`) to a new major version directory (e.g. `19/docker`) using `pg_upgrade --link` or verified dump/restore fallback.
_Avoid_: silent re-init, auto-migrate, in-place overwrite

**Upgrade Guardrail**:
A container pre-start check executed inside the database image before the standard PostgreSQL daemon starts, preventing silent initialization of an empty cluster when an older major-version cluster already exists on the mounted volume.
_Avoid_: manual fail-safe, docker restart loop

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
The user currently running a Session. They can edit notes and spirits for that session, and can move monsters and NPCs during combat. Can be the Campaign owner or any player given permission.
_Avoid_: DM (unqualified), GM, host

**Player**:
A user who has joined a Campaign. A Player controls only their assigned Characters.
_Avoid_: Member, user (for this role)

**Member**:
A user with access to a Campaign. May be the Campaign owner, a sitting DM, or a Player.
_Avoid_: User (for this scope)

**Session**:
A single sitting of a Campaign, either active (running) or ended (history). A Campaign can have only one active Session at a time.
_Avoid_: Game, meet, run

**Live table**:
The real-time shared view of an active Session: map, tokens, initiative, and dice rolls synced across all connected members via WebSockets.
_Avoid_: Table (unqualified), board, canvas

**Map**:
A shared tactical or narrative surface within a Campaign. A Campaign has one active Map during a Session. A Map has a background image, a grid, and token placements.
_Avoid_: Scene, board, canvas (for this object)

**Grid**:
The coordinate overlay on a Map (square or hex) used for measurement, token snapping, and fog of war alignment.
_Avoid_: Snap grid, board lines

**Fog of war**:
A DM-controlled mask on a Map that conceals areas from Players until revealed.
_Avoid_: Shroud, darkness, mist

**Spirit**:
A DM-only narrative note pinned to a location on a Map, visible only to the DM, containing lore, encounter triggers, or reminders.
_Avoid_: Note (for map-pinned items), pin, secret note

**Spirit layer**:
The Map layer where Spirits live. Visible only to the DM; never broadcast to Players.
_Avoid_: GM layer, hidden layer, DM layer

**Token**:
A visual marker placed on a Map representing a Character, monster, NPC, or object.
_Avoid_: Piece, pawn, figure, mini

**Combat tracker**:
The tool that manages initiative order, turn progression, and active conditions during an encounter in a Session.
_Avoid_: Initiative tracker, turn tracker

**Dice roll**:
A die expression (e.g. `2d6+3`) evaluated by the server and broadcast to the Campaign session, with optional visibility (public, DM-only, or blind).
_Avoid_: Roll, throw

**Blind roll**:
A Dice roll whose result is visible only to the DM, not to the Player who rolled it.
_Avoid_: Secret roll, hidden roll

**Character sheet**:
The structured record of a Character's stats, abilities, inventory, and notes, governed by the Campaign's Game system.
_Avoid_: Sheet (unqualified), stat block, bio

**Game system**:
A ruleset plugin or built-in definition (e.g. `dnd5e`, `pathfinder2e`, `generic`) that defines the structure and validation of Character sheets, rolls, and mechanics.
_Avoid_: Ruleset, system (unqualified)

**Compendium**:
A searchable library of game content (spells, items, monsters, rules) available to Campaigns using a supported Game system.
_Avoid_: Library, rulebook, SRD (for this feature)

**Asset**:
A media file (image, audio) uploaded to the Instance and stored on the server, referenced by Maps, Tokens, or Campaign settings.
_Avoid_: Upload, file, media

**User**:
A registered account on the Instance, identified by username and email. Distinct from Member, Player, DM, Operator, and Administrator.
_Avoid_: Account (for the person), profile

**Display name**:
The name shown to other users in Campaigns and chat. Set per User, independent of username.
_Avoid_: Nickname, handle, screen name
