/**
 * AES-256-GCM encryption for Admin Dashboard Instance backups.
 *
 * A new archive on disk is not a ZIP. It is:
 *   1. Magic ASCII `CVTTBK01` (8 bytes) — a ZIP starts with `PK`
 *   2. 12-byte random nonce
 *   3. AES-256-GCM ciphertext of the ZIP bytes
 *   4. 16-byte GCM auth tag at the end
 *
 * The dashboard filename stays `backup-….zip`. Streams; the ZIP is never
 * buffered whole. Restore still reads a legacy plaintext ZIP, and tries the
 * current then previous backup keys. Never SESSION_SECRET.
 */

import crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import { Readable, type Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { restoreBackupEncryptionKeys } from '../config/backupEncryptionKey';
import { ArchiveRefusedError } from './archive';
import { errorCode, errorMessage } from './errors';

export const BACKUP_ARCHIVE_MAGIC = Buffer.from('CVTTBK01', 'ascii');
export const ZIP_LOCAL_FILE_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const BACKUP_NONCE_LENGTH = 12;
export const BACKUP_AUTH_TAG_LENGTH = 16;

const HEADER_LENGTH = BACKUP_ARCHIVE_MAGIC.length + BACKUP_NONCE_LENGTH;
const MIN_ENCRYPTED_LENGTH = HEADER_LENGTH + BACKUP_AUTH_TAG_LENGTH;

const UNKNOWN_KEY_MESSAGE =
  'This archive is encrypted with a key this Instance does not have. Set BACKUP_ENCRYPTION_KEY to the key that encrypted it, or list that key in BACKUP_ENCRYPTION_PREVIOUS_KEYS. Nothing was changed.';

export class BackupEncryptedWithUnknownKeyError extends Error {
  constructor() {
    super(UNKNOWN_KEY_MESSAGE);
    this.name = 'BackupEncryptedWithUnknownKeyError';
  }
}

export type BackupFileKind = 'encrypted' | 'zip' | 'unknown';

/** Whether the file starts with the encrypted-backup magic or a ZIP local header. */
export async function inspectBackupFileKind(filePath: string): Promise<BackupFileKind> {
  const handle = await fs.open(filePath, 'r');
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

/**
 * Write magic, nonce, ciphertext and auth tag to `output`. `plaintext` is the
 * ZIP stream (archiver). The destination is not ended until the tag is written.
 */
export async function pipeEncryptedBackup(
  plaintext: Readable,
  output: Writable,
  key: Buffer,
): Promise<void> {
  const nonce = crypto.randomBytes(BACKUP_NONCE_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  // Capture ZIP bytes before this function awaits, so a small archive that
  // finalizes in the same tick is not lost.
  plaintext.pipe(cipher);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let tagWritten = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      plaintext.destroy();
      cipher.destroy();
      output.destroy();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    output.on('error', fail);
    cipher.on('error', fail);
    plaintext.on('error', fail);
    output.on('finish', succeed);
    output.on('close', succeed);

    const onCipherDone = () => {
      if (tagWritten || settled) return;
      tagWritten = true;
      let tag: Buffer;
      try {
        tag = cipher.getAuthTag();
      } catch (error) {
        fail(error);
        return;
      }
      output.write(tag, (tagError) => {
        if (tagError) {
          fail(tagError);
          return;
        }
        output.end();
      });
    };

    const header = Buffer.concat([BACKUP_ARCHIVE_MAGIC, nonce]);
    output.write(header, (writeError) => {
      if (writeError) {
        fail(writeError);
        return;
      }
      cipher.pipe(output, { end: false });
      cipher.once('end', onCipherDone);
      if (cipher.readableEnded) onCipherDone();
    });
  });
}

/** Encrypt a ZIP stream to a new file, mode 0600. */
export async function encryptBackupToFile(
  plaintext: Readable,
  destPath: string,
  key: Buffer,
): Promise<void> {
  const output = createWriteStream(destPath, { flags: 'wx', mode: 0o600 });
  try {
    await pipeEncryptedBackup(plaintext, output, key);
  } catch (error) {
    output.destroy();
    await fs.unlink(destPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Decrypt an encrypted Instance backup to a ZIP file. Tries `keys` in order,
 * or the current then previous env keys when omitted. Never SESSION_SECRET.
 */
export async function decryptBackupFile(
  sourcePath: string,
  destPath: string,
  keys?: readonly Buffer[],
): Promise<void> {
  const tryKeys = keys ?? restoreBackupEncryptionKeys();
  const handle = await fs.open(sourcePath, 'r');
  let size: number;
  let header: Buffer;
  try {
    size = (await handle.stat()).size;
    header = Buffer.alloc(HEADER_LENGTH);
    const { bytesRead } = await handle.read(header, 0, HEADER_LENGTH, 0);
    if (
      bytesRead < HEADER_LENGTH ||
      !header.subarray(0, BACKUP_ARCHIVE_MAGIC.length).equals(BACKUP_ARCHIVE_MAGIC)
    ) {
      throw new ArchiveRefusedError(
        'The file is not a complete encrypted Instance backup, or it is damaged.'
      );
    }
  } finally {
    await handle.close();
  }

  if (size < MIN_ENCRYPTED_LENGTH) {
    throw new ArchiveRefusedError(
      'The file is not a complete encrypted Instance backup, or it is damaged.'
    );
  }

  const nonce = header.subarray(BACKUP_ARCHIVE_MAGIC.length, HEADER_LENGTH);
  const tag = Buffer.alloc(BACKUP_AUTH_TAG_LENGTH);
  const tagHandle = await fs.open(sourcePath, 'r');
  try {
    const { bytesRead } = await tagHandle.read(tag, 0, BACKUP_AUTH_TAG_LENGTH, size - BACKUP_AUTH_TAG_LENGTH);
    if (bytesRead < BACKUP_AUTH_TAG_LENGTH) {
      throw new ArchiveRefusedError(
        'The file is not a complete encrypted Instance backup, or it is damaged.'
      );
    }
  } finally {
    await tagHandle.close();
  }

  if (tryKeys.length === 0) {
    throw new BackupEncryptedWithUnknownKeyError();
  }

  const ciphertextStart = HEADER_LENGTH;
  const ciphertextEnd = size - BACKUP_AUTH_TAG_LENGTH - 1;

  for (const key of tryKeys) {
    try {
      await decryptOnce(sourcePath, destPath, key, nonce, tag, ciphertextStart, ciphertextEnd);
      await fs.chmod(destPath, 0o600);
      return;
    } catch (error) {
      await fs.unlink(destPath).catch(() => undefined);
      if (!isAuthTagFailure(error)) throw error;
    }
  }
  throw new BackupEncryptedWithUnknownKeyError();
}

async function decryptOnce(
  sourcePath: string,
  destPath: string,
  key: Buffer,
  nonce: Buffer,
  tag: Buffer,
  ciphertextStart: number,
  ciphertextEnd: number,
): Promise<void> {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const out = createWriteStream(destPath, { flags: 'wx', mode: 0o600 });
  const cipherBytes = ciphertextEnd - ciphertextStart + 1;
  const src =
    cipherBytes <= 0
      ? Readable.from([])
      : createReadStream(sourcePath, { start: ciphertextStart, end: ciphertextEnd });
  try {
    await pipeline(src, decipher, out);
  } catch (error) {
    out.destroy();
    throw error;
  }
}

function isAuthTagFailure(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === 'ERR_CRYPTO_INVALID_AUTH_TAG' ||
    code === 'ERR_OSSL_BAD_DECRYPT' ||
    code === 'ERR_CRYPTO_OPERATION'
  ) {
    return true;
  }
  const message = errorMessage(error) ?? '';
  return /unable to authenticate data/i.test(message) || /invalid auth(?:entication)? tag/i.test(message);
}
