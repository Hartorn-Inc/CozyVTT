# Specification: Campaign Settings, Assets, Upload & Creature Library Fixes

## 1. Overview & Architectural Goals

This specification provides the technical design, API contracts, domain validation rules, and frontend integration requirements to resolve the consolidated backlog of 23 defects (and 21 active `TODO(#154)` markers) spanning:
- Asset uploads, environment rate-limit parsing, multipart encoding, and error handling.
- Parameter sanitization, scalar uniqueness enforcement, and LIKE pattern escaping in backend endpoints (`/api/assets`, `/api/creatures`).
- Sitting DM authority vs. Campaign Owner authority after DM handover in invitations, asset manipulation, and campaign deletion.
- Document reader sandbox security, CSP headers on HTTP 304 responses, and cross-browser PDF presentation.
- Creature library favorite state synchronization, stat block size limit reporting, and nested button cleanup.
- Map manager export error handling and campaign export pre-flight checks.
- UI polish: Firefox animation fix in `AssetCard`, error message extraction in `AssetDetailPanel`, audio MIME type alignment in `AssetUploadModal`, campaign settings length limits, and live dashboard invitation refresh on window focus.

---

## 2. Backend Requirements & Architecture

### 2.1 Asset Upload Rate Limit Env Parsing (`backend/src/routes/assets.ts`)
- **Problem**: `parseInt(process.env.ASSET_UPLOAD_RATE_LIMIT || '30')` produces `NaN` if an invalid non-numeric string is configured in the environment, effectively disabling rate limiting.
- **Requirement**: Use `positiveIntegerFromEnv(process.env.ASSET_UPLOAD_RATE_LIMIT, 30)` to read the rate limit, matching the pattern established in `backend/src/app.ts`.

### 2.2 Scalar Query Parameter Validation & LIKE Sanitization (`backend/src/utils/queryParams.ts`, `backend/src/routes/assets.ts`, `backend/src/routes/creatures.ts`)
- **Problem**: In `GET /api/assets` and `GET /api/creatures`, query parameters like `search`, `source`, `cr`, `campaignId`, `uploadedBy`, `usable`, `page`, `limit` can be duplicated in the URL query string (`?search=a&search=b`). Express parses these into arrays `['a', 'b']`. Casting them as `(search as string)` causes Prisma to throw a type/runtime error, returning HTTP 500.
- **Requirement**:
  1. Create or extend a utility `readScalarQuery(value: unknown, paramName: string): { ok: true; value: string | undefined } | { ok: false; message: string }` in `backend/src/utils/queryParams.ts`.
  2. If `Array.isArray(value)` is true, return `{ ok: false, message: `Parameter "${paramName}" cannot be specified multiple times.` }`.
  3. Return HTTP 400 Bad Request with `{ error: 'Validation Error', message: result.message }` when repeated scalar query parameters are detected.
  4. Apply `escapeLikePattern(search)` (from `backend/src/utils/likePattern.ts`) to all text search parameters before passing them to Prisma `where.name = { contains: escapedSearch, mode: 'insensitive' }`.

### 2.3 Multer Non-ASCII Filename UTF-8 Decoding (`backend/src/routes/assets.ts`)
- **Problem**: Multer decodes multipart header filename bytes using the ISO-8859-1 (Latin-1) character set by default, causing UTF-8 characters (accents, non-Latin scripts, emoji) to be corrupted in stored records and UI lists.
- **Requirement**:
  1. Before storing `file.originalname`, decode the raw Latin-1 string as UTF-8 bytes: `Buffer.from(file.originalname, 'latin1').toString('utf8')`.
  2. Pass the decoded string to `shortenFileName(decodedName, MAX_ORIGINAL_NAME_LENGTH)` before persisting in the `Asset` database record.

### 2.4 Document Reader `304 Not Modified` Missing Sandbox CSP (`backend/src/routes/assets.ts`)
- **Problem**: In `GET /api/assets/documents/:id`, when handling revalidation (`if-none-match === etag`) for non-PDF documents (Markdown, text), `res.status(304).end()` is executed before setting `Content-Security-Policy` and security headers. A browser caching this 304 response can retain broader instance-level origin privileges.
- **Requirement**:
  1. Set the defensive sandbox security headers unconditionally before checking `req.headers['if-none-match'] === etag`:
     - `'Content-Security-Policy': "default-src 'none'; sandbox"`
     - `'X-Content-Type-Options': 'nosniff'`
     - `'Cache-Control': 'private, no-cache'`
     - `'ETag': etag`
  2. Only then return `res.status(304).end()`.

