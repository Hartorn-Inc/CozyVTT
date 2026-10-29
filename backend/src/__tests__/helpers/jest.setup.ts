/**
 * Runs in every jest worker before its test files load.
 *
 * Each worker holds two Prisma clients (the app's and the test helpers'), and
 * each client's pg pool opens up to ten connections unless the address sets
 * `connection_limit` (config/prismaClient.ts). A full run with several
 * workers that also fires parallel requests once reached PostgreSQL's default
 * ceiling of a hundred: unrelated suites failed with "too many clients
 * already". Five connections a client is plenty for a test file, and keeps
 * the whole run far below the ceiling whatever the machine.
 */
const url = process.env.DATABASE_URL;
if (url && !/[?&]connection_limit=/.test(url)) {
  process.env.DATABASE_URL = `${url}${url.includes('?') ? '&' : '?'}connection_limit=5`;
}

// TODO(#158): a test file that sets no UPLOAD_DIR of its own writes into
// the real backend/uploads (campaignImportGeometry.test.ts and others left
// about 470 files there over two full runs). Point UPLOAD_DIR at a fresh
// temporary folder here for every worker, as the files that do set it do.

// Instance backups are encrypted with BACKUP_ENCRYPTION_KEY. A missing key
// refuses POST /api/admin/backups; tests that cover that refusal unset this.
// 64 hex characters, not SESSION_SECRET. openssl rand -hex 32.
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  process.env.BACKUP_ENCRYPTION_KEY = 'a1'.repeat(32);
}
