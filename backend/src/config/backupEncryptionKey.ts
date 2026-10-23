/**
 * The Operator-held key that encrypts Admin Dashboard Instance backups.
 *
 * Read from process.env at call time so a test can set or unset it between
 * requests. Never SESSION_SECRET: a value that equals the session secret is
 * treated as missing for a new backup, and is never tried on decrypt.
 *
 * A missing or unusable key does not stop the process. Creating a new backup
 * is refused so a plaintext archive is not written.
 */

import crypto from 'crypto';
import logger from '../utils/logger';

/** 32 bytes as 64 hex characters (`openssl rand -hex 32`). */
const HEX_KEY = /^[0-9a-f]{64}$/i;

export const BACKUP_ENCRYPTION_KEY_MISSING = 'BACKUP_ENCRYPTION_KEY_MISSING';

const MISSING_KEY_MESSAGE =
  'BACKUP_ENCRYPTION_KEY is not set or is unusable. The Instance still runs. A new backup is refused so a plaintext archive is not written.';

/**
 * Why the current backup key cannot be used for a new Instance backup, as a
 * clause after "BACKUP_ENCRYPTION_KEY", or null when it is accepted. Does not
 * include the key material.
 */
export function backupEncryptionKeyProblem(
  raw: string | undefined = process.env.BACKUP_ENCRYPTION_KEY
): string | null {
  if (raw === undefined || raw.trim() === '') return 'is not set';
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) return 'is not 64 hexadecimal characters';
  if (equalsSessionSecret(Buffer.from(trimmed, 'hex'))) return 'must not equal SESSION_SECRET';
  return null;
}

/** 32-byte key from a 64-hex string, or null when the string is not that form. */
export function parseBackupEncryptionKeyHex(raw: string | undefined): Buffer | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

/**
 * The current `BACKUP_ENCRYPTION_KEY`, or null when it is missing or unusable
 * (including when it equals `SESSION_SECRET`).
 */
export function currentBackupEncryptionKey(): Buffer | null {
  const key = parseBackupEncryptionKeyHex(process.env.BACKUP_ENCRYPTION_KEY);
  if (key === null || equalsSessionSecret(key)) return null;
  return key;
}

/**
 * Previous keys from `BACKUP_ENCRYPTION_PREVIOUS_KEYS` (comma and/or whitespace
 * separated). Entries that are not 64 hex characters, or that equal
 * `SESSION_SECRET`, are skipped.
 */
export function previousBackupEncryptionKeys(): Buffer[] {
  const raw = process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS;
  if (raw === undefined || raw.trim() === '') return [];
  const keys: Buffer[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    if (part === '') continue;
    const key = parseBackupEncryptionKeyHex(part);
    if (key === null || equalsSessionSecret(key)) continue;
    const id = key.toString('hex');
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(key);
  }
  return keys;
}

/**
 * Keys restore tries, current then previous. Never `SESSION_SECRET`.
 */
export function restoreBackupEncryptionKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const seen = new Set<string>();
  const add = (key: Buffer) => {
    const id = key.toString('hex');
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(key);
  };
  const current = currentBackupEncryptionKey();
  if (current !== null) add(current);
  for (const key of previousBackupEncryptionKeys()) add(key);
  return keys;
}

export class BackupEncryptionKeyMissingError extends Error {
  readonly code = BACKUP_ENCRYPTION_KEY_MISSING;

  constructor() {
    super(MISSING_KEY_MESSAGE);
    this.name = 'BackupEncryptionKeyMissingError';
  }
}

/** HTTP body for a refused new backup (and restore's safety copy). */
export function backupEncryptionKeyMissingReply(nothingRestored = false): {
  error: 'Backup Unavailable';
  message: string;
  code: typeof BACKUP_ENCRYPTION_KEY_MISSING;
} {
  return {
    error: 'Backup Unavailable',
    message: nothingRestored ? `${MISSING_KEY_MESSAGE} Nothing was restored.` : MISSING_KEY_MESSAGE,
    code: BACKUP_ENCRYPTION_KEY_MISSING,
  };
}

/**
 * Warn at process start when a new Instance backup cannot be encrypted.
 * Never fatal: a production Instance still boots.
 */
export function warnIfBackupEncryptionKeyUnusable(): void {
  const problem = backupEncryptionKeyProblem();
  if (problem === null) return;
  logger.warn(
    `[WARN] BACKUP_ENCRYPTION_KEY ${problem}. ` +
      'The Instance still runs, but a new Instance backup is refused so a plaintext archive is not written. ' +
      'Generate a 64-character hex key with: openssl rand -hex 32'
  );
}

function equalsSessionSecret(key: Buffer): boolean {
  const session = process.env.SESSION_SECRET;
  if (session === undefined || session.trim() === '') return false;
  const sessionKey = parseBackupEncryptionKeyHex(session);
  if (sessionKey !== null) {
    return sessionKey.length === key.length && crypto.timingSafeEqual(sessionKey, key);
  }
  return key.toString('hex').toLowerCase() === session.trim().toLowerCase();
}
