---
status: accepted
---
# Map Lighting, Doors, Manual Fog, and Wall Selection Concurrency

## Context

In CozyVTT, interactive map elements such as doors, walls, lighting, and fog of war interact in complex ways across client and server state. Five referenced TODOs and active defects were identified across `backend/src/websocket/handlers/walls.ts` and `frontend/src/components/campaign/MapCanvas.tsx` (Issue #156):

1. **Player Door Toggle Through Manual Fog**: When a player toggled a door on a map with dynamic lighting, line-of-sight was evaluated, but manual fog coverage was ignored. On maps with manual fog (or without dynamic lighting), a player could click doors in unrevealed areas covered by fog, receiving responses from the server that confirmed the existence of hidden doors.
2. **Player-View Preview Lockout**: In `MapCanvas.tsx`, the button allowing a DM to exit `dmPreviewPlayerView` only rendered when `lightingEnabled` or `fogEnabled` was active. If the DM turned off both dynamic lighting and fog of war while in preview mode, the exit button disappeared and nothing reset the preview state, trapping the DM in preview mode until a page reload.
3. **Light Tool Active During Player-View Preview**: Pointer handlers for placing, selecting, and dragging light sources checked `isDM` but did not verify `!dmPreviewPlayerView`. Consequently, clicks during a preview (where light source markers are deliberately hidden) still placed, selected, or moved lights invisibly.
4. **Concurrent Door Toggle Overwrite During DM Wall Drag**: When a DM dragged wall segments or endpoints, `wallMoveRef` and `wallDragEndpointRef` stored a `preDragState` snapshot captured at drag start. Any concurrent door toggle emitted by a player and received via socket was added to history, but the preview and final drop dispatched `preDragState` translated by delta, overwriting and reverting the concurrent player door changes.
5. **Door Click vs Token Pickup Priority at Fit-to-Screen Zoom**: The hit detection radius for doors was fixed at `18px` in screen coordinates. At low zoom levels (e.g. fit-to-screen zoom), 18 screen pixels could span an entire grid cell or more, causing clicks intended to select or drag a token adjacent to a door to trigger the door toggle instead.
6. **Wall Selection Handlers Encapsulation**: Multiple wall pointer and keyboard event handlers in `MapCanvas.tsx` closed over canvas state, marked by a TODO for clean encapsulation.

## Decision

1. **Server and Client Fog Authorization for Doors**:
   - In `backend/src/websocket/handlers/walls.ts`, when a non-DM toggles a door on a map where `fogEnabled` is true, calculate the door midpoint $M = ((x_1 + x_2)/2, (y_1 + y_2)/2)$ and orthogonal unit normal vector $\vec{n}$. Sample two points offset by half the grid size: $P_1 = M + \vec{n} \cdot (gridSize / 2)$ and $P_2 = M - \vec{n} \cdot (gridSize / 2)$.
   - If manual fog is enabled on the map, at least one of $P_1$ or $P_2$ must fall within a revealed fog cell (or explored cell). If neither point is in a revealed cell, reject the door toggle with `{ refused: 'You cannot see that door', current: door }` without leaking door state.
   - In `frontend/src/components/campaign/map/doorAccess.ts` and `MapCanvas.tsx`, mirror this check in `doorOffered()` and `offeredDoorAt()`. If fog is enabled and both orthogonal sampling points are unrevealed, hide the interaction affordance and ignore clicks.

2. **Preview Lifecycle and Tool Deactivation**:
   - In `MapCanvas.tsx`, add an effect that resets `dmPreviewPlayerView` to `false` whenever both `currentMap.lightingEnabled` and `currentMap.fogEnabled` are falsy.
   - Ensure the exit preview button remains rendered as long as `dmPreviewPlayerView` is `true`, even if map settings change dynamically.
   - Guard light tool pointer handlers (`lightMode && isDM && !dmPreviewPlayerView`), disabling light creation, selection, and dragging while previewing as a player.

3. **Concurrent State Merge During Wall Drags**:
   - When a socket event `walls:update` or `walls:replace` arrives while `wallMoveRef.current` or `wallDragEndpointRef.current` is active, update `preDragState` for any segment whose ID is not part of the active selection (`selectedWallIds`).
   - This guarantees that when the DM finishes the drag and commits `preDragState` plus translation, concurrent door toggles or independent wall edits are preserved.

4. **Hit Radius Scaling and Priority Arbiter**:
   - Scale the door hit radius in world coordinates: $R_{door} = \min(18 / zoom, gridSize \times 0.3)$.
   - In `handleMouseDown`, prioritize token selection and pickup over door toggles when a token occupies the clicked location.

5. **Cleanup of Referenced TODOs**:
   - Remove the 5 corresponding `TODO(#156)` comments across `backend/src/websocket/handlers/walls.ts` and `frontend/src/components/campaign/MapCanvas.tsx`.

## Consequences

- **Positive**:
  - Prevents players from probing unseen rooms through manual fog by clicking on invisible doors.
  - Eliminates the UX trap where DMs were locked in player preview mode upon toggling off lighting/fog.
  - Prevents accidental invisible light placements while previewing player vision.
  - Resolves race conditions between DM wall repositioning and player door interactions.
  - Ensures tokens can be picked up cleanly even at low zoom levels next to doors.
  - Cleans up referenced technical debt comments.

- **Negative / Trade-offs**:
  - Additional geometric sampling (midpoint orthogonal offsets) runs during door toggle authorization, with negligible performance cost ($O(1)$ lookup in fog grid).
