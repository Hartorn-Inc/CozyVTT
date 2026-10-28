/**
 * New Character Modal
 * Modal dialog for creating a new character with game system templates
 */

import { useState, FormEvent, useEffect, useRef } from 'react';
import { Loader2, User, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui';
import { Character, GameSystem, Campaign } from '@/types';
import {
  GAME_SYSTEM_LABELS,
  GAME_SYSTEM_OPTIONS,
  getGameSystemLabel,
  isChoosableGameSystem,
} from '@/constants/game-systems';
import api from '@/services/api';
import Button from '@/components/ui/Button';
import { apiErrorMessage, apiValidationIssues, errorMessage } from '@/utils/errors';
import { systemsCompatible } from '@/utils/gameSystemCompatibility';

interface NewCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (character: Character) => void;
  /** If provided, character will be assigned to this campaign */
  campaign?: Campaign;
  /** If provided, this game system will be pre-selected and locked */
  preselectedGameSystem?: GameSystem | null;
}

interface TemplateOption {
  value: string;
  label: string;
  description: string;
}

const TEMPLATE_OPTIONS_BY_SYSTEM: Record<string, TemplateOption[]> = {
  [GameSystem.DND_5E]: [
    {
      value: 'blank',
      label: 'Blank Character Sheet',
      description: 'Start with an empty Level 1 character',
    },
    {
      value: 'fighter',
      label: 'Level 1 Fighter (Example)',
      description: 'A pre-built Fighter with standard array stats',
    },
  ],
  [GameSystem.PATHFINDER_2E]: [
    {
      value: 'blank',
      label: 'Blank Character Sheet',
      description: 'Start with an empty Level 1 character',
    },
    {
      value: 'fighter',
      label: 'Level 1 Fighter (Example)',
      description: 'A pre-built Dwarf Fighter',
    },
  ],
  [GameSystem.SHADOWRUN_6E]: [
    {
      value: 'blank',
      label: 'Blank Character Sheet',
      description: 'Start with an empty character',
    },
    {
      value: 'streetsamurai',
      label: 'Street Samurai (Example)',
      description: 'A combat-focused runner with cyberware',
    },
  ],
  [GameSystem.CALL_OF_CTHULHU_7E]: [
    {
      value: 'blank',
      label: 'Blank Investigator Sheet',
      description: 'Start with an empty investigator',
    },
    {
      value: 'privateinvestigator',
      label: 'Private Investigator (Example)',
      description: 'A gritty private eye ready for mysteries',
    },
  ],
};

