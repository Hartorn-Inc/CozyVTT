# Character assignment lives on the character

A character is in at most one campaign, and that fact belongs to the character, not to a member's list of ids. We rejected keeping `CampaignMembership.characterIds` as a second register: the two copies already drift, concurrent assign/unassign is not atomic, and roster "control" is just "characters this member owns that are assigned here". The membership array is derived or removed; on existing disagreement, the character's assignment wins.

**Status**: accepted
