# 21. Instance Backup/Restore Stream Safety, CSP Hardening, Test Isolation, and Graceful Shutdown

Date: 2025-05-18

## Status

Accepted

## Context

Seven operational, security, and developer-experience defects were identified in `docs/FUTURE_FEATURES.md` (*Known Issues > Server and deployment*) and across active codebase `// TODO(#158)` markers:

1. **Unclosed archive file descriptors during safe extraction (`backend/src/utils/archive.ts`)**:
   `extractArchiveSafely` previously operated on an `unzipper.CentralDirectory` object without explicit archive path binding. When safe extraction failed (path traversal, zip bomb entry count, or decompression quota exceeded), entry streams could be aborted without closing the underlying archive file descriptor, leaking open handles until process termination.
2. **Inclusion of empty `uploads/backups` directory in Instance backup archives (`backend/src/routes/admin.ts`)**:
   When creating an **Instance backup**, `writeBackupZip` excluded nested backup files using `entry.name.startsWith('backups/')`, but did not match the directory entry `entry.name === 'backups'`. As a result, an empty `uploads/backups/` directory was packed into every archive.
3. **Missing Administrator audit log on post-restore migration failures (`backend/src/routes/admin.ts`)**:
   In `POST /api/admin/backups/restore`, if `prisma migrate deploy` failed after replacing the database, the handler executed an early return `res.status(500)` without logging an **Administrator** audit entry, obscuring who initiated the failed restore.
4. **Winston logger `"write after end"` during graceful shutdown (`backend/src/utils/shutdown.ts`)**:
   During shutdown, `exitAfterLogs` invokes `logger.end()`. If a second signal (`SIGTERM`/`SIGINT`) arrived or the shutdown deadline expired after `logger.end()`, subsequent calls to `logger.warn` or `logger.error` threw unhandled `"write after end"` errors.
5. **CSP `connect-src` over-permissive wildcard schemes (`backend/src/app.ts`, `frontend/security-headers.conf`)**:
   `connectSrc` contained bare `ws:` and `wss:` schemes. Under CSP Level 3, the `'self'` source expression already matches same-origin WebSocket connections (`ws://` and `wss://`). Bare scheme wildcards allowed malicious scripts to establish live WebSocket connections to arbitrary third-party hosts.
6. **Test suite disk pollution of production upload directory (`backend/src/__tests__/helpers/jest.setup.ts`)**:
   Integration tests that did not explicitly mock `process.env.UPLOAD_DIR` wrote directly into the real `backend/uploads` directory, accumulating hundreds of leftover files during CI and local test runs.
7. **Nginx 10-second hang on `docker compose stop` with persistent WebSockets (`docker-compose.yml`, `nginx.conf`)**:
   When terminating containers via `docker compose stop`, long-lived WebSocket connections prevented Nginx worker processes from exiting gracefully on `SIGQUIT`, stalling until Docker sent `SIGKILL` at the 10-second deadline.

## Decision

We adopt the following consolidated architectural and operational fixes:

1. **Archive Stream Lifecyle & Resource Release**:
   Update `extractArchiveSafely` in `backend/src/utils/archive.ts` to accept `archivePath: string`. Refactor extraction to iterate through entries using the existing `unpackEntry` helper pattern with a shared `UnpackedTotal` counter. Ensure that upon any rejection (zip slip, quota exceed, or stream error), active entry streams are destroyed, temporary extraction artifacts are unlinked, and the underlying file descriptor is immediately released.
2. **Instance Backup Filter Refinement**:
   In `backend/src/routes/admin.ts:writeBackupZip`, update the directory walker filter to exclude both `entry.name === 'backups'` and `entry.name.startsWith('backups/')`, ensuring no backup directories or artifact files are recursively archived.
3. **Resilient Audit Trail on Post-Restore Migration Failure**:
   In `backend/src/routes/admin.ts`, wrap the post-restore audit log creation in a best-effort `try / catch` block prior to returning `res.status(500)`. If database state prevents writing the audit row via Prisma, immediately fallback to `logger.error` capturing the authenticated administrator ID, timestamp, and failure cause.
4. **Winston Closed-State Tracking & Native Console Fallback**:
   Introduce an internal `isLoggerClosed` flag in `backend/src/utils/shutdown.ts`. Once `logger.end()` is invoked by `exitAfterLogs`, route all subsequent termination, deadline, and signal logs directly to native `console.warn` / `console.error` to eliminate `"write after end"` runtime exceptions.
5. **CSP Level 3 WebSocket Hardening**:
   Remove `ws:` and `wss:` from `connectSrc` in `backend/src/app.ts` (Helmet middleware) and `frontend/security-headers.conf` (Nginx static configuration). Rely exclusively on `'self'` for same-origin WebSocket upgrades. Update automated CSP parity tests to enforce consistency.
6. **Jest Per-Worker Temporary Upload Isolation**:
   In `backend/src/__tests__/helpers/jest.setup.ts`, initialize `process.env.UPLOAD_DIR` to a dedicated temporary folder per worker (`fs.mkdtempSync(path.join(os.tmpdir(), ...process.env.JEST_WORKER_ID...))`). Register a global `afterAll` hook to recursively remove the temporary directory upon test completion.
7. **Nginx Worker Shutdown Timeout & Compose Signals**:
   Configure `worker_shutdown_timeout 5s;` in the Nginx HTTP configuration. Ensure `docker-compose.yml` specifies a compatible grace period (`stop_grace_period: 15s`) and appropriate stop signals so Nginx terminates persistent WebSockets cleanly and container teardown finishes in under 6 seconds.
8. **Debt Elimination**:
   Remove the 6 referenced `TODO(#158)` markers in the affected files and clean up the resolved entries in `docs/FUTURE_FEATURES.md`.

## Consequences

### Positive

- File descriptor leaks and partial extraction locks during backup restoration or invalid archive uploads are eliminated.
- Instance backup archives are strictly minimal and do not nest backup metadata or directories.
- Administrator actions during database restore are consistently audited and traceable even when Prisma migrations fail.
- Graceful process termination is resilient against repeated signals without throwing unhandled Node.js stream errors.
- WebSocket endpoints adhere to strict Content Security Policy Level 3 origin boundaries, preventing exfiltration to third-party WebSocket endpoints.
- The backend test suite leaves the repository worktree clean without polluting `backend/uploads`.
- Containerized deployments stop reliably without hitting Docker 10-second `SIGKILL` timeouts.

### Negative & Trade-offs

- Safe archive extraction signature changes require updating callers (`admin.ts` and test harnesses).
- In edge cases where third-party WebSocket origins were previously assumed (not supported by CozyVTT architecture), CSP will strictly block them.
