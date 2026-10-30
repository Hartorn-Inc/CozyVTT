import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-admin-backup-test-'));
const BACKUP_DIR = path.join(SCRATCH, 'backups');
const UPLOAD_DIR = path.join(SCRATCH, 'uploads');
process.env.BACKUP_DIR = BACKUP_DIR;
process.env.UPLOAD_DIR = UPLOAD_DIR;

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn(),
}));

import { execFile } from 'child_process';
import request from 'supertest';
import { PlatformRole } from '@prisma/client';
import unzipper from 'unzipper';
import { ZipArchive } from 'archiver';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import * as systemLog from '../../services/systemLog';
import { decryptBackupFile } from '../../utils/backupEncryption';

const app = createTestApp();
const execFileMock = execFile as unknown as jest.Mock;
const MIGRATE = 'node_modules/.bin/prisma';

let adminId: string;
let admin: ReturnType<typeof request.agent>;

const DUMP = [
  '\\restrict unguessable',
  'DROP SCHEMA public CASCADE;',
  'CREATE SCHEMA public;',
  'CREATE TABLE public."User" (id text PRIMARY KEY);',
  "COMMENT ON TABLE public.\"User\" IS 'instance user';",
  'CREATE TABLE public."Note" (id text PRIMARY KEY);',
].join('\n') + '\n';

async function backupZip(entries: Record<string, string>): Promise<Buffer> {
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

beforeAll(async () => {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const user = await createTestUser({ role: PlatformRole.ADMIN, displayName: 'Admin Backup Test' });
  adminId = user.id;
  admin = request.agent(app);
  expect((await admin.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterEach(() => {
  jest.restoreAllMocks();
  execFileMock.mockReset();
});

afterAll(async () => {
  try {
    await cleanupUsers([adminId]);
  } finally {
    await prisma.$disconnect();
    await fs.rm(SCRATCH, { recursive: true, force: true });
  }
});

describe('writeBackupZip directory exclusion', () => {
  it('excludes the backups directory entry and any contents under backups/', async () => {
    const backupSubdir = path.join(UPLOAD_DIR, 'backups');
    const nestedFile = path.join(backupSubdir, 'legacy-backup.zip');
    const normalDir = path.join(UPLOAD_DIR, 'avatars');
    const normalFile = path.join(normalDir, 'avatar1.png');

    await fs.mkdir(backupSubdir, { recursive: true });
    await fs.writeFile(nestedFile, 'dummy-backup-data');
    await fs.mkdir(normalDir, { recursive: true });
    await fs.writeFile(normalFile, 'png-image-data');

    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const done = rest[rest.length - 1] as (err: Error | null) => void;
      const fileFlag = args.indexOf('--file');
      const file = fileFlag >= 0 ? args[fileFlag + 1] : undefined;
      if (cmd === 'pg_dump' && file) {
        fs.writeFile(file, 'SELECT 1;\n').then(() => done(null), done);
      } else {
        done(null);
      }
    });

    const res = await admin.post('/api/admin/backups');
    expect(res.status).toBe(201);
    expect(res.body.filename).toBeDefined();

    const encryptedZipPath = path.join(BACKUP_DIR, res.body.filename);
    const decryptedZipPath = path.join(SCRATCH, `decrypted-${Date.now()}.zip`);
    await decryptBackupFile(encryptedZipPath, decryptedZipPath);

    const directory = await unzipper.Open.file(decryptedZipPath);
    const entryPaths = directory.files.map((f) => f.path);

    expect(entryPaths).toContain('database.sql');
    expect(entryPaths).toContain('uploads/avatars/avatar1.png');
    expect(entryPaths).not.toContain('uploads/backups');
    expect(entryPaths).not.toContain('uploads/backups/');
    for (const p of entryPaths) {
      expect(p.startsWith('uploads/backups/')).toBe(false);
      expect(p).not.toBe('uploads/backups');
    }
  });
});

describe('POST /api/admin/backups/restore migration failure audit log', () => {
  it('calls writeAdminLog with failure details when post-restore migrations fail', async () => {
    const writeAdminLogSpy = jest.spyOn(systemLog, 'writeAdminLog');

    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const done = rest[rest.length - 1] as (err: Error | null, out?: { stdout: string; stderr: string }) => void;
      const fileFlag = args.indexOf('--file');
      const file = fileFlag >= 0 ? args[fileFlag + 1] : undefined;
      if (cmd === 'pg_dump' && file) {
        fs.writeFile(file, DUMP).then(() => done(null), done);
      } else if (cmd === 'psql') {
        done(null, { stdout: '', stderr: '' });
      } else if (cmd === MIGRATE) {
        done(Object.assign(new Error('Prisma migrate failed with code P3000'), {
          code: 1,
          stderr: 'P3000: Database migration failed to apply',
        }));
      } else {
        done(null, { stdout: '', stderr: '' });
      }
    });

    const zip = await backupZip({ 'database.sql': DUMP });
    const res = await admin
      .post('/api/admin/backups/restore')
      .attach('backup', zip, 'backup.zip');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Restore Incomplete');
    expect(res.body.message).toMatch(/bringing its database up to this version failed/);

    expect(writeAdminLogSpy).toHaveBeenCalled();
    const call = writeAdminLogSpy.mock.calls[0];
    expect(call[0]).toBe(adminId);
    expect(call[1]).toMatch(/Restored instance from backup/);
    expect(call[2]).toBe('WARNING');
    expect(call[3]).toMatchObject({
      safetyBackup: expect.stringMatching(/^backup-.*\.zip$/),
      error: expect.stringContaining('P3000'),
      migrationError: expect.stringContaining('P3000'),
    });
  });
});
