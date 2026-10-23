#!/usr/bin/env node
/**
 * Unlock an Admin Dashboard Instance backup to a ZIP.
 *
 * Reads BACKUP_ENCRYPTION_KEY and BACKUP_ENCRYPTION_PREVIOUS_KEYS from the
 * environment. Never SESSION_SECRET: a value that equals the session secret
 * is skipped, not tried.
 *
 * If the file starts with CVTTBK01, decrypt AES-256-GCM (same on-disk layout
 * as backend/src/utils/backupEncryption.ts) to a ZIP. If it starts with a ZIP
 * local header (PK\x03\x04), copy through as a legacy plaintext archive.
 * Anything else exits non-zero.
 *
 * Usage:
 *   node scripts/unlock-instance-backup.mjs <source> [dest]
 *
 * dest omitted or "-" writes ZIP bytes to stdout. Messages go to stderr.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';

// Duplicated from backend/src/utils/backupEncryption.ts; keepInStep.test.ts
// compares BACKUP_ARCHIVE_MAGIC / BACKUP_NONCE_LENGTH / BACKUP_AUTH_TAG_LENGTH.
export const BACKUP_ARCHIVE_MAGIC = Buffer.from('CVTTBK01', 'ascii');
export const ZIP_LOCAL_FILE_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const BACKUP_NONCE_LENGTH = 12;
export const BACKUP_AUTH_TAG_LENGTH = 16;

const HEX_KEY = /^[0-9a-f]{64}$/i;
const HEADER_LENGTH = BACKUP_ARCHIVE_MAGIC.length + BACKUP_NONCE_LENGTH;
const MIN_ENCRYPTED_LENGTH = HEADER_LENGTH + BACKUP_AUTH_TAG_LENGTH;

const UNKNOWN_KEY_MESSAGE =
  'This archive is encrypted with a key this Instance does not have. Set BACKUP_ENCRYPTION_KEY to the key that encrypted it, or list that key in BACKUP_ENCRYPTION_PREVIOUS_KEYS.';
const UNKNOWN_FORMAT_MESSAGE =
  'The file is not an encrypted Instance backup (CVTTBK01) and not a legacy plaintext ZIP.';
const DAMAGED_MESSAGE = 'The file is not a complete encrypted Instance backup, or it is damaged.';
const SAME_PATH_MESSAGE = 'Source and destination are the same path; the file was left unchanged.';
const DEST_EXISTS_MESSAGE = 'The destination already exists; the existing file was left unchanged.';

function parseBackupEncryptionKeyHex(raw) {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

function equalsSessionSecret(key) {
  const session = process.env.SESSION_SECRET;
  if (session === undefined || session.trim() === '') return false;
  const sessionKey = parseBackupEncryptionKeyHex(session);
  if (sessionKey !== null) {
    return sessionKey.length === key.length && crypto.timingSafeEqual(sessionKey, key);
  }
  return key.toString('hex').toLowerCase() === session.trim().toLowerCase();
}

/** Current then previous env keys. Never SESSION_SECRET. */
function restoreBackupEncryptionKeys() {
  const keys = [];
  const seen = new Set();
  const add = (key) => {
    if (equalsSessionSecret(key)) return;
    const id = key.toString('hex');
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(key);
  };
  const current = parseBackupEncryptionKeyHex(process.env.BACKUP_ENCRYPTION_KEY);
  if (current !== null) add(current);
  const raw = process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS;
  if (raw !== undefined && raw.trim() !== '') {
    for (const part of raw.split(/[,\s]+/)) {
      if (part === '') continue;
      const key = parseBackupEncryptionKeyHex(part);
      if (key !== null) add(key);
    }
  }
  return keys;
}

function isAuthTagFailure(error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (
    code === 'ERR_CRYPTO_INVALID_AUTH_TAG' ||
    code === 'ERR_OSSL_BAD_DECRYPT' ||
    code === 'ERR_CRYPTO_OPERATION'
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /unable to authenticate data/i.test(message) || /invalid auth(?:entication)? tag/i.test(message);
}

async function inspectKind(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(BACKUP_ARCHIVE_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (
      bytesRead >= BACKUP_ARCHIVE_MAGIC.length &&
      buf.subarray(0, BACKUP_ARCHIVE_MAGIC.length).equals(BACKUP_ARCHIVE_MAGIC)
    ) {
      return 'encrypted';
    }
    if (
      bytesRead >= ZIP_LOCAL_FILE_MAGIC.length &&
      buf.subarray(0, ZIP_LOCAL_FILE_MAGIC.length).equals(ZIP_LOCAL_FILE_MAGIC)
    ) {
      return 'zip';
    }
    return 'unknown';
  } finally {
    await handle.close();
  }
}

/** Same path.resolve, or the same file after realpath when both exist. */
async function isSamePath(sourcePath, destPath) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDest = path.resolve(destPath);
  if (resolvedSource === resolvedDest) return true;
  try {
    const [realSource, realDest] = await Promise.all([
      fsp.realpath(resolvedSource),
      fsp.realpath(resolvedDest),
    ]);
    return realSource === realDest;
  } catch {
    return false;
  }
}

/**
 * createWriteStream({ flags: 'wx' }) emits EEXIST on `error`; it does not throw.
 * Resolve only after `open` so an existing dest is never treated as ours.
 */
function waitForExclusiveOpen(stream) {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      stream.off('open', onOpen);
      reject(error);
    };
    stream.once('open', onOpen);
    stream.once('error', onError);
  });
}

function wrapDestError(error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    return new Error(DEST_EXISTS_MESSAGE);
  }
  return error;
}

