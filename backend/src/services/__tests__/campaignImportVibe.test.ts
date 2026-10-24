/**
 * An archive whose campaign.json vibe the shared schema cannot use still
 * creates the campaign: the illegal vibe is omitted with a warning, and the
 * new campaign gets the default periods. Omitting vibeSettings, or naming an
 * empty object (the JSON column default), is silent.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-import-vibe-'));
process.env.UPLOAD_DIR = path.join(SCRATCH, 'uploads');

import { importCampaign } from '../campaignImporter';
import { DEFAULT_VIBE_SETTINGS } from '../../utils/vibe-presets';
import { prisma, createTestUser, cleanupUsers } from '../../__tests__/helpers/db';
import { writeZip, type FixtureEntry } from '../../__tests__/helpers/zipFixtures';

const OMIT_WARNING = "The archive's vibe settings could not be used, so they were omitted.";

async function archive(campaign: Record<string, unknown>): Promise<string> {
  const file = path.join(SCRATCH, `${randomUUID()}.cozyvtt`);
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({
      formatVersion: 1, exportedAt: '2026-10-06T00:00:00.000Z', exportedFrom: 'CozyVTT v1.5.0', campaignName: 'Vibe import',
      gameSystem: 'DND_5E', mapCount: 0, tokenCount: 0, creatureCount: 0,
      tokenTemplateCount: 0, assetCount: 0, includesAudio: false, totalSizeBytes: 0,
    }),
    'campaign.json': JSON.stringify({ name: 'Vibe import', gameSystem: 'DND_5E', ...campaign }),
  };
  const entries: FixtureEntry[] = Object.entries(files).map(([name, data]) => ({ name, data }));
  await writeZip(file, entries);
  return file;
}

let userId: string;

beforeAll(async () => {
  userId = (await createTestUser({ displayName: 'Import Vibe' })).id;
});

afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { ownerId: userId } });
  await cleanupUsers([userId]);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

describe('an archive whose vibe a write would refuse', () => {
  it('creates the campaign with default vibe settings and warns that the archive vibe was omitted', async () => {
    const illegalName = 'N'.repeat(100);
    const result = await importCampaign(
      await archive({
        vibeSettings: {
          enabled: true,
          periods: [{ name: illegalName, hue: '#FF9966', filter: 'none', audio: null }],
        },
      }),
      userId,
    );

    expect(result.campaignId).toEqual(expect.any(String));
    expect(result.warnings).toEqual([OMIT_WARNING]);

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId } });
    expect(campaign.vibeSettings).toEqual(DEFAULT_VIBE_SETTINGS);
    const stored = campaign.vibeSettings as { periods: Array<{ name: string }> };
    expect(stored.periods.some((period) => period.name === illegalName)).toBe(false);
  });

  it('does not warn when the archive simply omitted vibeSettings', async () => {
    const result = await importCampaign(await archive({}), userId);

    expect(result.warnings).toEqual([]);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId } });
    expect(campaign.vibeSettings).toEqual(DEFAULT_VIBE_SETTINGS);
  });

  it('does not warn when the archive named an empty vibe object', async () => {
    const result = await importCampaign(await archive({ vibeSettings: {} }), userId);

    expect(result.campaignId).toEqual(expect.any(String));
    expect(result.warnings).toEqual([]);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: result.campaignId } });
    expect(campaign.vibeSettings).toEqual(DEFAULT_VIBE_SETTINGS);
  });
});
