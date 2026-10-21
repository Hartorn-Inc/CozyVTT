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
A shareable sheet in the Instance library, readable by every signed-in user. Distinct from a starter template and from a token template.
_Avoid_: Public template, character template (unqualified), shared template

**Token template**:
A reusable token definition that belongs to one Campaign.
_Avoid_: Template (unqualified), token preset

**Keeper's Notes**:
The Call of Cthulhu field on a Character that only the DM of that Character's Campaign may read or write. It is a field, not a role.
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