/** Unlink dest only if this attempt created it (after wx open succeeded). */
async function writeExclusive(destPath, writeFn) {
  const out = fs.createWriteStream(destPath, { flags: 'wx', mode: 0o600 });
  let opened = false;
  try {
    await waitForExclusiveOpen(out);
    opened = true;
    await writeFn(out);
  } catch (error) {
    out.destroy();
    if (opened) {
      await fsp.unlink(destPath).catch(() => undefined);
    }
    throw wrapDestError(error);
  }
  await fsp.chmod(destPath, 0o600);
}

/** In-memory sink so a failed key is never written to stdout or dest. */
function discardSink() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

async function decryptOnce(sourcePath, dest, key, layout) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, layout.nonce);
  decipher.setAuthTag(layout.tag);
  const cipherBytes = layout.ciphertextEnd - layout.ciphertextStart + 1;
  const src =
    cipherBytes <= 0
      ? Readable.from([])
      : fs.createReadStream(sourcePath, {
          start: layout.ciphertextStart,
          end: layout.ciphertextEnd,
        });
  await pipeline(src, decipher, dest);
}

async function readEncryptedLayout(sourcePath) {
  const handle = await fsp.open(sourcePath, 'r');
  let size;
  let header;
  try {
    size = (await handle.stat()).size;
    header = Buffer.alloc(HEADER_LENGTH);
    const { bytesRead } = await handle.read(header, 0, HEADER_LENGTH, 0);
    if (
      bytesRead < HEADER_LENGTH ||
      !header.subarray(0, BACKUP_ARCHIVE_MAGIC.length).equals(BACKUP_ARCHIVE_MAGIC)
    ) {
      throw new Error(DAMAGED_MESSAGE);
    }
  } finally {
    await handle.close();
  }

  if (size < MIN_ENCRYPTED_LENGTH) {
    throw new Error(DAMAGED_MESSAGE);
  }

  const nonce = header.subarray(BACKUP_ARCHIVE_MAGIC.length, HEADER_LENGTH);
  const tag = Buffer.alloc(BACKUP_AUTH_TAG_LENGTH);
  const tagHandle = await fsp.open(sourcePath, 'r');
  try {
    const { bytesRead } = await tagHandle.read(tag, 0, BACKUP_AUTH_TAG_LENGTH, size - BACKUP_AUTH_TAG_LENGTH);
    if (bytesRead < BACKUP_AUTH_TAG_LENGTH) {
      throw new Error(DAMAGED_MESSAGE);
    }
  } finally {
    await tagHandle.close();
  }

  return {
    nonce,
    tag,
    ciphertextStart: HEADER_LENGTH,
    ciphertextEnd: size - BACKUP_AUTH_TAG_LENGTH - 1,
  };
}

async function findWorkingKey(sourcePath, keys, layout) {
  if (keys.length === 0) {
    throw new Error(UNKNOWN_KEY_MESSAGE);
  }
  for (const key of keys) {
    try {
      await decryptOnce(sourcePath, discardSink(), key, layout);
      return key;
    } catch (error) {
      if (!isAuthTagFailure(error)) throw error;
    }
  }
  throw new Error(UNKNOWN_KEY_MESSAGE);
}

async function decryptBackupFile(sourcePath, destPath, keys) {
  const layout = await readEncryptedLayout(sourcePath);
  const key = await findWorkingKey(sourcePath, keys, layout);
  await writeExclusive(destPath, (out) => decryptOnce(sourcePath, out, key, layout));
}

async function copyThrough(sourcePath, destPath) {
  await writeExclusive(destPath, (out) => pipeline(fs.createReadStream(sourcePath), out));
}

async function unlockToFile(sourcePath, destPath) {
  if (await isSamePath(sourcePath, destPath)) {
    throw new Error(SAME_PATH_MESSAGE);
  }
  const kind = await inspectKind(sourcePath);
  if (kind === 'encrypted') {
    await decryptBackupFile(sourcePath, destPath, restoreBackupEncryptionKeys());
    return;
  }
  if (kind === 'zip') {
    await copyThrough(sourcePath, destPath);
    return;
  }
  throw new Error(UNKNOWN_FORMAT_MESSAGE);
}

async function unlockToStdout(sourcePath) {
  const kind = await inspectKind(sourcePath);
  if (kind === 'encrypted') {
    const layout = await readEncryptedLayout(sourcePath);
    const key = await findWorkingKey(sourcePath, restoreBackupEncryptionKeys(), layout);
    await decryptOnce(sourcePath, process.stdout, key, layout);
    return;
  }
  if (kind === 'zip') {
    await pipeline(fs.createReadStream(sourcePath), process.stdout);
    return;
  }
  throw new Error(UNKNOWN_FORMAT_MESSAGE);
}

function usage() {
  process.stderr.write(
    'Usage: node scripts/unlock-instance-backup.mjs <source> [dest]\n' +
      'Unlock an Admin Dashboard Instance backup to a ZIP. dest omitted or "-" writes to stdout.\n' +
      'Reads BACKUP_ENCRYPTION_KEY and BACKUP_ENCRYPTION_PREVIOUS_KEYS. Never SESSION_SECRET.\n'
  );
}

async function main() {
  const sourcePath = process.argv[2];
  const destArg = process.argv[3];
  if (!sourcePath || sourcePath === '-h' || sourcePath === '--help') {
    usage();
    process.exit(sourcePath ? 0 : 2);
  }

  const toStdout = destArg === undefined || destArg === '-';
  if (toStdout) {
    await unlockToStdout(sourcePath);
    return;
  }

  await unlockToFile(sourcePath, destArg);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
