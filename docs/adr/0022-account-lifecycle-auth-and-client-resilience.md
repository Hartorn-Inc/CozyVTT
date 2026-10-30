# 21. Account Lifecycle, Transitional Security Gating, and Client Resilience

Date: 2025-05-18

## Status

Accepted

## Context

During backlog curation and code audits across account management, authentication, administration, error handling, and dialog interaction components (Issue #157), eight distinct technical debts and architectural edge cases were cataloged under active `TODO(#157)` references:

1. **Detached Personal Assets on Account Deletion**: When an account is deleted via `accountDeletion.ts`, personal non-avatar assets referenced in active campaigns are preserved on disk and their database record is updated to `uploadedById = null`. However, the access control check `assetUsedInUserCampaign` in `permissions.ts` previously required that `asset.uploadedById` be a current member of the campaign. When `uploadedById` became `null`, all campaign members experienced `403 Forbidden` errors when loading maps or tokens referencing these retained files.
2. **Duplicated Security-Gated Path Definitions**: Middleware enforcing mandatory password changes (`passwordChange.ts`) and MFA enrollment (`adminMfa.ts`) maintained independent, hardcoded sets of permitted routes for users in transition. This duplication created drift risks where new endpoints (such as `/auth/appearance`) could be allowed in one gate but blocked in the other.
3. **Body-Parser HTTP 415 Fallthrough**: In `backend/src/middleware/errorHandler.ts`, body-parser errors with `rawStatus === 415` or error types `charset.unsupported` / `encoding.unsupported` were not classified as client errors and fell through to generic `500 Internal Server Error` responses.
4. **Destructive Email Sanitization during Registration**: In `backend/src/services/auth.ts`, `prepareRegistration` passed input emails through `sanitizeInput`, which silently stripped `<` and `>` characters (`jo<x>@example.com` became `jox@example.com`). During sign-in, the database lookup used the raw user input without stripping, permanently locking the user out. In contrast, administration routes (`routes/admin.ts`) reject `<` and `>` at validation time.
5. **Button Label Desynchronization in Error Messages**: Backend conflict error messages in `routes/admin.ts` (`POST /api/admin/users/:id/resend-invite`) and `routes/users.ts` (`POST /api/users/:id/reset-password`) referenced button labels that did not match the actual UI labels in the **Administrator** Panel and Profile Page.
6. **AutoFocus Stealing in Dialog Focus Trap**: The `useFocusTrap` hook unconditionally moved focus to the first focusable element inside a modal upon mount or activation, even when a form input inside the modal already held focus via the HTML `autoFocus` attribute.
7. **Silent Clipboard Failure on LAN HTTP Instances**: In `frontend/src/pages/AdminPage.tsx`, copying temporary passwords directly invoked `navigator.clipboard.writeText`. On local network HTTP deployments (which are not secure contexts per browser specifications), `navigator.clipboard` is undefined, causing silent failures without user feedback.
8. **Display Name Minimum Length Discrepancy**: The backend schema `displayNameSchema` permits display names between 1 and 50 characters, but client-side forms in `ProfilePage.tsx`, `SetupWizardPage.tsx` (**Setup**), and `RegisterPage.tsx` rejected names with `displayName.length < 2`.

## Decision

1. **Preserve Detached Campaign Assets with Permissive Campaign Read Access**:
   - When a user account is deleted in `accountDeletion.ts`, retain the existing behavior of setting `asset.uploadedById = null` for personal assets referenced by active campaigns.
   - Update the permission guard `assetUsedInUserCampaign` in `backend/src/services/permissions.ts` to grant read access to any active member of a campaign referencing an asset whose `uploadedById` is `null` (or where the asset is linked to that campaign).
2. **Extract Shared Base Security-Gated Routes and Enforce Static Parity**:
   - Define and export a single canonical array `BASE_SECURITY_GATED_PATHS` containing `/auth/change-password`, `/auth/logout`, `/auth/me`, `/auth/ping`, `/auth/appearance`, and `/config`.
   - In `backend/src/middleware/passwordChange.ts`, use `BASE_SECURITY_GATED_PATHS` directly.
   - In `backend/src/middleware/adminMfa.ts`, compose the allowed paths by extending `BASE_SECURITY_GATED_PATHS` with MFA-specific paths (`/auth/mfa/setup`, `/auth/mfa/verify`).
   - Enforce path synchronization and containment via assertions in `backend/src/__tests__/keepInStep.test.ts`.
3. **Handle HTTP 415 Errors Explicitly in Error Handler**:
   - In `backend/src/middleware/errorHandler.ts`, detect body-parser errors where `err.status === 415`, `rawStatus === 415`, `err.type === 'charset.unsupported'`, or `err.type === 'encoding.unsupported'`, and return a standard `415 Unsupported Media Type` response.
4. **Reject Angle Brackets during Registration Validation**:
   - In `backend/src/services/auth.ts`, validate email format to strictly disallow `<` and `>` characters, returning `400 Bad Request` if present, rather than modifying or stripping characters via `sanitizeInput`.
5. **Harmonize Error Message Button References with UI Labels**:
   - In `backend/src/routes/admin.ts`, align the conflict message to name the **Administrator** Panel button `"Send Reset Link"`.
   - In `backend/src/routes/users.ts`, align the self-reset error message to name the Profile page button `"Change Password"`.
6. **Respect Active Focus in Focus Trap**:
   - In `frontend/src/hooks/useFocusTrap.ts`, check `if (container.contains(document.activeElement)) return;` before moving focus to the container's first tabbable element.
7. **Use Resilient Clipboard Utility with Visual Feedback**:
   - In `frontend/src/pages/AdminPage.tsx`, replace direct `navigator.clipboard.writeText` calls with `copyText` from `utils/clipboard` and display toast feedback indicating success or error.
8. **Standardize Display Name Length Boundary across Client and Server**:
   - Update client validation in `ProfilePage.tsx`, `SetupWizardPage.tsx`, and `RegisterPage.tsx` to accept names between 1 and 50 characters, matching `displayNameSchema`.
9. **Eradicate In-Code Referenced TODOs**:
   - Remove all 11 `TODO(#157)` comments across the 10 affected source files.

## Consequences

### Positive

- Campaign assets uploaded by former users remain viewable and playable by campaign members after the uploader's account deletion.
- Security gating rules for transitional sessions are unified and protected from future drift by automated tests.
- Client-side and server-side validation rules (email characters, display name lengths) are fully aligned, preventing user lockouts and form rejections.
- Modal dialogues with `autoFocus` inputs open with focus ready for typing without focus theft.
- Administrator temporary password copying functions reliably across both HTTPS and LAN plain-HTTP deployments with immediate toast feedback.
- HTTP 415 errors produce actionable client error responses rather than misleading internal server errors.
- Technical debt is eliminated by clearing all 11 tracked TODO comments.

### Negative

- Detached assets cannot be edited or reassigned by campaign members without introducing an explicit campaign ownership model in future iterations; they remain read-only campaign resources.

### Neutral

- Test suites across backend and frontend are expanded to cover 415 media type errors, detached asset permissions, focus trap retention, and clipboard fallbacks.
