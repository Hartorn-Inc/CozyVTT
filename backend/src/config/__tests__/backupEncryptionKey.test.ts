/**
 * Parsing BACKUP_ENCRYPTION_KEY / BACKUP_ENCRYPTION_PREVIOUS_KEYS.
 *
 * A missing or unusable current key still boots; it is not SESSION_SECRET.
 */

import logger from '../../utils/logger';
import {
  BACKUP_ENCRYPTION_KEY_MISSING,
  backupEncryptionKeyMissingReply,
  backupEncryptionKeyProblem,
  currentBackupEncryptionKey,
  parseBackupEncryptionKeyHex,
  previousBackupEncryptionKeys,
  restoreBackupEncryptionKeys,
  warnIfBackupEncryptionKeyUnusable,
} from '../backupEncryptionKey';

const VALID = 'Ab'.repeat(32);
const VALID_LOWER = VALID.toLowerCase();
const OTHER = 'cd'.repeat(32);

const saved: Record<string, string | undefined> = {};

function remember(keys: string[]) {
  for (const key of keys) saved[key] = process.env[key];
}

function restore() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  remember(['BACKUP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_PREVIOUS_KEYS', 'SESSION_SECRET', 'NODE_ENV']);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

describe('parseBackupEncryptionKeyHex', () => {
  it('accepts 64 hex characters, trimming whitespace and ignoring case', () => {
    const key = parseBackupEncryptionKeyHex(`  ${VALID}  `);
    expect(key).not.toBeNull();
    expect(key!.equals(Buffer.from(VALID_LOWER, 'hex'))).toBe(true);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['too short', 'aa'.repeat(16)],
    ['too long', `${'aa'.repeat(32)}aa`],
    ['not hex', 'g'.repeat(64)],
  ])('rejects %s', (_label, raw) => {
    expect(parseBackupEncryptionKeyHex(raw)).toBeNull();
  });
});

describe('currentBackupEncryptionKey', () => {
  it('loads without throwing when the key is missing', () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    expect(() => require('../backupEncryptionKey')).not.toThrow();
    expect(currentBackupEncryptionKey()).toBeNull();
    expect(backupEncryptionKeyProblem()).toBe('is not set');
  });

  it('treats a key equal to SESSION_SECRET as unusable, even when well-formed', () => {
    process.env.BACKUP_ENCRYPTION_KEY = VALID;
    process.env.SESSION_SECRET = VALID_LOWER;
    expect(currentBackupEncryptionKey()).toBeNull();
    expect(backupEncryptionKeyProblem()).toBe('must not equal SESSION_SECRET');
  });

  it('returns the 32-byte key when it is usable', () => {
    process.env.BACKUP_ENCRYPTION_KEY = VALID;
    process.env.SESSION_SECRET = OTHER;
    expect(currentBackupEncryptionKey()!.equals(Buffer.from(VALID_LOWER, 'hex'))).toBe(true);
  });
});

describe('previousBackupEncryptionKeys and restoreBackupEncryptionKeys', () => {
  it('splits on commas and whitespace and skips unusable entries', () => {
    process.env.BACKUP_ENCRYPTION_KEY = VALID;
    process.env.SESSION_SECRET = 'ee'.repeat(32);
    process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS = `  ${OTHER}, not-a-key\t${'ee'.repeat(32)}  ${OTHER} `;
    const previous = previousBackupEncryptionKeys();
    expect(previous).toHaveLength(1);
    expect(previous[0].equals(Buffer.from(OTHER, 'hex'))).toBe(true);

    const restoreKeys = restoreBackupEncryptionKeys();
    expect(restoreKeys).toHaveLength(2);
    expect(restoreKeys[0].equals(Buffer.from(VALID_LOWER, 'hex'))).toBe(true);
    expect(restoreKeys[1].equals(Buffer.from(OTHER, 'hex'))).toBe(true);
  });

  it('never includes SESSION_SECRET among restore keys', () => {
    const session = 'ff'.repeat(32);
    process.env.SESSION_SECRET = session;
    process.env.BACKUP_ENCRYPTION_KEY = session;
    process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS = session;
    expect(restoreBackupEncryptionKeys()).toEqual([]);
  });
});

describe('backupEncryptionKeyMissingReply', () => {
  it('names BACKUP_ENCRYPTION_KEY, says the Instance still runs, and refuses a plaintext archive', () => {
    const body = backupEncryptionKeyMissingReply();
    expect(body.error).toBe('Backup Unavailable');
    expect(body.code).toBe(BACKUP_ENCRYPTION_KEY_MISSING);
    expect(body.message).toContain('BACKUP_ENCRYPTION_KEY');
    expect(body.message).toMatch(/Instance still runs/);
    expect(body.message).toMatch(/plaintext archive is not written/);
    expect(body.message).not.toMatch(/Nothing was restored/);
    expect(backupEncryptionKeyMissingReply(true).message).toMatch(/Nothing was restored/);
  });
});

describe('warnIfBackupEncryptionKeyUnusable', () => {
  it('warns and does not exit when the key is missing, including in production', () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    expect(() => warnIfBackupEncryptionKeyUnusable()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BACKUP_ENCRYPTION_KEY'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openssl rand -hex 32'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Instance still runs'));
  });

  it('does not warn when the current key is usable', () => {
    process.env.BACKUP_ENCRYPTION_KEY = VALID;
    process.env.SESSION_SECRET = OTHER;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    warnIfBackupEncryptionKeyUnusable();
    expect(warn).not.toHaveBeenCalled();
  });
});
