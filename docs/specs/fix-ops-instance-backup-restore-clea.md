# Specification: Instance Backup/Restore Cleanup, CSP WebSocket Hardening, Test Upload Isolation & Graceful Shutdown

- **Slug**: `fix-ops-instance-backup-restore-clea`
- **Issue Reference**: #158
- **ADR Reference**: `docs/adr/0021-instance-backup-restore-and-ops-runtime-hardening.md`
- **Status**: Draft

---

## 1. Overview & Problem Statement

This specification defines the remediation for 7 operational, deployment, and test isolation defects identified in `docs/FUTURE_FEATURES.md` (*Known Issues > Server and deployment*) and indexed via 6 `// TODO(#158)` comments in the CozyVTT codebase:

1. **Unclosed archive file descriptor on refused extraction (`backend/src/utils/archive.ts`)**: Stopping an extraction stream prematurely on validation failure leaves underlying archive handles open until process exit.
2. **Empty `uploads/backups/` directory included in Instance backups (`backend/src/routes/admin.ts`)**: The backup file filter fails to exclude the directory node `backups` itself.
3. **Missing Administrator audit log on post-restore migration failure (`backend/src/routes/admin.ts`)**: When `prisma migrate deploy` fails after database restoration, the handler returns `500` without recording an **Administrator audit log**.
4. **Winston logger `"write after end"` on repeated shutdown signals (`backend/src/utils/shutdown.ts`)**: Logging after `exitAfterLogs` closes the Winston stream causes unhandled stream write exceptions.
5. **Permissive CSP `connect-src` containing bare `ws:` and `wss:` (`backend/src/app.ts`, `frontend/security-headers.conf`)**: Over-permissive CSP schemes allow WebSocket connections to arbitrary remote hosts.
6. **Backend test suite polluting real `backend/uploads` (`backend/src/__tests__/helpers/jest.setup.ts`)**: Unisolated tests generate untracked asset files on disk.
7. **Nginx 10-second hang on `docker compose stop` (`docker-compose.yml`, `nginx.conf`)**: Persistent WebSockets prevent Nginx workers from terminating cleanly upon `SIGQUIT`.

---

## 2. Technical Design & Implementation Details

### 2.1 Archive Stream Lifecycle & Resource Release (`backend/src/utils/archive.ts`)

#### Current Defect
`extractArchiveSafely(directory: CentralDirectory, destRoot: string, options: SafeExtractOptions)` extracts zip entries via `unzipper` streams. If an entry violates quota limits (total uncompressed bytes > `maxTotalSize`, entry count > `maxEntries`) or path constraints (directory traversal / zip-slip), the function aborts. However, because the underlying archive file descriptor is held by the unzipper parser stream without an explicit abort-destroy hook, the file handle remains locked on disk until the Node.js process exits.

#### Target Architecture
1. **Signature Update**: Update `extractArchiveSafely` to accept the filesystem path to the archive:
   ```typescript
   export async function extractArchiveSafely(
     archivePath: string,
     directory: unzipper.CentralDirectory,
     destRoot: string,
     options: SafeExtractOptions
   ): Promise<void>;
   ```
2. **Per-Entry Delegation via `unpackEntry` Pattern**:
   - Use a shared `UnpackedTotal` object tracking cumulative byte counts and file counts.
   - For each entry in `directory.files`:
     - Validate destination path against `destRoot` (enforcing path containment with `path.relative`).
     - Verify entry count does not exceed `options.maxEntries`.
     - Delegate decompression to `unpackEntry(archivePath, entry, targetPath, options, total)`.
   - If decompression or path validation fails:
     - Destroy open readable/writable streams.
     - Recursively clean up partially unpacked directories in `destRoot`.
     - Propagate a typed error (`ArchiveExtractionError`).
3. **Call Site Synchronization**:
   - In `backend/src/routes/admin.ts` (`POST /api/admin/backups/restore`), pass `req.file.path` as the first parameter to `extractArchiveSafely`.
   - Update unit tests in `backend/src/__tests__/unit/archive.test.ts` to supply temporary archive file paths.

