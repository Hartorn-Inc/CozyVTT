// ============================================
// Assign Character Modal
// Assign or reassign character to a campaign
// ============================================

import { useState, useEffect } from 'react';
import { Loader2, Link2, AlertCircle } from 'lucide-react';
import type { CharacterSummary, Campaign } from '@/types';
import api from '@/services/api';
import GameSystemBadge from '@/components/common/GameSystemBadge';
import { Button, Modal } from '@/components/ui';
import { getGameSystemLabel } from '@/constants/game-systems';
import { apiErrorMessage } from '@/utils/errors';
import { systemsCompatible } from '@/utils/gameSystemCompatibility';

interface AssignCharacterModalProps {
  isOpen: boolean;
  character: CharacterSummary | null;
  currentCampaign?: Campaign | null;
  onClose: () => void;
  onConfirm: (characterId: string, campaignId: string | null) => Promise<void>;
}

/** Unassign when there is no current Campaign, or when that Campaign is a mismatch. */
function defaultCampaignId(
  character: CharacterSummary | null,
  currentCampaign: Campaign | null | undefined
): string | null {
  if (!character || !currentCampaign) return null;
  if (!systemsCompatible(character.gameSystem, currentCampaign.gameSystem)) return null;
  return currentCampaign.id;
}

export default function AssignCharacterModal({
  isOpen,
  character,
  currentCampaign,
  onClose,
  onConfirm,
}: AssignCharacterModalProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    defaultCampaignId(character, currentCampaign)
  );
  const [loading, setLoading] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState('');

  // Fetch campaigns when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCampaigns();
      setSelectedCampaignId(defaultCampaignId(character, currentCampaign));
    }
  }, [isOpen, currentCampaign, character]);

  const fetchCampaigns = async () => {
    setLoadingCampaigns(true);
    setError('');

    try {
      const response = await api.listCampaigns();
      setCampaigns(response.campaigns);
    } catch (err) {
      setError(apiErrorMessage(err) || 'Failed to load campaigns');
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const handleConfirm = async () => {
    if (!character) return;

    setError('');
    setLoading(true);

    try {
      await onConfirm(character.id, selectedCampaignId);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err) || 'Failed to assign character');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError('');
      setSelectedCampaignId(defaultCampaignId(character, currentCampaign));
      onClose();
    }
  };

  if (!character) return null;

  // Filter compatible campaigns — ADR 0015:
  // typed Character → same-system Campaigns AND Campaigns with no game system
  // Flexible sheet → only Campaigns with no game system
  const compatibleCampaigns = campaigns.filter((campaign) => systemsCompatible(character.gameSystem, campaign.gameSystem));

  // Check if selected campaign is compatible
  const selectedCampaign = compatibleCampaigns.find((c) => c.id === selectedCampaignId);
  const hasIncompatibleSelection = selectedCampaignId && !selectedCampaign;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={currentCampaign ? 'Reassign Character' : 'Assign to Campaign'}
      icon={Link2}
      closeDisabled={loading}
    >
      {/* Error Alert */}
      {error && (
        <div role="alert" className="mb-4 bg-danger/10 border border-danger/30 rounded-lg p-4">
          <p className="text-sm text-danger font-medium">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="space-y-4">
                {/* Character Info */}
                <div className="glass-panel p-4">
                  <h3 className="font-semibold text-brand-ink mb-2">Character</h3>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-moss-green/10 border-2 border-moss-green/30
                                  flex items-center justify-center overflow-hidden flex-shrink-0">
                      {character.tokenImageUrl ? (
                        <img
                          src={character.tokenImageUrl}
                          alt={character.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-lg font-bold text-brand-ink">
                          {character.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-stone-gray truncate">{character.name}</p>
                      <GameSystemBadge gameSystem={character.gameSystem} size="sm" />
                    </div>
                  </div>
                </div>

                {/* Current Assignment */}
                {currentCampaign && (
                  <div className="bg-spirit-purple/10 border border-spirit-purple/30 rounded-lg p-4">
                    <p className="text-sm text-stone-gray">
                      <strong className="text-spirit-purple">Currently assigned to:</strong>{' '}
                      {currentCampaign.name}
                    </p>
                  </div>
                )}

                {/* Campaign Selection */}
                <div>
                  <label
                    htmlFor="campaign"
                    className="block text-sm font-semibold text-ink mb-2"
                  >
                    Select Campaign
                  </label>

                  {loadingCampaigns ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 text-brand-ink animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {/* Unassign: always when already in a Campaign, or when any compatible join target exists */}
                      {(currentCampaign || compatibleCampaigns.length > 0) && (
                        <label
                          className={`flex items-start p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            selectedCampaignId === null
                              ? 'border-moss-green bg-moss-green/5'
                              : 'border-ink/10 hover:border-moss-green/50'
                          } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="campaign"
                            value=""
                            checked={selectedCampaignId === null}
                            onChange={() => setSelectedCampaignId(null)}
                            disabled={loading}
                            className="mt-1 mr-3"
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-ink">
                              Unassigned
                            </div>
                            <p className="text-sm text-ink-muted mt-1">
                              Remove character from any campaign
                            </p>
                          </div>
                        </label>
                      )}

                      {compatibleCampaigns.length === 0 ? (
                        <div className="bg-warm-amber/10 border border-warm-amber/30 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-warm-amber flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm text-stone-gray">
                                {currentCampaign
                                  ? character.gameSystem
                                    ? 'No compatible Campaigns found. You can unassign this Character now. Creating a Campaign with the same Game system as this Character, or a Campaign with no game system, is optional.'
                                    : 'No compatible Campaigns found. You can unassign this Character now. A Flexible sheet can only join a Campaign with no game system — creating one is optional.'
                                  : character.gameSystem
                                    ? 'No compatible Campaigns found. Create a Campaign with the same Game system as this Character, or a Campaign with no game system.'
                                    : 'No compatible Campaigns found. A Flexible sheet can only join a Campaign with no game system.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        compatibleCampaigns.map((campaign) => (
                          <label
                            key={campaign.id}
                            className={`flex items-start p-4 rounded-lg border-2 cursor-pointer transition-all ${
                              selectedCampaignId === campaign.id
                                ? 'border-moss-green bg-moss-green/5'
                                : 'border-ink/10 hover:border-moss-green/50'
                            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <input
                              type="radio"
                              name="campaign"
                              value={campaign.id}
                              checked={selectedCampaignId === campaign.id}
                              onChange={() => setSelectedCampaignId(campaign.id)}
                              disabled={loading}
                              className="mt-1 mr-3"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-ink truncate">
                                  {campaign.name}
                                </span>
                                <GameSystemBadge gameSystem={campaign.gameSystem} size="sm" />
                              </div>
                              {campaign.description && (
                                <p className="text-sm text-ink-muted line-clamp-2">
                                  {campaign.description}
                                </p>
                              )}
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Game System Compatibility Info */}
                <div className="bg-moss-green/10 border border-moss-green/30 rounded-lg p-3">
                  <p className="text-xs text-stone-gray">
                    <strong className="text-brand-ink">Note:</strong>{' '}
                    {character.gameSystem
                      ? `Only showing Campaigns that use ${getGameSystemLabel(character.gameSystem, true)}. Campaigns with no game system are included.`
                      : 'A Flexible sheet can only join a Campaign with no game system.'}
                  </p>
                </div>
              </div>

      {/* Actions */}
      <div className="flex gap-3 pt-6">
        <Button
          type="button"
          onClick={handleClose}
          disabled={loading}
          variant="secondary"
          className="flex-1"
        >
          Cancel
        </Button>

        <Button
          type="button"
          onClick={handleConfirm}
          disabled={loadingCampaigns || !!hasIncompatibleSelection}
          loading={loading}
          icon={Link2}
          className="flex-1"
        >
          {loading
            ? 'Assigning...'
            : selectedCampaignId === null
              ? 'Unassign'
              : 'Assign to Campaign'}
        </Button>
      </div>
    </Modal>
  );
}