### 2.5 Malformed Multipart Upload Error Handling (`backend/src/middleware/upload.ts`, `backend/src/routes/assets.ts`)
- **Problem**: Malformed multipart bodies (e.g. truncated boundaries, invalid encoding) fall through to the global uncaught exception handler, resulting in HTTP 500 with `"An unexpected error occurred"` instead of a 400 Bad Request.
- **Requirement**:
  1. Update upload middleware error handling (`handleUploadErrors` or multer error middleware) to catch `MulterError` and busboy parsing errors.
  2. Return HTTP 400 Bad Request with `{ error: 'Validation Error', message: 'Malformed multipart form data request.' }`.

### 2.6 Invitation DM Attribution After DM Handover (`backend/src/routes/invitations.ts`)
- **Problem**: `GET /api/invitations` joins `campaign.owner` to populate campaign context. After a DM handover, the campaign owner is no longer the active DM, but the UI labels this user as `"DM:"`.
- **Requirement**:
  1. In `GET /api/invitations`, include the active DM member from `campaign.members` where `role === 'DM'`:
     ```ts
     members: {
       where: { role: 'DM' },
       select: {
         user: {
           select: { id: true, displayName: true, username: true },
         },
       },
       take: 1,
     }
     ```
  2. Provide a computed or structured `sittingDm: { id, displayName } | null` property (falling back to `owner` if no DM member record exists).

### 2.7 Asset Permission Calculation (`backend/src/routes/assets.ts`)
- **Problem**: Server calculation of `canChange` for campaign assets must reflect the sitting DM's authority.
- **Requirement**: For assets where `scope === 'CAMPAIGN'` and `campaignId` is present, `canChange` must be true if the requesting user has the `DM` role in that campaign (`CampaignMembership.role === 'DM'`), or is the asset uploader, or is an Administrator.

---

## 3. Frontend Requirements & Architecture