---

### 2.2 Instance Backup Directory Exclusion (`backend/src/routes/admin.ts`)

#### Current Defect
In `writeBackupZip`, the exclusion filter for upload assets is:
```typescript
if (entry.name.startsWith('backups/')) {
  return false;
}
```
When the directory `backend/uploads/backups` exists on disk, `archiver` emits an entry for the directory itself with `entry.name === 'backups'`. The `startsWith('backups/')` check returns `false`, causing an empty directory entry `backups/` to be packed into the root of the **Instance backup** archive.

#### Target Architecture
Update the filter predicate in `writeBackupZip`:
```typescript
if (entry.name === 'backups' || entry.name.startsWith('backups/')) {
  return false;
}
```
Verify that:
- Existing backup archives in `uploads/backups/*` are ignored.
- The directory entry `backups` itself is excluded.
- User uploads (e.g., `uploads/avatars/`, `uploads/maps/`, `uploads/tokens/`) remain preserved.

---

### 2.3 Resilient Administrator Audit Logging on Post-Restore Migration Failure (`backend/src/routes/admin.ts`)

#### Current Defect
In `POST /api/admin/backups/restore`:
```typescript
try {
  await runPrismaMigrateDeploy();
} catch (err) {
  // TODO(#158): audit log missing
  return res.status(500).json({ error: 'Migration failed' });
}
```
When a restored database dump is missing required schema migrations or contains conflicting revisions, `prisma migrate deploy` fails. The handler immediately aborts with HTTP 500, skipping audit log persistence.

#### Target Architecture
1. Before returning HTTP 500 on migration failure, record an **Administrator audit log** entry indicating the failed restoration attempt.
2. Wrap the audit write in a best-effort block to prevent unhandled database errors if the schema state prevents writing to the audit table:
   ```typescript
   try {
     await runPrismaMigrateDeploy();
   } catch (err) {
     logger.error('Post-restore prisma migrate deploy failed', { error: err, userId: req.user?.id });
     
     try {
       await writeAdminLog({
         action: 'INSTANCE_RESTORE_MIGRATION_FAILED',
         userId: req.user.id,
         ipAddress: req.ip,
         details: {
           error: err instanceof Error ? err.message : String(err),
           backupFile: req.file?.filename,
         },
       });
     } catch (auditErr) {
       logger.error('Failed to write best-effort admin audit log for restore failure', {
         auditError: auditErr,
         originalError: err,
         userId: req.user?.id,
       });
     }

     return res.status(500).json({
       error: 'Database restored but pending migrations failed to apply. Check server logs.',
     });
   }
   ```
3. Clean up temporary uncompressed files in `finally` or error handling blocks.

---

### 2.4 Winston Logger Drain & Post-Close Logging Safeguards (`backend/src/utils/shutdown.ts`)

#### Current Defect
During graceful shutdown, `exitAfterLogs` calls `logger.end()`. If:
- A second OS signal (`SIGTERM` or `SIGINT`) arrives before process exit, or
- The shutdown timer hits the forced exit deadline,
the handlers invoke `logger.warn` or `logger.error`. Because the Winston stream is closed, Node.js throws an unhandled stream error: `Error [ERR_STREAM_WRITE_AFTER_END]: write after end`.

#### Target Architecture
1. Maintain a file-scoped flag in `backend/src/utils/shutdown.ts`:
   ```typescript
   let isLoggerClosed = false;
   ```
2. In `exitAfterLogs()`, mark `isLoggerClosed = true` immediately before or inside `logger.end()` callback.
3. Encapsulate shutdown logging in resilient wrappers:
   ```typescript
   function logShutdownWarn(message: string, meta?: unknown): void {
     if (isLoggerClosed) {
       console.warn(`[SHUTDOWN] ${message}`, meta !== undefined ? meta : '');
     } else {
       logger.warn(message, meta);
     }
   }

   function logShutdownError(message: string, meta?: unknown): void {
     if (isLoggerClosed) {
       console.error(`[SHUTDOWN] ${message}`, meta !== undefined ? meta : '');
     } else {
       logger.error(message, meta);
     }
   }
   ```