export default function NewCharacterModal({
  isOpen,
  onClose,
  onSuccess,
  campaign,
  preselectedGameSystem,
}: NewCharacterModalProps) {
  const [name, setName] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    campaign?.id || null
  );
  const [gameSystem, setGameSystem] = useState<GameSystem | null>(
    preselectedGameSystem || campaign?.gameSystem || null
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank');
  const [availableCampaigns, setAvailableCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState('');
  const [campaignResetStatus, setCampaignResetStatus] = useState('');

  // Fetch user's campaigns when modal opens
  useEffect(() => {
    if (isOpen && !campaign) {
      fetchUserCampaigns();
    }
  }, [isOpen, campaign]);

  // Update game system when campaign selection changes
  useEffect(() => {
    if (selectedCampaignId && availableCampaigns.length > 0) {
      const selectedCampaign = availableCampaigns.find(
        (c) => c.id === selectedCampaignId
      );
      if (selectedCampaign?.gameSystem) {
        setGameSystem(selectedCampaign.gameSystem);
      }
    }
  }, [selectedCampaignId, availableCampaigns]);

  // A typed Game system that no longer matches the selected Campaign (for
  // example D&D after the user had Pathfinder selected) falls back to Unassigned.
  // Flexible must not clear a typed Campaign: that is the inherit path above.
  useEffect(() => {
    if (!gameSystem || !selectedCampaignId) {
      return;
    }
    const selectedCampaign = availableCampaigns.find(
      (c) => c.id === selectedCampaignId
    );
    if (
      selectedCampaign &&
      !systemsCompatible(gameSystem, selectedCampaign.gameSystem)
    ) {
      setSelectedCampaignId(null);
      setCampaignResetStatus(
        'Campaign selection reset to Unassigned because it is not compatible with the selected Game system.'
      );
    }
  }, [gameSystem, selectedCampaignId, availableCampaigns]);

  const fetchUserCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await api.listCampaigns();
      setAvailableCampaigns(
        response.campaigns.filter((c) => isChoosableGameSystem(c.gameSystem))
      );
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const isGameSystemLocked = (): boolean => {
    // If preselected (from campaign context), lock it
    if (preselectedGameSystem !== undefined) {
      return true;
    }

    // If campaign is selected and has a game system, lock it
    if (selectedCampaignId && availableCampaigns.length > 0) {
      const selectedCampaign = availableCampaigns.find(
        (c) => c.id === selectedCampaignId
      );
      return selectedCampaign?.gameSystem !== null && selectedCampaign?.gameSystem !== undefined;
    }

    return false;
  };

  const getTemplateOptions = (): TemplateOption[] => {
    if (!gameSystem) {
      return [
        {
          value: 'blank',
          label: 'Blank Character',
          description: 'Start with an empty flexible character sheet',
        },
        {
          value: 'basic',
          label: 'Basic Template',
          description: 'Attributes, Skills, Inventory, and Background sections',
        },
      ];
    }

    return TEMPLATE_OPTIONS_BY_SYSTEM[gameSystem] || [];
  };

  /**
   * When true, the sheet is also published as a shared template after the
   * character is created. Held in a ref rather than state because the second
   * submit button sets it immediately before the form submits, and a state
   * update would not have landed by the time handleSubmit reads it.
   */
  const alsoPublishTemplate = useRef(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    // Validation
    if (name.trim().length < 2) {
      setError('Character name must be at least 2 characters');
      return;
    }

    if (!isChoosableGameSystem(gameSystem)) {
      setError(
        'New Characters cannot be created for that system until the sheet ships.'
      );
      return;
    }

    // TODO(#1): the server and the sheet editors take 200 characters
    // (SHEET_NAME_MAX), and 100 itself passes here though the message says
    // "less than 100". The note below also promises a redirect to the editor
    // that creation does not do.
    if (name.trim().length > 100) {
      setError('Character name must be less than 100 characters');
      return;
    }

    setLoading(true);

    try {
      // Always fetch the template from the backend (even for 'blank') so that
      // the character is created with all required schema fields populated.
      let templateData: Record<string, unknown> = {};
      if (selectedTemplate) {
        const systemParam = gameSystem || 'null';
        const starter = await api.getStarterSheet(systemParam, selectedTemplate);
        templateData = starter.data || {};
      }

      // Create character using the api client
      const response = await api.createCharacter({
        name: name.trim(),
        campaignId: selectedCampaignId || undefined,
        gameSystem: gameSystem || undefined,
        data: templateData as unknown as import('@/types').CharacterData,
      });

      // Optionally publish the same sheet as a shared template. Done after the
      // character exists, and failing softly: the character is the thing the
      // user asked for, so a template error must not lose it.
      if (alsoPublishTemplate.current) {
        try {
          await api.createCharacterTemplate({
            name: name.trim(),
            gameSystem: gameSystem || null,
            data: templateData,
          });
        } catch {
          setError(
            'Character created, but publishing it as a template failed. You can retry with "Save as Template" in the editor.'
          );
        }
        alsoPublishTemplate.current = false;
      }

      // Reset form
      setName('');
      setSelectedCampaignId(campaign?.id || null);
      setGameSystem(preselectedGameSystem || campaign?.gameSystem || null);
      setSelectedTemplate('blank');
      setCampaignResetStatus('');

      // Notify parent
      onSuccess(response.character);

      // Close modal
      onClose();
    } catch (err) {
      // Show detailed validation errors if available
      const issues = apiValidationIssues(err);
      if (issues) {
        const errorList = issues
          .map((e) => `• ${e.path}: ${e.message}`)
          .join('\n');
        setError(`${apiErrorMessage(err)}\n\n${errorList}`);
        console.error('Validation errors:', issues);
      } else {
        setError(apiErrorMessage(err) || errorMessage(err) || 'Failed to create character');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName('');
      setSelectedCampaignId(campaign?.id || null);
      setGameSystem(preselectedGameSystem || campaign?.gameSystem || null);
      setSelectedTemplate('blank');
      setCampaignResetStatus('');
      setError('');
      onClose();
    }
  };

  const isFormValid = name.trim().length >= 2;
  const gameSystemChoosable = isChoosableGameSystem(gameSystem);
  const unchoosableSystemStatusId = 'unchoosable-system-status';

  // Flexible (unset) lists choosable membership Campaigns so campaign-first
  // inherit still works for shipped sheets. Campaigns whose game system is set
  // and not in GAME_SYSTEM_OPTIONS are omitted so inherit cannot lock Game
  // system to an unmatched select value. A typed Game system offers only
  // compatible choosable Campaigns: same system, plus Campaigns with no game
  // system. ADR 0015 / systemsCompatible.
  const choosableCampaigns = availableCampaigns.filter((c) =>
    isChoosableGameSystem(c.gameSystem)
  );
  const offeredCampaigns = gameSystem
    ? choosableCampaigns.filter((c) =>
        systemsCompatible(gameSystem, c.gameSystem)
      )
    : choosableCampaigns;

  const campaignHintId = 'campaign-hint';
  const campaignFilterHintId = 'campaign-filter-hint';
  const campaignEmptyHintId = 'campaign-empty-hint';
  const showEmptyFilterCopy =
    Boolean(gameSystem) && !loadingCampaigns && offeredCampaigns.length === 0;
  const campaignEmptyCopy = gameSystem
    ? `None of your Campaigns use ${getGameSystemLabel(gameSystem)}. Leave Unassigned, or choose Flexible (No System) to see every Campaign.`
    : '';
  const campaignDescribedBy = [
    campaignHintId,
    gameSystem && !showEmptyFilterCopy ? campaignFilterHintId : '',
    showEmptyFilterCopy ? campaignEmptyHintId : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal open={isOpen} onClose={handleClose} title="Create New Character" icon={User} size="lg" closeDisabled={loading}>
      {/* Error Alert */}
      {error && (
                <div role="alert" className="mb-4 bg-spirit-red/10 border border-spirit-red/30 rounded-lg p-4 max-h-60 overflow-y-auto">
                  <p className="text-sm text-spirit-red font-medium whitespace-pre-wrap font-mono">
                    {error}
                  </p>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Character Name */}
                <div>
                  <label
                    htmlFor="characterName"
                    className="block text-sm font-semibold text-ink mb-2"
                  >
                    Character Name <span className="text-spirit-red">*</span>
                  </label>
                  <input
                    type="text"
                    id="characterName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Aria Moonshadow"
                    disabled={loading}
                    className="input-cozy w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    autoFocus
                    required
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    Give your character a memorable name (2-100 characters)
                  </p>
                </div>

                {/* Campaign Selection (if not from campaign context) */}
                {!campaign && (
                  <div>
                    <label
                      htmlFor="campaign"
                      className="block text-sm font-semibold text-ink mb-2"
                    >
                      Campaign <span className="text-ink-muted">(optional)</span>
                    </label>
                    <select
                      id="campaign"
                      value={selectedCampaignId || ''}
                      onChange={(e) =>
                        setSelectedCampaignId(e.target.value || null)
                      }
                      disabled={loading || loadingCampaigns}
                      className="input-cozy w-full disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-describedby={campaignDescribedBy}
                    >
                      <option value="">Unassigned Character</option>
                      {offeredCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.gameSystem && ` (${getGameSystemLabel(c.gameSystem)})`}
                        </option>
                      ))}
                    </select>
                    <p id={campaignHintId} className="mt-1 text-xs text-ink-muted">
                      Assign to a campaign now, or leave unassigned for later
                    </p>
                    {gameSystem && !showEmptyFilterCopy && (
                      <p
                        id={campaignFilterHintId}
                        role="status"
                        className="mt-1 text-xs text-ink-muted"
                      >
                        Only compatible Campaigns are listed. Campaigns with no
                        game system are included.
                      </p>
                    )}
                    {showEmptyFilterCopy && (
                      <p
                        id={campaignEmptyHintId}
                        role="status"
                        className="mt-1 text-xs text-ink-muted"
                      >
                        {campaignEmptyCopy}
                      </p>
                    )}
                    {campaignResetStatus && (
                      <p role="status" className="sr-only">
                        {campaignResetStatus}
                      </p>
                    )}
                  </div>
                )}

                {/* Game System Selection */}
                <div>
                  <label
                    htmlFor="gameSystem"
                    className="block text-sm font-semibold text-ink mb-2"
                  >
                    Game System{' '}
                    {isGameSystemLocked() ? (
                      <span className="text-ink-muted">(from campaign)</span>
                    ) : (
                      <span className="text-ink-muted">(optional)</span>
                    )}
                  </label>
                  <select
                    id="gameSystem"
                    value={gameSystem || ''}
                    onChange={(e) => {
                      setGameSystem((e.target.value as GameSystem) || null);
                      setSelectedTemplate('blank'); // Reset template when game system changes
                    }}
                    disabled={loading || isGameSystemLocked()}
                    className="input-cozy w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-describedby={
                      gameSystemChoosable ? undefined : unchoosableSystemStatusId
                    }
                  >
                    <option value="">Flexible (No System)</option>
                    {GAME_SYSTEM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {gameSystem && !gameSystemChoosable && (
                      <option value={gameSystem}>
                        {GAME_SYSTEM_LABELS[gameSystem]}
                      </option>
                    )}
                  </select>
                  <p className="mt-1 text-xs text-ink-muted">
                    {isGameSystemLocked()
                      ? 'Game system is inherited from the selected campaign'
                      : 'Select a game system to use pre-built templates'}
                  </p>
                  {!gameSystemChoosable && (
                    <p
                      id={unchoosableSystemStatusId}
                      role="status"
                      className="mt-1 text-xs text-ink-muted"
                    >
                      New Characters cannot be created for{' '}
                      {gameSystem ? getGameSystemLabel(gameSystem) : 'that system'}{' '}
                      until the sheet ships.
                    </p>
                  )}
                </div>

                {/* Template Selection (only if a choosable game system is selected) */}
                {gameSystem && gameSystemChoosable && (
                  <div>
                    <label
                      htmlFor="template"
                      className="block text-sm font-semibold text-ink mb-2"
                    >
                      Character Template
                    </label>
                    <div className="space-y-3">
                      {getTemplateOptions().map((template) => (
                        <label
                          key={template.value}
                          className={`flex items-start p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            selectedTemplate === template.value
                              ? 'border-moss-green bg-moss-green/5'
                              : 'border-ink/10 hover:border-moss-green/50'
                          } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="template"
                            value={template.value}
                            checked={selectedTemplate === template.value}
                            onChange={(e) => setSelectedTemplate(e.target.value)}
                            disabled={loading}
                            className="mt-1 mr-3"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-ink">
                                {template.label}
                              </span>
                              {template.value !== 'blank' && (
                                <Sparkles className="w-4 h-4 text-warm-amber" />
                              )}
                            </div>
                            <p className="text-sm text-ink-muted mt-1">
                              {template.description}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">
                      Templates pre-fill the character sheet with example data
                    </p>
                  </div>
                )}

                {/* Info Box */}
                <div className="rounded-lg p-4 bg-moss-green/10 border border-moss-green/30">
                  <p className="text-sm text-ink">
                    <strong className="text-brand-ink">Note:</strong> After
                    creation, you'll be redirected to the character editor where
                    you can customize all details and save when ready.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleClose}
                    disabled={loading}
                    variant="secondary" className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    disabled={loading || !isFormValid || !gameSystemChoosable}
                    className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <User className="w-4 h-4 inline-block mr-2" />
                        Create Character
                      </>
                    )}
                  </Button>
                </div>

                {/* Publish the same sheet for others to copy, in one step. */}
                <div className="pt-1">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={loading || !isFormValid || !gameSystemChoosable}
                    onClick={() => { alsoPublishTemplate.current = true; }}
                    title="Create this character and also publish it as a template others can copy"
                    className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create &amp; Publish as Template
                  </Button>
                </div>
              </form>
    </Modal>
  );
}
