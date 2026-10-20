# CozyVTT

A self-hosted, browser-based virtual tabletop for narrative-driven RPG campaigns. This Hartorn-Inc copy is an independent clone of CheekyChinchilla/CozyVTT.

## Language

**Campaign**:
An isolated table: maps, tokens, members, and sessions belonging to one group.
_Avoid_: Game, world, instance (for this object)

**Session**:
A live play period on a campaign, with captured table state.
_Avoid_: Game, match

**DM**:
The member currently running a campaign's table. The seat can be handed to another member without changing campaign ownership.
_Avoid_: GM, narrator, host (for this role)

**Token**:
A piece on a campaign map (player, NPC, or object) with position, image, and optional stats.
_Avoid_: Sprite, pawn, miniature
