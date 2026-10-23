/**
 * Instance backup AES-256-GCM: magic bytes, round-trip, plaintext detection,
 * and a wrong key failing the auth tag.
 */

import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import {
  BACKUP_ARCHIVE_MAGIC,
  BackupEncryptedWithUnknownKeyError,
  ZIP_LOCAL_FILE_MAGIC,
  decryptBackupFile,
  encryptBackupToFile,
  inspectBackupFileKind,
  pipeEncryptedBackup,
} from '../backupEncryption';
import { ArchiveRefusedError } from '../archive';
import { expectFileMode } from '../../__tests__/helpers/fileModes';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const OTHER_KEY = Buffer.from('22'.repeat(32), 'hex');

async function zipBytes(entries: Record<string, string>): Promise<Buffer> {
  const archive = new ZipArchive();
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  for (const [name, body] of Object.entries(entries)) archive.append(body, { name });
  await archive.finalize();
  await ended;
  return Buffer.concat(chunks);
}

describe('backup encryption', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cozyvtt-bkenc-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('loads without a backup key and does not throw', () => {
    const previous = process.env.BACKUP_ENCRYPTION_KEY;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    try {
      expect(() => require('../backupEncryption')).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = previous;
    }
  });

  it('writes magic CVTTBK01, not a ZIP PK header, and round-trips the ZIP', async () => {
    const zip = await zipBytes({ 'database.sql': '-- dump\n' });
    const enc = path.join(dir, 'backup.zip');
    const dec = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, KEY);

    const header = Buffer.alloc(8);
    const handle = await fs.open(enc, 'r');
    try {
      await handle.read(header, 0, 8, 0);
    } finally {
      await handle.close();
    }
    expect(header.equals(BACKUP_ARCHIVE_MAGIC)).toBe(true);
    expect(header.subarray(0, 4).equals(ZIP_LOCAL_FILE_MAGIC)).toBe(false);
    expect(await inspectBackupFileKind(enc)).toBe('encrypted');

    await decryptBackupFile(enc, dec, [KEY]);
    const opened = await unzipper.Open.file(dec);
    const names = opened.files.filter((f) => f.type === 'File').map((f) => f.path);
    expect(names).toEqual(['database.sql']);
    const sql = opened.files.find((f) => f.path === 'database.sql');
    expect(sql).toBeDefined();
    expect((await sql!.buffer()).toString('utf8')).toBe('-- dump\n');
    await expectFileMode(enc, 0o777, 0o600);
    await expectFileMode(dec, 0o777, 0o600);
  });

  it('encrypts an archiver stream that finalizes after the pipe is started', async () => {
    const enc = path.join(dir, 'from-archive.zip');
    const dec = path.join(dir, 'from-archive.plain.zip');
    const output = createWriteStream(enc, { flags: 'wx', mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const writing = pipeEncryptedBackup(archive, output, KEY);
    archive.append('-- dump\n', { name: 'database.sql' });
    archive.finalize();
    await writing;
    await decryptBackupFile(enc, dec, [KEY]);
    const opened = await unzipper.Open.file(dec);
    const sql = opened.files.find((f) => f.path === 'database.sql');
    expect((await sql!.buffer()).toString('utf8')).toBe('-- dump\n');
  });

  it('detects a legacy plaintext ZIP by its PK header', async () => {
    const zip = await zipBytes({ 'database.sql': 'x' });
    const file = path.join(dir, 'legacy.zip');
    await fs.writeFile(file, zip);
    expect(await inspectBackupFileKind(file)).toBe('zip');
    expect(zip.subarray(0, 4).equals(ZIP_LOCAL_FILE_MAGIC)).toBe(true);
  });

  it('fails the auth tag with the wrong key and does not treat SESSION_SECRET as a backup key', async () => {
    const zip = await zipBytes({ 'database.sql': 'secret dump' });
    const enc = path.join(dir, 'backup.zip');
    await encryptBackupToFile(Readable.from(zip), enc, KEY);

    const wrong = path.join(dir, 'wrong.zip');
    await expect(decryptBackupFile(enc, wrong, [OTHER_KEY])).rejects.toBeInstanceOf(
      BackupEncryptedWithUnknownKeyError
    );
    await expect(fs.access(wrong)).rejects.toThrow();

    const session = path.join(dir, 'session.zip');
    const sessionSecret = Buffer.from('33'.repeat(32), 'hex');
    await expect(decryptBackupFile(enc, session, [sessionSecret])).rejects.toBeInstanceOf(
      BackupEncryptedWithUnknownKeyError
    );
  });

  it('decrypts with a previous key after the current key fails the auth tag', async () => {
    const zip = await zipBytes({ 'database.sql': 'old' });
    const enc = path.join(dir, 'backup.zip');
    const dec = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, OTHER_KEY);
    await decryptBackupFile(enc, dec, [KEY, OTHER_KEY]);
    const opened = await unzipper.Open.file(dec);
    expect((await opened.files[0].buffer()).toString('utf8')).toBe('old');
  });

  it('refuses a truncated encrypted file without calling it a ZIP', async () => {
    const file = path.join(dir, 'short.zip');
    await fs.writeFile(file, BACKUP_ARCHIVE_MAGIC);
    expect(await inspectBackupFileKind(file)).toBe('encrypted');
    await expect(decryptBackupFile(file, path.join(dir, 'out.zip'), [KEY])).rejects.toBeInstanceOf(
      ArchiveRefusedError
    );
  });
});
