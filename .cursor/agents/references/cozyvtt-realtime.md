# CozyVTT real-time and parity reference

Read `backend/docs/WEBSOCKET_DOCUMENTATION.md` and the WebSocket sections of
`docs/ARCHITECTURE.md`.

## Socket rules

The session cookie authenticates the Socket.io connection. A socket must
authenticate to a campaign before game events. `socket.role`, `socket.userId`,
and `socket.campaignId` are server-established state: never trust campaign,
role, ownership, or permission values from an event payload. Every state
mutation rechecks membership/role and validates its payload. Use the existing
rate ceilings, throttling, map locks, and broadcast helpers.

Players and spectators receive recipient-specific filtered data. The current
map restriction, spirit-plane rules, hidden-token masking, dynamic-lighting
visibility, DM-only walls/lights details, and Keeper's Notes filtering apply
to REST and WebSocket paths alike. A map JSON write uses the existing
`withMapsLocked`/map-lock pattern so concurrent token, wall, light, and fog
edits are not lost.

## Shared facts

Keep these files byte-identical when both packages contain them:
`visibilityRule.ts`, `raycasting.ts`, `spatialIndex.ts`, `tokenMask.ts`,
`tokenCentre.ts`, `styleAllowlists.ts`, and `vibeAudio.ts` where applicable.
`backend/src/__tests__/keepInStep.test.ts`,
`backend/src/utils/__tests__/visionParity.test.ts`, and the frontend parity
tests enforce this. Keep `backend/docs/WEBSOCKET_DOCUMENTATION.md`'s generated
event inventory in sync with handlers.

Client live state belongs in the Zustand game store and socket service; do not
put high-frequency token movement into `CampaignContext` or React Query.
