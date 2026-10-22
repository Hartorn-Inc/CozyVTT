/**
 * Creating a character straight into a campaign — End-to-End Tests
 *
 * Which characters belong to a campaign is recorded in two places:
 * `Character.campaignId`, and the `characterIds` array on the player's
 * `CampaignMembership`. Almost everything the app shows a player reads the
 * second one — the campaign roster is built from it, and
 * `services/permissions.ts` decides whether a player may move a token by
 * asking whether the character is in it.
 *
 * `POST /api/characters/:id/assign` writes both. `POST /api/characters` used to
 * write only the column, so a character created with a campaign preselected
 * was in the campaign as far as the database was concerned and invisible
 * everywhere the player looked — absent from the roster, and its token
 * unmovable by its own owner. Re-assigning it to the same campaign was what
 * repaired it, because that path filled in the missing half.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

jest.setTimeout(30000);

const app = createTestApp();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function holdUntilReleased(
  lock: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const hasLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });

  const holder = prisma.$transaction(
    async (tx) => {
      await lock(tx);
      locked();
      await released;
    },
    { timeout: 15000 },
  );

  await hasLocked;
  return {
    release: async () => {
      release();
      await holder;
    },
  };
}

/**
 * Hold the Campaign row FOR UPDATE until release().
 * Models a concurrent join waiting on Campaign while kick runs without that lock.
 */
const holdCampaign = (campaignId: string) =>
  holdUntilReleased(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
  });

/**
 * Hold the player's CampaignMembership row FOR UPDATE until release().
 * Models a join that already holds the seat while kick waits on it.
 */
const holdMembership = (userId: string, campaignId: string) =>
  holdUntilReleased(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CampaignMembership" WHERE "userId" = ${userId} AND "campaignId" = ${campaignId} FOR UPDATE`;
  });