4. Replace raw `logger.warn` and `logger.error` in signal listeners, timeout callbacks, and exit routines with `logShutdownWarn` and `logShutdownError`.

---

### 2.5 Content Security Policy WebSocket Origin Hardening (`backend/src/app.ts` & `frontend/security-headers.conf`)

#### Current Defect
Both Express Helmet middleware and Nginx static security headers specify:
`connect-src 'self' ws: wss: ...`
Under W3C CSP Level 3, the keyword `'self'` covers same-origin HTTP, HTTPS, and WebSocket connections (`ws://` and `wss://` matching the origin's host and port). Including the bare scheme identifiers `ws:` and `wss:` effectively authorizes live WebSocket connections to **any host on the Internet**, introducing data exfiltration and cross-site interaction risks.

#### Target Architecture
1. **Helmet Middleware (`backend/src/app.ts`)**:
   Remove `'ws:'` and `'wss:'` from `connectSrc` in `helmet.contentSecurityPolicy` directives:
   ```typescript
   connectSrc: ["'self'"],
   ```
2. **Nginx Security Headers (`frontend/security-headers.conf`)**:
   Update the `Content-Security-Policy` header:
   Remove `ws:` and `wss:` from `connect-src`.
3. **Parity Tests (`backend/src/__tests__/unit/csp.test.ts`)**:
   Ensure automated assertions verify:
   - Helmet headers do not contain `ws:` or `wss:`.
   - Nginx configuration does not contain `ws:` or `wss:` in `connect-src`.
   - Parity between backend Helmet CSP and frontend Nginx CSP is strictly maintained.

---

### 2.6 Backend Test Suite Temporary Upload Isolation (`backend/src/__tests__/helpers/jest.setup.ts`)

#### Current Defect
Test cases that invoke route handlers or services performing uploads without setting `process.env.UPLOAD_DIR` default to writing into the working directory's `backend/uploads` directory. Over multiple Jest runs, hundreds of orphaned test files are written to disk.

#### Target Architecture
1. In `backend/src/__tests__/helpers/jest.setup.ts`:
   - Generate a unique temporary directory per Jest worker:
     ```typescript
     import fs from 'node:fs';
     import os from 'node:os';
     import path from 'node:path';

     const workerId = process.env.JEST_WORKER_ID || '0';
     const testUploadDir = fs.mkdtempSync(
       path.join(os.tmpdir(), `cozyvtt-test-uploads-${workerId}-`)
     );
     process.env.UPLOAD_DIR = testUploadDir;
     ```
   - Register a global teardown hook in `afterAll`:
     ```typescript
     afterAll(() => {
       try {
         if (fs.existsSync(testUploadDir)) {
           fs.rmSync(testUploadDir, { recursive: true, force: true });
         }
       } catch (err) {
         console.warn(`Failed to clean up test upload dir: ${testUploadDir}`, err);
       }
     });
     ```
2. Ensure no test file creates or leaves files in `backend/uploads/` during `npm test`.

---

### 2.7 Nginx Container WebSocket Termination & Compose Shutdown (`nginx.conf` & `docker-compose.yml`)

#### Current Defect
On `docker compose stop`, Docker sends `SIGQUIT` or `SIGTERM` to containers. Nginx default configuration waits indefinitely for open WebSocket connections to close naturally. As a result, Nginx workers never exit gracefully, forcing Docker to wait the full 10-second timeout before sending `SIGKILL` (causing container exit code 137 and ungraceful TCP resets).

#### Target Architecture
1. **Nginx Configuration (`frontend/nginx.conf`)**:
   Add `worker_shutdown_timeout 5s;` to the main/HTTP configuration block. This instructs Nginx workers to stop accepting new connections and forcefully terminate persistent connections (including WebSockets) after 5 seconds if not closed.
2. **Docker Compose Configuration (`docker-compose.yml` & `docker-compose.prod.yml`)**:
   Ensure services define `stop_grace_period: 15s` and appropriate stop signals (default `SIGQUIT` for Nginx, `SIGTERM` for backend) so processes complete bounded teardown well before Docker sends `SIGKILL`.

---

## 3. Inventory of Referenced TODO Removals

The following 6 `// TODO(#158)` occurrences must be removed upon completing the corresponding fixes:

1. `backend/src/utils/archive.ts`: Stream lifecycle and safe extraction helper.
2. `backend/src/routes/admin.ts`: Exclusion of `backups` directory in `writeBackupZip`.
3. `backend/src/routes/admin.ts`: Missing audit log on post-restore migration failure.
4. `backend/src/utils/shutdown.ts`: Logger write after end prevention.
5. `backend/src/app.ts`: Removal of `ws:` and `wss:` in Helmet CSP.
6. `backend/src/__tests__/helpers/jest.setup.ts`: Per-worker temporary `UPLOAD_DIR` assignment.

In addition, remove the corresponding items under *Known Issues > Server and deployment* in `docs/FUTURE_FEATURES.md`.

---

## 4. Security & Compliance Considerations

- **OWASP LLM01 / Injection Immunity**: Archive paths and directory entries remain validated against directory traversal and null byte injections. No user-supplied archive path is trusted without boundary checks.
- **CSP Level 3 Compliance**: Removal of bare `ws:` and `wss:` closes an exfiltration vector while maintaining full WebSocket functionality for same-origin clients.
- **Audit Invariants**: Every administrative database restoration attempt is recorded in the **Administrator audit log**, ensuring accountability even when schema migrations fail.

---

## 5. Verification & Testing Plan

### 5.1 Automated Unit Tests
- **Archive Extraction (`backend/src/__tests__/unit/archive.test.ts`)**:
  - Verify that a corrupted or oversized archive releases its file descriptor immediately without locking.
  - Verify that zip-slip attempts throw `ArchiveExtractionError` and leave no extracted files on disk.
- **Backup Content Verification (`backend/src/__tests__/integration/admin-backup.test.ts`)**:
  - Create an **Instance backup** while `uploads/backups/` exists on disk.
  - Inspect the generated `.zip` entry manifest: assert that neither `backups` nor `backups/*` entries exist in the archive.
- **Audit Log Verification (`backend/src/__tests__/integration/admin-restore.test.ts`)**:
  - Mock `runPrismaMigrateDeploy` to throw an error.
  - Call `POST /api/admin/backups/restore`.
  - Verify HTTP 500 response.
  - Verify that an audit record (`INSTANCE_RESTORE_MIGRATION_FAILED`) was written, or that `logger.error` was called if the database was unreachable.
- **Shutdown Logger Safety (`backend/src/__tests__/unit/shutdown.test.ts`)**:
  - Invoke `exitAfterLogs`.
  - Trigger a second signal or deadline timeout.
  - Assert no `"write after end"` exception is thrown; verify output was redirected to console.
- **CSP Parity Tests (`backend/src/__tests__/unit/csp.test.ts`)**:
  - Assert `connectSrc` in Express app Helmet headers contains only `'self'` and required endpoints, excluding `ws:` and `wss:`.
  - Assert `frontend/security-headers.conf` matches backend CSP headers.
- **Test Upload Isolation (`backend/src/__tests__/unit/jest-setup.test.ts` or filesystem check)**:
  - Verify `process.env.UPLOAD_DIR` points to an `os.tmpdir()` subdirectory during test execution.
  - Verify `backend/uploads` directory has 0 new files after running test suites.

### 5.2 Integration & Operational Verification
- Start containers with `docker compose up -d`.
- Open an active WebSocket connection to the table.
- Execute `time docker compose stop`.
- Verify container stops in under 6 seconds without waiting for 10s `SIGKILL` timeout.
