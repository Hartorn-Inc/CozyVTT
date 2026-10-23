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

  it('writes no stdout when dest is omitted and the key is wrong', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('no-out')]);
    const enc = path.join(dir, 'backup.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));

    const result = run([enc], { BACKUP_ENCRYPTION_KEY: OTHER_KEY }, null);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toEqual(Buffer.alloc(0));
  });

  it('writes decrypted ZIP bytes to stdout for an encrypted archive', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('enc-stdout')]);
    const enc = path.join(dir, 'backup.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));

    const unlockTemps = async () =>
      (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith('cozyvtt-unlock-'));
    const before = new Set(await unlockTemps());
    const result = run([enc], { BACKUP_ENCRYPTION_KEY: KEY }, null);
    const after = new Set(await unlockTemps());

    expect(result.status).toBe(0);
    expect(result.stdout).toEqual(zip);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('does not create a cozyvtt-unlock- temp file when writing to stdout', async () => {
    expect(await fs.readFile(SCRIPT, 'utf8')).not.toMatch(/cozyvtt-unlock-/);

    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('no-tmp')]);
    const source = path.join(dir, 'legacy.zip');
    await fs.writeFile(source, zip);

    const unlockTemps = async () =>
      (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith('cozyvtt-unlock-'));
    const before = new Set(await unlockTemps());
    const result = run([source, '-'], {}, null);
    const after = new Set(await unlockTemps());

    expect(result.status).toBe(0);
    expect(result.stdout).toEqual(zip);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('leaves an existing destination unchanged on a second encrypted unlock', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('first')]);
    const enc = path.join(dir, 'backup.zip');
    const dest = path.join(dir, 'plain.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));
    expect(run([enc, dest], { BACKUP_ENCRYPTION_KEY: KEY }).status).toBe(0);

    const past = new Date(Date.now() - 60_000);
    await fs.utimes(dest, past, past);
    const before = await snapshot(dest);

    const result = run([enc, dest], { BACKUP_ENCRYPTION_KEY: KEY });

    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/already exists/i);
    await expectUnchanged(dest, before);
  });

  it('leaves an existing destination unchanged on a second legacy copy-through', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('legacy')]);
    const source = path.join(dir, 'legacy.zip');
    const dest = path.join(dir, 'out.zip');
    await fs.writeFile(source, zip);
    expect(run([source, dest], {}).status).toBe(0);

    const past = new Date(Date.now() - 60_000);
    await fs.utimes(dest, past, past);
    const before = await snapshot(dest);

    const result = run([source, dest], {});

    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toMatch(/already exists/i);
    await expectUnchanged(dest, before);
  });

  it('leaves the source archive unchanged when dest is the same path', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('same')]);
    const source = path.join(dir, 'legacy.zip');
    await fs.writeFile(source, zip);
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(source, past, past);
    const before = await snapshot(source);

    const sameString = run([source, source], {});
    expect(sameString.status).not.toBe(0);
    expect(String(sameString.stderr)).toMatch(/same path/i);
    await expectUnchanged(source, before);

    const viaResolve = run([source, path.join(dir, '.', 'legacy.zip')], {});
    expect(viaResolve.status).not.toBe(0);
    expect(String(viaResolve.stderr)).toMatch(/same path/i);
    await expectUnchanged(source, before);

    const relative = run(['legacy.zip', './legacy.zip'], {});
    expect(relative.status).not.toBe(0);
    expect(String(relative.stderr)).toMatch(/same path/i);
    await expectUnchanged(source, before);
  });

  it('leaves an existing dest that is the encrypted archive itself unchanged', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('enc-self')]);
    const enc = path.join(dir, 'backup.zip');
    await encryptBackupToFile(Readable.from(zip), enc, Buffer.from(KEY, 'hex'));
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(enc, past, past);
    const before = await snapshot(enc);

    const sameString = run([enc, enc], { BACKUP_ENCRYPTION_KEY: KEY });
    expect(sameString.status).not.toBe(0);
    expect(String(sameString.stderr)).toMatch(/same path/i);
    await expectUnchanged(enc, before);

    const viaResolve = run([enc, path.join(dir, '.', 'backup.zip')], { BACKUP_ENCRYPTION_KEY: KEY });
    expect(viaResolve.status).not.toBe(0);
    expect(String(viaResolve.stderr)).toMatch(/same path/i);
    await expectUnchanged(enc, before);
  });
});

async function snapshot(filePath: string) {
  const st = await fs.stat(filePath);
  return {
    bytes: await fs.readFile(filePath),
    mtimeMs: st.mtimeMs,
    ino: st.ino,
    size: st.size,
  };
}

async function expectUnchanged(filePath: string, before: Awaited<ReturnType<typeof snapshot>>) {
  const after = await snapshot(filePath);
  expect(after.bytes).toEqual(before.bytes);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.ino).toBe(before.ino);
  expect(after.size).toBe(before.size);
}