describe('creating a character with a campaign preselected', () => {
  let dmId: string;
  let playerId: string;
  let outsiderId: string;
  let campaignId: string;
  const extraCampaignIds: string[] = [];
  let dmAgent: ReturnType<typeof request.agent>;
  let playerAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;

  const signIn = async (email: string) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const dm = await createTestUser({ email: `cca_dm_${stamp}@test.invalid`, isApproved: true });
    const player = await createTestUser({ email: `cca_pl_${stamp}@test.invalid`, isApproved: true });
    const outsider = await createTestUser({ email: `cca_out_${stamp}@test.invalid`, isApproved: true });
    dmId = dm.id;
    playerId = player.id;
    outsiderId = outsider.id;

    const campaign = await createTestCampaign(dmId, { gameSystem: null });
    campaignId = campaign.id;

    await prisma.campaignMembership.createMany({
      data: [
        { userId: dmId, campaignId, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      ],
    });

    dmAgent = await signIn(`cca_dm_${stamp}@test.invalid`);
    playerAgent = await signIn(`cca_pl_${stamp}@test.invalid`);
    outsiderAgent = await signIn(`cca_out_${stamp}@test.invalid`);
  });

  afterAll(async () => {
    await cleanupCampaigns([campaignId, ...extraCampaignIds]);
    await cleanupUsers([dmId, playerId, outsiderId]);
    await prisma.$disconnect();
  });

  const membershipFor = (userId: string, ofCampaignId = campaignId) =>
    prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId, campaignId: ofCampaignId } },
    });

  const campaignForRace = async (name: string) => {
    const campaign = await createTestCampaign(dmId, { name, gameSystem: null });
    extraCampaignIds.push(campaign.id);
    await prisma.campaignMembership.createMany({
      data: [
        { userId: dmId, campaignId: campaign.id, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId: campaign.id, role: 'PLAYER', characterIds: [] },
      ],
    });
    return campaign.id;
  };

  const kickPlayer = (ofCampaignId: string, userId: string) =>
    dmAgent.delete(`/api/campaigns/${ofCampaignId}/members/${userId}`);

  it('records the campaign on the character', async () => {
    const res = await playerAgent
      .post('/api/characters')
      .send({ name: 'Column Only', campaignId })
      .expect(201);

    expect(res.body.character.campaignId).toBe(campaignId);
  });

  // The half that was missing. Everything a player sees reads this array.
  it('adds the character to the membership, so it is not invisible', async () => {
    const res = await playerAgent
      .post('/api/characters')
      .send({ name: 'Roster Visible', campaignId })
      .expect(201);

    const membership = await membershipFor(playerId);
    expect(membership?.characterIds).toContain(res.body.character.id);
  });

  it('shows the new character on the campaign roster straight away', async () => {
    const created = await playerAgent
      .post('/api/characters')
      .send({ name: 'Shows On Roster', campaignId })
      .expect(201);

    const roster = await playerAgent.get(`/api/campaigns/${campaignId}/characters`).expect(200);
    const names = roster.body.roster.flatMap(
      (m: { characters: { id: string; name: string }[] }) => m.characters.map((c) => c.name),
    );
    expect(names).toContain('Shows On Roster');
    expect(roster.body.roster.flatMap(
      (m: { characters: { id: string }[] }) => m.characters.map((c) => c.id),
    )).toContain(created.body.character.id);
  });

  it('keeps both characters on the membership when two are created into the campaign at once', async () => {
    const results = await Promise.all([
      playerAgent.post('/api/characters').send({ name: 'Concurrent A', campaignId }),
      playerAgent.post('/api/characters').send({ name: 'Concurrent B', campaignId }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const ids: string[] = results.map((r) => r.body.character.id);
    const membership = await membershipFor(playerId);
    expect(membership?.characterIds).toEqual(expect.arrayContaining(ids));
    expect(new Set(membership?.characterIds).size).toBe(membership?.characterIds.length);
    const stored = await prisma.character.findMany({ where: { id: { in: ids } }, select: { campaignId: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every((c) => c.campaignId === campaignId)).toBe(true);
  });

  it('does not add the character twice when created again', async () => {
    const before = await membershipFor(playerId);
    const res = await playerAgent
      .post('/api/characters')
      .send({ name: 'Once Only', campaignId })
      .expect(201);
    const after = await membershipFor(playerId);

    expect(after?.characterIds).toContain(res.body.character.id);
    expect(after?.characterIds.length).toBe((before?.characterIds.length ?? 0) + 1);
    // No duplicate ids in the array at all.
    expect(new Set(after?.characterIds).size).toBe(after?.characterIds.length);
  });

  // Matches POST /api/characters/:id/assign, which has always refused this.
  it('refuses a campaign the creator is not a member of', async () => {
    await outsiderAgent
      .post('/api/characters')
      .send({ name: 'Gatecrasher', campaignId })
      .expect(403);

    const characters = await prisma.character.findMany({ where: { userId: outsiderId } });
    expect(characters).toHaveLength(0);
  });

  it('still creates a character with no campaign at all', async () => {
    const res = await playerAgent
      .post('/api/characters')
      .send({ name: 'Unassigned' })
      .expect(201);

    expect(res.body.character.campaignId).toBeNull();
  });

  it('refuses create-in when a concurrent kick removes the player before the write', async () => {
    const raceCampaignId = await campaignForRace(`Kick race create-in ${Date.now()}`);

    const holder = await holdCampaign(raceCampaignId);
    const join = playerAgent.post('/api/characters').send({
      name: 'Kicked during create-in',
      campaignId: raceCampaignId,
    });
    await sleep(500);
    expect((await kickPlayer(raceCampaignId, playerId)).status).toBe(200);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toBe('You must be a member of the campaign to create a character in it');
    expect(
      await prisma.character.findFirst({ where: { userId: playerId, name: 'Kicked during create-in' } }),
    ).toBeNull();
    expect(await membershipFor(playerId, raceCampaignId)).toBeNull();
    expect(
      await prisma.character.findMany({
        where: { userId: playerId, campaignId: raceCampaignId },
        select: { id: true },
      }),
    ).toEqual([]);
  });

  it('refuses assign when a concurrent kick removes the player before the write', async () => {
    const raceCampaignId = await campaignForRace(`Kick race assign ${Date.now()}`);
    const created = await playerAgent.post('/api/characters').send({ name: 'Kicked during assign' }).expect(201);
    const characterId: string = created.body.character.id;

    const holder = await holdCampaign(raceCampaignId);
    const join = playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: raceCampaignId });
    await sleep(500);
    expect((await kickPlayer(raceCampaignId, playerId)).status).toBe(200);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toBe('You must be a member of the campaign to assign a character to it');
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
    expect(await membershipFor(playerId, raceCampaignId)).toBeNull();
    expect(
      await prisma.character.findMany({
        where: { userId: playerId, campaignId: raceCampaignId },
        select: { id: true },
      }),
    ).toEqual([]);
  });

  it('assigns an unassigned character to exactly one of two campaigns raced together', async () => {
    const campaignA = await campaignForRace(`Assign race A ${Date.now()}`);
    const campaignB = await campaignForRace(`Assign race B ${Date.now()}`);
    const created = await playerAgent.post('/api/characters').send({ name: 'Raced assign' }).expect(201);
    const characterId: string = created.body.character.id;

    const results = await Promise.all([
      playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: campaignA }),
      playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: campaignB }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);

    const stored = await prisma.character.findUnique({ where: { id: characterId } });
    expect([campaignA, campaignB]).toContain(stored?.campaignId);
    const winnerId = stored?.campaignId === campaignA ? campaignA : campaignB;
    const loserId = winnerId === campaignA ? campaignB : campaignA;

    const winnerMembership = await membershipFor(playerId, winnerId);
    const loserMembership = await membershipFor(playerId, loserId);
    expect(winnerMembership?.characterIds.filter((id) => id === characterId)).toEqual([characterId]);
    expect(loserMembership?.characterIds).not.toContain(characterId);
  });

  it('clears a Character written while kick waited on the membership lock', async () => {
    const raceCampaignId = await campaignForRace(`Kick race membership hold ${Date.now()}`);

    const holder = await holdMembership(playerId, raceCampaignId);
    const kick = kickPlayer(raceCampaignId, playerId);
    await sleep(500);
    const character = await prisma.character.create({
      data: {
        userId: playerId,
        campaignId: raceCampaignId,
        name: 'Inserted while kick waits',
        data: {},
      },
    });
    await holder.release();
    const res = await kick;

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: character.id } }))?.campaignId).toBeNull();
    expect(await membershipFor(playerId, raceCampaignId)).toBeNull();
  });

  it('keeps campaignId and membership characterIds in agreement when assign and unassign race', async () => {
    const campaignA = await campaignForRace(`Assign vs unassign A ${Date.now()}`);
    const campaignB = await campaignForRace(`Assign vs unassign B ${Date.now()}`);
    const created = await playerAgent
      .post('/api/characters')
      .send({ name: 'Assign vs unassign', campaignId: campaignA })
      .expect(201);
    const characterId: string = created.body.character.id;

    const results = await Promise.all([
      playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: campaignB }),
      playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: null }),
    ]);
    expect(results.map((r) => r.status).every((status) => status !== 500)).toBe(true);
    expect(results.map((r) => r.status)).toEqual([200, 200]);

    const stored = await prisma.character.findUnique({ where: { id: characterId } });
    expect([campaignB, null]).toContain(stored?.campaignId);
    const membershipA = await membershipFor(playerId, campaignA);
    const membershipB = await membershipFor(playerId, campaignB);
    if (stored?.campaignId === campaignB) {
      expect(membershipB?.characterIds.filter((id) => id === characterId)).toEqual([characterId]);
      expect(membershipA?.characterIds).not.toContain(characterId);
    } else {
      expect(membershipA?.characterIds).not.toContain(characterId);
      expect(membershipB?.characterIds).not.toContain(characterId);
    }
  });

  it('does not clobber a concurrent create-in on the previous campaign when reassigning', async () => {
    const campaignA = await campaignForRace(`Reassign vs create-in A ${Date.now()}`);
    const campaignB = await campaignForRace(`Reassign vs create-in B ${Date.now()}`);
    const created = await playerAgent
      .post('/api/characters')
      .send({ name: 'Moved during create-in', campaignId: campaignA })
      .expect(201);
    const characterId: string = created.body.character.id;

    const [assignRes, createRes] = await Promise.all([
      playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: campaignB }),
      playerAgent.post('/api/characters').send({ name: 'Created during reassign', campaignId: campaignA }),
    ]);
    expect([assignRes.status, createRes.status]).toEqual([200, 201]);

    const createdId: string = createRes.body.character.id;
    const createdStored = await prisma.character.findUnique({ where: { id: createdId } });
    expect(createdStored?.campaignId).toBe(campaignA);
    const membershipA = await membershipFor(playerId, campaignA);
    expect(membershipA?.characterIds).toContain(createdId);

    const moved = await prisma.character.findUnique({ where: { id: characterId } });
    if (assignRes.status === 200) {
      expect(moved?.campaignId).toBe(campaignB);
      const membershipB = await membershipFor(playerId, campaignB);
      expect(membershipB?.characterIds.filter((id) => id === characterId)).toEqual([characterId]);
      expect(membershipA?.characterIds).not.toContain(characterId);
    }
  });

  it('does not deadlock when assign-away races a kick of the previous campaign', async () => {
    const campaignA = await campaignForRace(`Assign vs kick A ${Date.now()}`);
    const campaignB = await campaignForRace(`Assign vs kick B ${Date.now()}`);
    const created = await playerAgent
      .post('/api/characters')
      .send({ name: 'Assign vs kick', campaignId: campaignA })
      .expect(201);
    const characterId: string = created.body.character.id;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const results = await Promise.race([
        Promise.all([
          playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId: campaignB }),
          kickPlayer(campaignA, playerId),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('assign vs kick of previous did not finish in 15s (possible deadlock)')),
            15000,
          );
        }),
      ]);
      expect(results.map((r) => r.status).every((status) => status !== 500)).toBe(true);

      const stored = await prisma.character.findUnique({ where: { id: characterId } });
      expect(stored?.campaignId).not.toBe(campaignA);
      expect([campaignB, null]).toContain(stored?.campaignId);
      expect(await membershipFor(playerId, campaignA)).toBeNull();
      const membershipB = await membershipFor(playerId, campaignB);
      if (stored?.campaignId === campaignB) {
        expect(membershipB?.characterIds.filter((id) => id === characterId)).toEqual([characterId]);
      } else {
        expect(membershipB?.characterIds).not.toContain(characterId);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
});
