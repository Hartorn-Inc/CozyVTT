# A Character joins a typed Campaign only on the same game system

Create-in and assign refuse when the **Campaign** has a **game system** and the **Character**'s differs, including a Flexible sheet into a typed Campaign. A Campaign with no game system accepts any Character. Existing mismatches still load; the next write is 400. We rejected treating `Campaign.gameSystem` as advisory and a bulk rewrite of already-assigned Characters.

**Status**: accepted
