import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { canEditCharacter } from '../permissions';
import { prisma } from '../../config/database';

jest.mock('../../config/database', () => ({
  prisma: {
    character: {
      findUnique: jest.fn(),
    },
    campaignMembership: {
      findUnique: jest.fn(),
    },
  },
}));

interface MembershipFindUniqueArgs {
  where: {
    userId_campaignId: {
      userId: string;
      campaignId: string;
    };
  };
}

type MockFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockPrisma = prisma as unknown as {
  character: { findUnique: MockFn };
  campaignMembership: { findUnique: MockFn };
};

describe('canEditCharacter permission helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns not allowed if character does not exist', async () => {
    mockPrisma.character.findUnique.mockResolvedValue(null);

    const result = await canEditCharacter('user-1', 'char-404');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NOT_FOUND');
  });

  it('strictly denies spectators even if they own the character', async () => {
    const character = {
      id: 'char-1',
      userId: 'user-1',
      campaignId: 'camp-1',
    };
    mockPrisma.character.findUnique.mockResolvedValue(character);
    mockPrisma.campaignMembership.findUnique.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as MembershipFindUniqueArgs;
      if (args.where.userId_campaignId.userId === 'user-1') {
        return { role: 'SPECTATOR' };
      }
      return null;
    });

    const result = await canEditCharacter('user-1', character);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SPECTATOR');
  });

  it('allows character owner if not a spectator in the campaign', async () => {
    const character = {
      id: 'char-1',
      userId: 'user-1',
      campaignId: 'camp-1',
    };
    mockPrisma.character.findUnique.mockResolvedValue(character);
    mockPrisma.campaignMembership.findUnique.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as MembershipFindUniqueArgs;
      if (args.where.userId_campaignId.userId === 'user-1') {
        return { role: 'PLAYER' };
      }
      return null;
    });

    const result = await canEditCharacter('user-1', character);
    expect(result.allowed).toBe(true);
    expect(result.isDM).toBe(false);
  });

  it('allows character owner when character has no campaignId', async () => {
    const character = {
      id: 'char-1',
      userId: 'user-1',
      campaignId: null,
    };

    const result = await canEditCharacter('user-1', character);
    expect(result.allowed).toBe(true);
    expect(result.isDM).toBe(false);
    expect(mockPrisma.campaignMembership.findUnique).not.toHaveBeenCalled();
  });

  it('allows campaign DM when the character owner is still an active member', async () => {
    const character = {
      id: 'char-1',
      userId: 'player-1',
      campaignId: 'camp-1',
    };
    mockPrisma.campaignMembership.findUnique.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as MembershipFindUniqueArgs;
      const { userId, campaignId } = args.where.userId_campaignId;
      if (campaignId === 'camp-1' && userId === 'dm-1') {
        return { role: 'DM' };
      }
      if (campaignId === 'camp-1' && userId === 'player-1') {
        return { role: 'PLAYER' };
      }
      return null;
    });

    const result = await canEditCharacter('dm-1', character);
    expect(result.allowed).toBe(true);
    expect(result.isDM).toBe(true);
  });

  it('denies campaign DM if the character owner has left the campaign', async () => {
    const character = {
      id: 'char-1',
      userId: 'player-1',
      campaignId: 'camp-1',
    };
    mockPrisma.campaignMembership.findUnique.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as MembershipFindUniqueArgs;
      const { userId, campaignId } = args.where.userId_campaignId;
      if (campaignId === 'camp-1' && userId === 'dm-1') {
        return { role: 'DM' };
      }
      if (campaignId === 'camp-1' && userId === 'player-1') {
        return null; // Owner left
      }
      return null;
    });

    const result = await canEditCharacter('dm-1', character);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('FORBIDDEN');
  });

  it('denies non-campaign-members and unrelated players', async () => {
    const character = {
      id: 'char-1',
      userId: 'player-1',
      campaignId: 'camp-1',
    };
    mockPrisma.campaignMembership.findUnique.mockImplementation(async (rawArgs: unknown) => {
      const args = rawArgs as MembershipFindUniqueArgs;
      const { userId } = args.where.userId_campaignId;
      if (userId === 'stranger') return null;
      if (userId === 'other-player') return { role: 'PLAYER' };
      return null;
    });

    const resStranger = await canEditCharacter('stranger', character);
    expect(resStranger.allowed).toBe(false);
    expect(resStranger.reason).toBe('FORBIDDEN');

    const resOtherPlayer = await canEditCharacter('other-player', character);
    expect(resOtherPlayer.allowed).toBe(false);
    expect(resOtherPlayer.reason).toBe('FORBIDDEN');
  });
});
