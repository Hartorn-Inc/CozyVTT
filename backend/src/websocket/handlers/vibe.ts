// ============================================
// Vibe tracker handler: vibe.update
// ============================================

import { z } from 'zod';
import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import { findVibePeriod, normalizeVibeSettings } from '../../utils/vibe-presets';
import { vibePeriodAudioAssetId } from '../../utils/vibeAudio';
import { lastAmbientVolume, setCampaignAmbientAudio } from '../../services/atmosphereAudio';
import { sendSystemMessage } from '../utils';
import { withinCeiling } from '../shared';
import logger from '../../utils/logger';
import { confirmWriteAuthorization } from '../writeAuthz';

/**
 * Incoming switch payload. Only `period` is read: extra keys (including a
 * client `vibeSettings` object) are stripped and never written. No max length
 * — a grandfathered stored name can be longer than the write schema allows.
 */
const VibeUpdatePayloadSchema = z.object({
  period: z.string({ error: 'period (string) is required' }).min(1, { error: 'period (string) is required' }),
}).strip();

export function registerVibeHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * VIBE.UPDATE - DM changes the current vibe period and its audio follows.
   * Updates campaign.currentVibe, broadcasts period data to all members, and
   * sets the period's track as the table's ambient audio (none means silence).
   * Reads `{ period }` against stored settings; extra payload keys are ignored
   * and this event does not write vibeSettings.
   */
  socket.on('vibe.update', async (data: unknown) => {
    try {
      if (!socket.campaignId || !socket.userId) {
        socket.emit('error', { message: 'Not authenticated to a campaign' });
        return;
      }
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'vibe.update')) return;

      // DM only
      if (socket.role !== 'DM') {
        socket.emit('error', { message: 'Only the DM can change the vibe' });
        return;
      }

      const parsed = VibeUpdatePayloadSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: parsed.error.issues[0]?.message ?? 'period (string) is required' });
        return;
      }
      const { period } = parsed.data;

      // Fetch campaign vibe settings
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { vibeSettings: true, currentVibe: true },
      });

      if (!campaign) {
        socket.emit('error', { message: 'Campaign not found' });
        return;
      }

      // Convert only the legacy string[] periods + hues shape. A stored
      // object-period blob is used as-is, including names the write schema
      // would refuse, so a grandfathered period can still be switched to.
      const vibeSettings = normalizeVibeSettings(campaign.vibeSettings);

      // Check if vibe tracker is enabled
      if (!vibeSettings.enabled) {
        socket.emit('error', { message: 'Vibe tracker is not enabled for this campaign' });
        return;
      }

      // Find the requested period in settings
      const vibePeriod = findVibePeriod(vibeSettings, period);

      if (!vibePeriod) {
        const availablePeriods = vibeSettings.periods.map((p: { name: string }) => p.name).join(', ');
        socket.emit('error', {
          message: `Unknown vibe period '${period}'. Available: ${availablePeriods}`,
        });
        return;
      }

      const authz = await confirmWriteAuthorization(socket, { campaignId });
      if (!authz.ok) return;
      if (authz.role !== 'DM') {
        socket.emit('error', { message: 'Only the DM can change the vibe' });
        return;
      }

      // Update campaign currentVibe
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { currentVibe: vibePeriod.name },
      });

      // Broadcast to all campaign members (including sender for confirmation)
      io.to(campaignId).emit('vibe.updated', {
        period: vibePeriod.name,
        hue: vibePeriod.hue,
        filter: vibePeriod.filter,
        audio: vibePeriod.audio,
        updatedBy: socket.userId,
        timestamp: new Date().toISOString(),
      });

      // The vibe owns the soundtrack: a period with a track starts it for
      // the table, one without silences it. Older settings carried free-text
      // notes in this field; those count as no track. A dead or forbidden id
      // silences the table and tells the DM, but never blocks the switch.
      const requestedAudio = vibePeriodAudioAssetId(vibePeriod.audio);
      const volume = await lastAmbientVolume(campaignId);
      const audioResult = await setCampaignAmbientAudio(io, campaignId, socket.userId, requestedAudio, { volume });
      if (!audioResult.ok) {
        await setCampaignAmbientAudio(io, campaignId, socket.userId, null, { volume });
        socket.emit('error', {
          message: `The "${vibePeriod.name}" period's audio track is unavailable, so the vibe changed without audio`,
        });
      }

      // Send system message
      const periodDisplayName = vibePeriod.name.charAt(0).toUpperCase() + vibePeriod.name.slice(1);
      await sendSystemMessage(
        campaignId,
        `Time advances to ${periodDisplayName}.`,
        { userId: socket.userId, action: 'vibe.update', period: vibePeriod.name }
      );

      logger.info('vibe.update', { period: vibePeriod.name, userId: socket.userId, campaignId });
    } catch (error) {
      logger.error('vibe.update failed', { err: error });
      socket.emit('error', { message: 'Failed to update vibe' });
    }
  });
}
