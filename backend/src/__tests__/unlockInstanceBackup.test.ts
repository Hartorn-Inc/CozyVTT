/**
 * backend/scripts/unlock-instance-backup.mjs, run as Operators would:
 * node scripts/unlock-instance-backup.mjs <source> [dest]
 *
 * Decrypts CVTTBK01 archives with BACKUP_ENCRYPTION_KEY /
 * BACKUP_ENCRYPTION_PREVIOUS_KEYS, copies a legacy plaintext ZIP through,
 * and never treats SESSION_SECRET as a backup key.
 */
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { encryptBackupToFile } from '../utils/backupEncryption';
import { expectFileMode } from './helpers/fileModes';

const SCRIPT = path.resolve(__dirname, '../../scripts/unlock-instance-backup.mjs');
const KEY = '11'.repeat(32);
const OTHER_KEY = '22'.repeat(32);
const THIRD_KEY = '33'.repeat(32);

const describeOnPosix = process.platform === 'win32' ? describe.skip : describe;

describeOnPosix('unlock-instance-backup.mjs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cozyvtt-unlock-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const run = (args: string[], env: NodeJS.ProcessEnv, encoding: BufferEncoding | null = 'utf8') => {
    const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (!Object.prototype.hasOwnProperty.call(env, 'BACKUP_ENCRYPTION_KEY')) {
      delete merged.BACKUP_ENCRYPTION_KEY;
    }
    if (!Object.prototype.hasOwnProperty.call(env, 'BACKUP_ENCRYPTION_PREVIOUS_KEYS')) {
      delete merged.BACKUP_ENCRYPTION_PREVIOUS_KEYS;
    }
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding,
      env: merged,
    });
  };

  it('decrypts a CVTTBK01 archive written by the TypeScript module', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('dump-bytes')]);
    const enc = path.join(dir, 'backup.zip');
    const dest = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));

    const result = run([enc, dest], { BACKUP_ENCRYPTION_KEY: KEY });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(await fs.readFile(dest)).toEqual(zip);
    await expectFileMode(dest, 0o777, 0o600);
  });

  it('copies a legacy plaintext ZIP through', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('legacy')]);
    const source = path.join(dir, 'legacy.zip');
    const dest = path.join(dir, 'out.zip');
    await fs.writeFile(source, zip);

    const result = run([source, dest], {});

    expect(result.status).toBe(0);
    expect(await fs.readFile(dest)).toEqual(zip);
  });

  it('decrypts with a previous key after rotation', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rotated')]);
    const enc = path.join(dir, 'backup.zip');
    const dest = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));

    const result = run([enc, dest], {
      BACKUP_ENCRYPTION_KEY: OTHER_KEY,
      BACKUP_ENCRYPTION_PREVIOUS_KEYS: `${THIRD_KEY}, ${KEY}`,
    });

    expect(result.status).toBe(0);
    expect(await fs.readFile(dest)).toEqual(zip);
  });

  it('never treats SESSION_SECRET as a backup key', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('secret')]);
    const enc = path.join(dir, 'backup.zip');
    const dest = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));

    const result = run([enc, dest], {
      SESSION_SECRET: KEY,
      BACKUP_ENCRYPTION_KEY: OTHER_KEY,
    });

    expect(result.status).toBe(1);
    expect(String(result.stderr)).toMatch(/BACKUP_ENCRYPTION_KEY/);
    expect(String(result.stderr)).not.toMatch(/SESSION_SECRET as a backup key/i);
    await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exits non-zero for an unknown file', async () => {
    const source = path.join(dir, 'random.bin');
    await fs.writeFile(source, Buffer.from('not-a-backup'));

    const result = run([source], {});

    expect(result.status).toBe(1);
    expect(String(result.stderr)).toMatch(/not an encrypted Instance backup/);
  });

  it('writes ZIP bytes to stdout when dest is omitted', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('stdout')]);
    const source = path.join(dir, 'legacy.zip');
    await fs.writeFile(source, zip);

    const result = run([source], {}, null);

    expect(result.status).toBe(0);
    expect(result.stdout).toEqual(zip);
  });
});
