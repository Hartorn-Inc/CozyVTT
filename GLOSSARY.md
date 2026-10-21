# CozyVTT

A self-hosted, browser-based virtual tabletop for narrative-driven RPG campaigns. This Hartorn-Inc copy is an independent clone of CheekyChinchilla/CozyVTT.

## Language

**Instance**:
The running CozyVTT installation: one server, its settings, and its users.
_Avoid_: Installation, site, server (for this object)

**Administrator**:
A user with platform-wide access on the Instance. Distinct from the campaign owner and the sitting DM.
_Avoid_: Admin (unqualified), platform admin, root, owner

**Setup**:
The one-time act that creates the first Administrator and makes the Instance usable.
_Avoid_: Wizard, onboarding, initialization

**Campaign**:
An isolated table: maps, tokens, members, and sessions belonging to one group.
_Avoid_: Game, world, instance (for this object)

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
