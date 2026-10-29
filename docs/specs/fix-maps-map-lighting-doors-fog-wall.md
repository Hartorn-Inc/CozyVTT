# Specification: Map Lighting, Doors, Fog, and Wall Selection Edge Cases

## 1. Overview and Problem Statement

This specification addresses 6 interrelated defects and technical debt items regarding map dynamic lighting, door interaction authorization, manual fog of war, player-view preview lifecycle, and wall drag concurrency in CozyVTT (Issue #156).

### Key Deficiencies
1. **Player Door Toggle Through Manual Fog**: Players can toggle doors located entirely inside unrevealed manual fog cells. On maps without dynamic lighting, or behind walls where fog is unrevealed, players can click blindly and learn from server responses whether a door is present.
2. **Player-View Preview Lockout**: DMs entering `dmPreviewPlayerView` cannot exit if both `lightingEnabled` and `fogEnabled` are turned off, because the exit button conditionally unmounts and no reset effect runs.
3. **Light Tool Active During Player Preview**: Light placement, selection, and drag handlers check `isDM` but not `!dmPreviewPlayerView`, enabling accidental hidden light source mutations.
4. **Concurrent Door Toggle Overwrite During Wall Drag**: While a DM drags walls or endpoints, an incoming `doorOpen` or door toggle update from another user is recorded in history but dropped when the DM releases the mouse, because `preDragState` overwrites the wall list.
5. **Door Click vs Token Pickup Priority at Fit-to-Screen Zoom**: A fixed screen-space door hit radius (18px) spans a large world distance at low zoom levels, intercepting clicks meant for adjacent tokens.
6. **Wall Selection Handlers Encapsulation and Referenced TODOs**: MapCanvas contains coupled pointer/keyboard closures and 5 active `TODO(#156)` markers.

---

## 2. Functional & Technical Requirements

### R1: Manual Fog Door Authorization (Backend & Frontend)
- **Backend (`backend/src/websocket/handlers/walls.ts`)**:
  - When a non-DM client emits `wall:update` attempting to toggle a door (`door-open` <-> `door-closed`):
    - If `map.fogEnabled` is `true`, retrieve the fog of war state for the map.
    - Compute the midpoint $M = ((x_1 + x_2)/2, (y_1 + y_2)/2)$.
    - Compute the segment direction $\vec{d} = (x_2 - x_1, y_2 - y_1)$. Normalize to $\hat{u} = \vec{d} / |\vec{d}|$.
    - Compute the orthogonal normal vector $\vec{n} = (-\hat{u}_y, \hat{u}_x)$.
    - Sample two check points at distance $offset = \frac{gridSize}{2}$: $P_1 = M + \vec{n} \cdot offset$ and $P_2 = M - \vec{n} \cdot offset$.
    - Determine if either $P_1$ or $P_2$ lies within a revealed fog cell (or explored cell). If neither point is in a revealed cell, reject the request with `{ refused: 'You cannot see that door', current: door }`.
    - If `map.lightingEnabled` is also `true`, the existing `sight?.seesPoint` check remains active.
- **Frontend (`frontend/src/components/campaign/map/doorAccess.ts` & `MapCanvas.tsx`)**:
  - Update `doorOffered()` and `offeredDoorAt()` to accept fog state.
  - If `fogEnabled` is active, compute the midpoint orthogonal offsets $P_1$ and $P_2$.
  - If neither point is revealed, return `null` / `false` so the door hover affordance is hidden and click events do not trigger a toggle request.

### R2: Player-View Preview Lifecycle and Exit Controls (`MapCanvas.tsx`)
- **Automatic Reset**:
  - Add a React `useEffect` monitoring `[currentMap?.lightingEnabled, fogEnabled, dmPreviewPlayerView]`.
  - When `!currentMap?.lightingEnabled && !fogEnabled && dmPreviewPlayerView`, call `setDmPreviewPlayerView(false)`.
- **Persistent Exit Control**:
  - Render the exit preview UI if `userRole === 'DM' && (((currentMap?.lightingEnabled ?? false) || fogEnabled) || dmPreviewPlayerView)`.
  - If `dmPreviewPlayerView` is `true`, the exit button MUST always be rendered so the DM can explicitly return to DM view.

### R3: Light Tool Deactivation During Player-View Preview (`MapCanvas.tsx`)
- In `handleMouseDown`, `handleMouseMove`, and `handleMouseUp` (or light-specific interaction blocks):
  - Update the check from `if (lightMode && isDM)` to `if (lightMode && isDM && !dmPreviewPlayerView)`.
  - Ensure no cursor hints for placing or dragging lights appear while previewing as a player.

### R4: Concurrent Wall Updates During DM Wall Drag (`MapCanvas.tsx`)
- In the socket listeners for `walls:update` and `walls:replace` (or within `useWallSelection`):
  - If `wallMoveRef.current` or `wallDragEndpointRef.current` is active:
    - Identify incoming segment changes for segments NOT in `selectedWallIds`.
    - Patch `preDragState` in the active drag ref with the updated segments.
    - For `walls:update` of a non-selected door segment, replace that segment in `preDragState` with the new version (preserving `type: 'door-open'` / `'door-closed'`).
    - For `walls:replace`, merge non-selected segments into `preDragState`.
  - Upon mouse up / commit, the merged list ensures external door toggles remain intact.

### R5: Door Hit Radius Scaling and Token Priority (`MapCanvas.tsx`)
- **World-Scaled Door Hit Radius**:
  - Replace the fixed `18px` screen threshold with a dynamically scaled threshold: `worldThreshold = Math.min(18 / mapControls.zoom, (currentMap.gridSize || 50) * 0.3)`.
- **Hit Detection Priority**:
  - In `handleMouseDown`, before testing for door midpoint hits, check if the clicked position hits a selectable/draggable token (`tokenAtPosition`).
  - If a token is hit, initiate token selection/drag and do not trigger door toggles.

### R6: Encapsulation & Referenced TODO Removal
- Encapsulate wall pointer and keyboard listeners within or alongside `useWallSelection`.
- Remove all 5 referenced comments matching `TODO(#156)`:
  - In `backend/src/websocket/handlers/walls.ts` (door fog check).
  - In `frontend/src/components/campaign/MapCanvas.tsx`:
    - Door click vs token pickup / wall pointer closures TODO.
    - Light tool active during preview TODO.
    - Wall drag preDragState concurrency TODO.
    - Preview button missing when lighting/fog turned off TODO.

---

## 3. Architecture & Data Flow

```
[Player Client]
      │ Click Door
      ▼
  doorAccess.ts / MapCanvas.tsx
  ├─ Check token priority (Token beats Door)
  ├─ Check world hit radius: min(18/zoom, gridSize * 0.3)
  ├─ Check local fog: midpoint ± normal * gridSize/2 in revealed cell
  │
  ▼ (Socket emit 'wall:update')
backend/src/websocket/handlers/walls.ts
  ├─ Check write authorization
  ├─ If fogEnabled: sample midpoint ± normal * gridSize/2 in fog grid
  │    └─ If both cells unrevealed -> Refuse: 'You cannot see that door'
  ├─ If lightingEnabled: sight.seesPoint(midpoint)
  │    └─ If not visible -> Refuse: 'You cannot see that door'
  ├─ Update door state (door-open <-> door-closed)
  └─ Broadcast 'walls:update' / 'walls:replaced'
```

```
[DM Client - Concurrency]
  DM starts dragging wall selection (preDragState captured)
      │
      ├─ Incoming 'walls:update' (player opened Door B)
      │    └─ Door B not in selectedWallIds -> update Door B in preDragState
      │
  DM drops wall selection
      └─ Commit preDragState + delta -> Door B remains open!
```

---

## 4. Test Strategy & Verification

1. **Backend Integration Tests (`backend/src/websocket/__tests__/walls.test.ts`)**:
   - Verify player toggle on door with manual fog enabled:
     - When both sides are covered by unrevealed fog -> fails with `'You cannot see that door'`.
     - When at least one side is revealed -> succeeds and broadcasts change.
   - Verify DM can toggle doors regardless of fog.
2. **Frontend Unit Tests (`frontend/src/components/campaign/map/__tests__/doorAccess.test.ts`)**:
   - Verify `offeredDoorAt` returns null when both sides of midpoint are in unrevealed fog.
   - Verify `offeredDoorAt` returns door when one side is revealed.
   - Verify hit radius decreases at low zoom and respects grid bounds.
3. **MapCanvas Component Tests (`frontend/src/components/campaign/__tests__/MapCanvas.test.tsx`)**:
   - Verify exiting `dmPreviewPlayerView` resets automatically when lighting and fog are toggled off.
   - Verify exit preview button remains visible while `dmPreviewPlayerView === true`.
   - Verify clicking during preview with `lightMode` active does not place or drag lights.
   - Verify concurrent door updates are merged into active wall drag.
   - Verify token click takes precedence over door toggle when clicking within overlapping hit boundaries.
