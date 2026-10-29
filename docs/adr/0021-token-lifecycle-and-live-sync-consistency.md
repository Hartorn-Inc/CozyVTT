# 0021. Token Lifecycle and Live Sync Consistency

Date: 2025-05-18

## Status

Accepted

## Context

Tokens on CozyVTT are manipulated through multiple interfaces: the Map Canvas interactive toolbar and context menus, the Token Manager panel, the NPC Quick Editor modal, the Token Template Library, and the REST API (`backend/src/routes/maps.ts` and `backend/src/routes/tokenTemplates.ts`).

Prior to this decision, several regressions and inconsistencies existed across these layers:
1. **REST Token Mutation desynchronization**: While moving tokens via `POST /:id/tokens/move` called `broadcastMapData` for the active map, the create (`POST /:id/tokens`), update (`PUT /:id/tokens/:tokenId`), and delete (`DELETE /:id/tokens/:tokenId`) REST endpoints only re-sent the combat initiative state (`resendInitiative`). Consequently, connected clients on the current map did not receive real-time token additions, field edits, or deletions unless a client performed a redundant socket emit, breaking live multi-client synchronization.
2. **SQL Wildcard Injection in Template Search**: Searching token templates via `GET /api/campaigns/:campaignId/token-templates?search=...` passed raw user input directly to Prisma's `{ contains: search, mode: 'insensitive' }`, treating SQL LIKE wildcards (`%`, `_`, `\`) as pattern operators instead of literal text.
3. **Map Canvas Spirit Layer UI Inversion**: The DM Spirit Layer toggle toolbar button displayed inverted title tooltip text when active: while spirit tokens were shown (`dmShowSpiritTokens = true`), the tooltip read `"Hiding spirit tokens (click to show)"` instead of indicating that tokens were currently visible and clicking would hide them.
4. **Silent Map Canvas Action Failures**: Right-click actions for hiding, obscuring, or toggling the spirit realm on tokens logged errors to the browser console without notifying the user via toast messages.
5. **Stale/Spectator Token Controllers**: When a member assigned as a token's `controlledBy` was demoted to spectator or removed from the campaign, `NpcQuickEditor` silently defaulted the `<select>` dropdown to the first available active player, while `TokenManager` displayed a misleading generic `"Player"` chip without a name.
6. **Object Plane Restrictions**: The Map Canvas right-click menu correctly prevented object tokens from crossing into the Spirit realm via `dmTokenControls(token.type).crossPlanes === false`, but `TokenManager` erroneously rendered the plane toggle button for `TokenType.OBJECT` tokens.
7. **Opaque Error Feedback in Token Workflows**: Token placement failures in `TokenManager` and template copy actions in `TokenTemplateLibrary` presented static generic strings instead of surfacing actual backend error details extracted via `apiErrorMessage(err)`.

## Decision

We decide to establish consistent end-to-end token synchronization, query hygiene, and user feedback rules across backend and frontend:

1. **Unified Current-Map REST Broadcasting**:
   - In `backend/src/routes/maps.ts`, invoke `await resendIfCurrent(campaignId, updatedMap)` immediately following `resendInitiative` in `POST /:id/tokens`, `PUT /:id/tokens/:tokenId`, and `DELETE /:id/tokens/:tokenId`.
   - In `DELETE /:id/tokens/:tokenId`, capture the updated map instance returned by `withMapsLocked` to supply it to `resendIfCurrent`.
   - If the modified map matches `campaign.currentMapId`, `broadcastMapData` projects role-based tokens, planes, dynamic lighting, and fog to all connected sockets. If the modified map is a prepared map, table players receive no broadcast, preserving DM draft isolation.

2. **Sanitized LIKE Queries for Token Templates**:
   - In `backend/src/routes/tokenTemplates.ts`, wrap query parameter `search` with `escapeLikePattern(search)` before supplying it to Prisma's `where.name = { contains: ..., mode: 'insensitive' }`.

3. **Map Canvas Tooltip & Feedback Alignment**:
   - When `dmShowSpiritTokens` is `true`, render the button title as `"Spirit tokens shown, click to hide"`; when `false`, render `"Hiding spirit tokens (click to show)"`.
   - Wrap all Map Canvas context menu asynchronous mutations (Hide, Obscure, Spirit Realm toggle) with user-facing toast alerts on catch: `showToast(apiErrorMessage(err) || '...', 'error')`.

4. **Controller Selection and Chip Integrity**:
   - In `NpcQuickEditor`, when `controlledBy` is defined but does not match any active player in `players`, render a selected, disabled `<option value={controlledBy} disabled>Former member / Spectator</option>` (or unassigned placeholder) so the browser select does not silently select the first active player.
   - In `TokenManager`, display the player controller chip only when an active player matching `controlledBy` exists in the campaign player list.

5. **Entity Type Boundary Enforcement**:
   - In `TokenManager`, guard the Spirit Realm plane toggle with `dmTokenControls(token.type).crossPlanes`. For `TokenType.OBJECT`, the plane toggle is never rendered, matching Map Canvas context menu rules.

6. **Standardized API Error and Success Messaging**:
   - In `TokenManager.tsx` token placement, extract and display `apiErrorMessage(err)` instead of hardcoded strings.
   - In `TokenTemplateLibrary.tsx`, display a success toast specifying the target campaign name upon successful copy, and extract `apiErrorMessage(err)` for failure toasts.
   - Clean up all 9 associated `// TODO(#153)` comments across the 6 affected source files.

## Consequences

- REST-based token mutations immediately synchronize the Map Canvas for all active session participants without manual reloads.
- Prepared maps remain fully isolated from players during REST edits.
- Search queries with special characters (`%`, `_`, `\`) behave predictably without accidental full-table wildcard matching.
- Former campaign members and spectators no longer corrupt token ownership UI or mislead DMs.
- Object tokens cannot be erroneously pushed to the Spirit layer from the manager table.
- All error paths display transparent, actionable API feedback to users.