### 3.1 AssetCard & AssetDetailPanel DM Permissions (`frontend/src/components/assets/`)
- **Files**: `AssetCard.tsx`, `AssetDetailPanel.tsx`
- **Requirement**:
  1. In `AssetCard.tsx`, replace the check `const canDelete = isOwner || isAdmin` with `const canDelete = asset.canChange ?? (isOwner || isAdmin || isCampaignDm)`.
  2. In `AssetDetailPanel.tsx`, ensure the Delete button and Move Scope action are shown when `asset.canChange` is true (or when the user is the sitting DM of the asset's campaign).
  3. When an asset move request fails, display the detailed backend reason via `apiErrorMessage(err)` rather than `apiErrorText(err)`.

### 3.2 AssetCard Firefox Double Fade-In (`frontend/src/components/assets/AssetCard.tsx`)
- **Problem**: Applying `transition-all` alongside Framer Motion entrance animations causes Firefox to animate `opacity` from 0 twice (once in Motion, once in CSS).
- **Requirement**: Replace `transition-all` with targeted transitions: `transition-[box-shadow,background-color,border-color]` or `transition-shadow transition-colors` so `opacity` is never transitioned via CSS.

### 3.3 Audio MIME Types in AssetUploadModal (`frontend/src/components/assets/AssetUploadModal.tsx`)
- **Problem**: Client validation accepts `audio/mp4` (which the backend rejects) and rejects Firefox-provided `application/ogg` and `audio/x-wav`.
- **Requirement**:
  1. Align `ALLOWED_AUDIO_TYPES` with backend `ALLOWED_MIME_TYPES`:
     - Allow: `audio/mpeg`, `audio/ogg`, `application/ogg`, `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/flac`.
     - Disallow: `audio/mp4`.
  2. Fall back to file extension matching (`.mp3`, `.ogg`, `.wav`, `.webm`, `.flac`) when browser-reported MIME type is empty or generic.

### 3.4 CampaignSettingsModal Form & Permissions Fixes (`frontend/src/components/campaign/CampaignSettingsModal.tsx`)
- **Requirement**:
  1. **Description Clearing**: When the description input is empty string `''`, send `{ description: null }` (or empty string aligned with backend DTO) instead of omitting the field or sending `undefined`.
  2. **Danger Zone Access**: The Danger Zone tab containing "Delete Campaign" must be rendered ONLY if the user is the campaign owner (`user.id === campaign.ownerId`) or an instance Administrator (`user.platformRole === 'ADMIN'`). A sitting DM who is not the owner must not see this tab.
  3. **Field Length Constraints**: Increase character limits to match backend validations: Name up to 200 characters, Description up to 5000 characters.

### 3.5 CreatureLibrary Favorite Cleanup & Button Nesting (`frontend/src/components/campaign/CreatureLibrary.tsx`)
- **Requirement**:
  1. **Favorite State Sync**: When a creature template is deleted, remove its ID from both `creatures` state and `favoriteCreatures` / `favoriteIds` state immediately so no ghost row or stale favorite remains.
  2. **Nested Button Fix**: Inspect creature template list items to ensure action buttons (favorite toggle, edit, delete) are not nested inside a parent `<button>` element. Use standard `<div>` containers with accessible click handlers or semantic sibling buttons.
  3. **Stat Block Size Error**: When saving a creature template fails due to stat block payload exceeding 64 KB, display the server's rejection message (`apiErrorMessage(err)`).

### 3.6 MapManager Export Error Handling (`frontend/src/components/campaign/MapManager.tsx`)
- **Problem**: Downloading a map export via direct `<a download href="...">` fails silently or opens a blank window on HTTP 422 / 500.
- **Requirement**:
  1. Trigger export through an authenticated `fetch` or axios request with response type `blob`.
  2. On HTTP 200, generate an object URL (`URL.createObjectURL(blob)`), trigger programmatic download, and revoke the URL.
  3. On HTTP 422 or error, parse the response body and display `apiErrorMessage(err)` via toast or modal alert.

### 3.7 DocumentReader Sandboxed PDF Delivery (`frontend/src/components/documents/DocumentReader.tsx`)
- **Problem**: Chromium disables its internal PDF viewer inside `<iframe sandbox="allow-scripts">` without `allow-same-origin`, and Safari fails with combined iframe and CSP sandboxing.
- **Requirement**:
  1. Render Markdown and plain text documents safely inside the sandboxed iframe.
  2. For PDF documents (`asset.mimeType === 'application/pdf'` or `.pdf` extension), provide a seamless reader view with an explicit "Open PDF in Isolated Window" / "Download PDF" action that opens the asset URL with `rel="noopener noreferrer"`, or render via an embedded `<object>` / dedicated viewer that respects origin isolation without crashing Safari or Chromium.

### 3.8 AssetLibraryPage Server-Side Search & Exit Animations (`frontend/src/pages/AssetLibraryPage.tsx`)
- **Requirement**:
  1. Wire the search bar input directly into the API query parameters (`search=${encodeURIComponent(debouncedSearch)}`), querying across all pages on the backend rather than filtering only the current page client-side.
  2. Wrap `AssetDetailPanel` rendering inside Framer Motion's `<AnimatePresence>` so dismissal animations complete smoothly.

### 3.9 DashboardPage Live Invitation Refresh (`frontend/src/pages/DashboardPage.tsx`, `InvitationModal.tsx`)
- **Requirement**:
  1. In `DashboardPage.tsx`, add event listeners for `window.focus` and `document.visibilitychange` to refetch pending campaign invitations.
  2. In `InvitationModal.tsx` and the Dashboard invitation list, display the sitting DM's display name (`invitation.campaign.sittingDm?.displayName ?? invitation.campaign.owner?.displayName`) with the label `"DM:"`.

### 3.10 Referenced TODO Removal
- Remove all 21 `// TODO(#154)` comments from the 13 affected files upon implementation.

---

## 4. Test Strategy & Acceptance Criteria

### 4.1 Backend E2E Tests
- `backend/src/routes/__tests__/assets.e2e.test.ts`:
  - Assert `GET /api/assets?search=foo&search=bar` returns 400 Bad Request.
  - Assert `GET /api/assets?search=%25` escapes `%` and matches only literal `%`.
  - Assert uploaded non-ASCII filename (e.g. `dungeon_épée_héroïque.png`) preserves UTF-8 characters.
  - Assert `GET /api/assets/documents/:id` with matching `if-none-match` returns 304 with CSP sandbox headers present.
  - Assert `ASSET_UPLOAD_RATE_LIMIT=invalid_string` falls back to default 30 without throwing NaN.
  - Assert sitting DM of a campaign can delete and move campaign assets.
- `backend/src/routes/__tests__/creatures.e2e.test.ts`:
  - Assert `GET /api/creatures?search=a&search=b` returns 400 Bad Request.
  - Assert `GET /api/creatures?source=a&source=b` returns 400 Bad Request.
  - Assert search string with `_` and `%` is properly escaped.
- `backend/src/routes/__tests__/invitations.e2e.test.ts`:
  - Assert invitations reflect sitting DM after handover.
- `backend/src/routes/__tests__/malformedUpload.e2e.test.ts`:
  - Assert malformed multipart payload returns 400 Bad Request.

### 4.2 Frontend Unit/Integration Tests
- `frontend/src/components/assets/__tests__/AssetCard.test.tsx`: Verify permissions and CSS transition classes.
- `frontend/src/components/campaign/__tests__/CampaignSettingsModal.test.tsx`: Verify Danger Zone hidden for non-owner DM, description clearing sends `null`.
- `frontend/src/components/campaign/__tests__/CreatureLibrary.test.tsx`: Verify deletion removes item from favorites.
- `frontend/src/components/documents/__tests__/DocumentReader.test.tsx`: Verify PDF presentation and sandbox isolation.
