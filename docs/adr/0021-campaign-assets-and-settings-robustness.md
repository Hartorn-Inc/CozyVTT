# Campaign Assets Authority, Sandboxed Delivery, and Query Robustness

**Context**:
Defects across campaign settings, asset management, creature queries, and document reading revealed structural ambiguities in authority delegation, input parsing, and browser isolation. Specifically:
1. When DM duties are handed over to another campaign member, the original creator remains `campaign.owner`, but operational permissions (`canChange` on campaign assets, display of DM on invitations) were incorrectly conflating campaign ownership with the sitting DM role, while the Danger Zone (campaign destruction) must remain strictly restricted to the campaign owner or an Administrator.
2. Express URL query parsing decodes duplicated scalar parameters (`?search=a&search=b`) as arrays. When passed directly to Prisma `where` filters without validation, this triggers unhandled database client rejections (HTTP 500). Furthermore, raw search strings containing SQL/LIKE wildcard characters (`%`, `_`) were passed unescaped to Prisma's insensitive contains filter.
3. Serving user-provided document assets requires origin isolation (`sandbox` CSP). However, HTTP 304 Not Modified responses bypassed CSP header assignment, leaving browsers with stale or ambient origin permissions. Additionally, Chromium and Safari reject or display blank frames when rendering PDF documents inside dual-sandbox contexts (combining iframe `sandbox="allow-scripts"` without `allow-same-origin` and server-level CSP sandboxing).
4. Multer processes multipart filename UTF-8 bytes as Latin-1, corrupting non-ASCII asset filenames upon persistence.

**Decision**:
1. **Authority Separation**:
   - The sitting DM (`CampaignMembership` with role `DM`) is established as the sole operational authority for campaign-scoped assets: `asset.canChange` is granted to the sitting DM, the original uploader, or an Administrator. Invitations returned by `GET /api/invitations` expose the sitting DM's display name as the campaign's contact.
   - Irreversible lifecycle operations in `CampaignSettingsModal` (specifically the Danger Zone / campaign deletion) remain strictly guarded by campaign ownership (`userId === campaign.ownerId`) or instance Administrator status (`platformRole === 'ADMIN'`).
2. **Defensive Query Parameter Parsing**:
   - Introduce a shared query validator `readScalarQuery` that rejects repeated query parameters with HTTP 400 Bad Request, preventing unhandled array payloads reaching database queries.
   - Mandate `escapeLikePattern` on all text search queries across `assets.ts` and `creatures.ts` before constructing Prisma `contains` clauses.
3. **Document Delivery and Sandbox Isolation**:
   - In `GET /api/assets/documents/:id`, sandbox CSP headers (`default-src 'none'; sandbox`) and `X-Content-Type-Options: nosniff` must be set unconditionally prior to evaluating `if-none-match` conditional cache checks (HTTP 304).
   - `DocumentReader` isolates Markdown and text documents in an iframe, while offering direct, sandboxed window viewing or dedicated presentation for PDF assets that avoids browser-level PDF plugin suppression under strict subframe restrictions.
4. **Upload Normalization & Robust Error Handling**:
   - `ASSET_UPLOAD_RATE_LIMIT` is parsed using `positiveIntegerFromEnv` with a secure default.
   - Multer filenames are decoded from `latin1` bytes to UTF-8 prior to length shortening and disk persistence.
   - Malformed multipart payload errors from Multer or busboy are intercepted and returned as clean HTTP 400 Bad Request responses with descriptive errors.
5. **State Synchronization and UI Fluidity**:
   - Dashboard invitations refetch automatically upon window focus and visibility change, preserving ADR 0011 state ownership without unnecessary WebSocket complexity.
   - Creature deletion atomically cleans up both `creatures` and favorite states (`favoriteCreatures`, `favoriteIds`).
   - CSS transitions on `AssetCard` omit `opacity` to prevent dual-fade animation artifacts in Firefox.

**Consequences**:
- Campaign DMs can manage campaign assets immediately upon seat handover without requiring full platform administration or campaign ownership transfer.
- Accidental or malicious query parameter pollution and wildcard search patterns cannot trigger database 500 errors.
- Non-ASCII filenames are rendered and downloaded accurately across all locales.
- Browsers maintain uncompromised origin isolation on all document reads, including cached revalidations.
- All 21 referenced `TODO(#154)` markers are definitively resolved and removed.

**Status**: accepted
