// ============================================
// Chat handler: chat.message
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import logger from '../../utils/logger';
import { chatMessageLimiter, withinCeiling } from '../shared';
import { confirmWriteAuthorization } from '../writeAuthz';

export function registerChatHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * CHAT.MESSAGE - User sends chat message.
   * Validates content, saves to database, and broadcasts to campaign.
   * The message type comes from the sender's role, never from the payload.
   * Always under the per-user flood ceiling; the campaign's chat cooldown,
   * when the DM turns it on, is the stricter rule on top.
   * SECURITY: campaign comes from the socket, never the payload; the write
   * re-reads membership at commit and uses that role for the message type.
   */
  socket.on('chat.message', async (data: { content: string; type?: 'PLAYER' | 'DM' }) => {
    try {
      if (!socket.campaignId) {
        socket.emit('error', { message: 'Not authenticated to a campaign' });
        return;
      }
      const campaignId = socket.campaignId;

      if (!withinCeiling(socket, 'chat.message')) return;

      const { content } = data;

      // Validate content is provided
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        socket.emit('error', { message: 'Message content required' });
        return;
      }

      // Validate message length (max 2000 characters)
      if (content.length > 2000) {
        socket.emit('error', { message: 'Message too long. Maximum 2000 characters.' });
        return;
      }

      // Validate the message type's shape, when one is given
      if (data.type !== undefined && data.type !== 'PLAYER' && data.type !== 'DM') {
        socket.emit('error', { message: 'Invalid message type. Must be PLAYER or DM.' });
        return;
      }

      // Rate limiting: respect campaign's chatCooldown settings
      const campaignSettings = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { chatCooldownEnabled: true, chatCooldownSeconds: true },
      });

      if (campaignSettings?.chatCooldownEnabled) {
        const windowMs = (campaignSettings.chatCooldownSeconds ?? 5) * 1000;
        if (!chatMessageLimiter.check(`${socket.userId}:${campaignId}`, 1, windowMs)) {
          socket.emit('error', { message: `Rate limit: wait ${campaignSettings.chatCooldownSeconds}s between messages.` });
          return;
        }
      }

      // Get user information
      const user = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { displayName: true },
      });

      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      const authz = await confirmWriteAuthorization(socket, { campaignId });
      if (!authz.ok) return;
      // The type is decided by the sender's role at commit, not by the
      // payload: a player's message is always PLAYER. The DM's is DM unless
      // they ask to speak as a player (out of character).
      const committedType: 'PLAYER' | 'DM' = authz.role === 'DM' ? (data.type ?? 'DM') : 'PLAYER';

      // Save to database
      const message = await prisma.message.create({
        data: {
          campaignId,
          userId: socket.userId!,
          type: committedType,
          content: content.trim(),
          // metadata is optional for chat messages
        },
      });

      // Broadcast to all campaign members (including sender)
      io.to(campaignId).emit('chat.message', {
        id: message.id,
        userId: socket.userId,
        userName: user.displayName,
        content: content.trim(),
        type: committedType,
        timestamp: message.createdAt.toISOString(),
      });

      logger.debug('chat.message', { type: committedType, userId: socket.userId, campaignId });
    } catch (error) {
      logger.error('chat.message failed', { err: error });
      socket.emit('error', { message: 'Failed to send chat message' });
    }
  });
}
