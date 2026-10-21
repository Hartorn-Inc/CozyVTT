# Live-table visibility uses three clocks, and initiative is a roster

The database is authoritative; socket events are deltas filtered per socket at send time. **Initiative** is a combat roster, not a vision channel: a token in the dark or under **fog** stays listed, while hidden, other-map, and unseen **spirit-layer** tokens do not. Fog operations cap at 20,000 cells per message; **explored-memory** reset wins on its own epoch and does not invalidate tokens, fog, or pings. Reconnect keeps the last frame and catch-up is silent. Join, **current-map** identity, and explored-memory epoch are separate clocks — one map-wide generation would make a memory reset drop a good token move. Writes authorize at commit time; a ping whose map is not in this campaign vanishes.

**Status**: accepted
