/**
 * CallOfCthulhu7eCharacterEditor Component
 *
 * Editable Call of Cthulhu 7e character sheet with auto-calculation of
 * derived stats, half/fifth values, and validation.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  Target,
  Swords,
  Package,
  BookText,
  Upload,
} from 'lucide-react';
import { Character } from '../../../types';
import type { CharacterData } from '../../../types';
import type {
  CoC7eCharacterData,
  CoC7eCharacteristics,
  CoC7eDerivedStats,
  CoC7eSkills,
  CoC7eCombat,
  CoC7eWealth,
  CoC7eBackstory,
  CoC7eAppearance,
  CoC7eConditions,
  SheetChrome,
} from '../../../types/game-systems';
import { apiErrorMessage } from '@/utils/errors';

/**
 * The sheet as this editor holds it: `CoC7eCharacterData` plus `themeColor`,
 * the header colour chosen in the editor. It is not part of the game system,
 * but every system's schema declares it, so it is saved with the sheet. The
 * server stores the schema's parsed sheet, so anything this editor writes has
 * to be declared there too.
 */
interface CoC7eFormData extends CoC7eCharacterData, SheetChrome {
  /**
   * Not declared by `CoC7eCharacterData` or the schema, which keep the
   * investigator's name at the top level as `investigatorName`, so the server
   * drops it on save. Only the token-upload filename reads it, and falls back
   * to "Investigator" without it.
   */
  personalDetails?: { name?: string };
}
import { CharacteristicBlock } from './components/CharacteristicBlock';
import { orderedCharacteristics } from './characteristics';
import { SanityTracker } from './components/SanityTracker';
import { SkillsList } from './components/SkillsList';
import { WeaponsList } from './components/WeaponsList';
import { BackstorySection } from './components/BackstorySection';
import { api } from '../../../services/api';
import NumberField from '../../ui/NumberField';
import ListField, { parseLineList, formatLineList } from '../../ui/ListField';
import { LIMIT_NOTE_CLASS } from './limitNoteClass';
import {
  toStoredHexColor,
  customHeaderColourError,
} from '@/utils/themeColor';
import { SheetHeader, type ColorPreset } from '../SheetHeader';
import { COC7E_COLOR_PRESETS, COC7E_DEFAULT_HEX } from './colorPresets';
import { omitUnnamedRows } from '@/utils/sheetNamedRows';
import { setCoC7eSkillField } from './skillEdits';
import { cocDodgeBase, settleDodge } from './dodge';
import {
  cocHitPoints,
  cocMagicPoints,
  cocDamageBonusAndBuild,
  cocMoveRate,
  cocMaxSanity,
  cocHalfAndFifth,
} from './derivedStats';
import { parsePossessions, formatPossessions } from './possessions';
import { SHEET_LIST_MAX } from '@/constants/sheetLimits';
import { assetNameFrom } from '@/utils/assetName';

interface CallOfCthulhu7eCharacterEditorProps {
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Called once a save has gone through and nothing was typed while it was in
   * flight, so the editor holds nothing unsaved and its host can close it.
   * With something typed meanwhile, the editor stays open with it instead.
   */
  onDone?: () => void;
  character: Character;
  onSave: (data: CharacterData, showToast?: boolean, tokenImageUrl?: string) => Promise<void>;
  onCancel: () => void;
}

type TabId = 'overview' | 'skills' | 'combat' | 'possessions' | 'backstory';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'skills', label: 'Skills', icon: Target },
  { id: 'combat', label: 'Combat', icon: Swords },
  { id: 'possessions', label: 'Possessions', icon: Package },
  { id: 'backstory', label: 'Backstory', icon: BookText },
];


/**
 * Calculate damage bonus and build from STR + SIZ
 * Based on Call of Cthulhu 7e rules
 */
/**
 * The five conditions the sheet tracks, in the order the rulebook introduces
 * them: the three that follow from hit points, then the two from Sanity.
 */
const COC_CONDITIONS: { key: keyof CoC7eConditions; label: string }[] = [
  { key: 'majorWound', label: 'Major Wound' },
  { key: 'dying', label: 'Dying' },
  { key: 'unconscious', label: 'Unconscious' },
  { key: 'temporaryInsanity', label: 'Temporary Insanity' },
  { key: 'indefiniteInsanity', label: 'Indefinite Insanity' },
];

/** The appearance fields the official sheet records, in its own order. */
const COC_APPEARANCE_FIELDS: { key: keyof CoC7eAppearance; label: string }[] = [
  { key: 'age', label: 'Age' },
  { key: 'height', label: 'Height' },
  { key: 'weight', label: 'Weight' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'hair', label: 'Hair' },
  { key: 'skin', label: 'Skin' },
];

const DEFAULT_CHARACTERISTIC_SCORE = 50;

function createDefaultCharacteristics(rawCharacteristics?: unknown): CoC7eCharacteristics {
  const source =
    typeof rawCharacteristics === 'object' && rawCharacteristics !== null
      ? (rawCharacteristics as Record<string, unknown>)
      : {};
  const keys = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'] as const;
  const characteristics: Partial<CoC7eCharacteristics> = {};

  for (const key of keys) {
    const raw =
      typeof source[key] === 'object' && source[key] !== null
        ? (source[key] as Record<string, unknown>)
        : {};
    const regular =
      typeof raw.regular === 'number' && Number.isFinite(raw.regular)
        ? Math.min(100, Math.max(0, Math.trunc(raw.regular)))
        : DEFAULT_CHARACTERISTIC_SCORE;
    const derived = cocHalfAndFifth(regular);
    characteristics[key] = {
      regular,
      half:
        typeof raw.half === 'number' && Number.isFinite(raw.half)
          ? raw.half
          : derived.half,
      fifth:
        typeof raw.fifth === 'number' && Number.isFinite(raw.fifth)
          ? raw.fifth
          : derived.fifth,
    };
  }

  return characteristics as CoC7eCharacteristics;
}

function createDefaultDerivedStats(
  rawDerivedStats: unknown,
  characteristics: CoC7eCharacteristics,
  skills?: CoC7eSkills,
  ageValue?: string | number
): CoC7eDerivedStats {
  const source =
    typeof rawDerivedStats === 'object' && rawDerivedStats !== null
      ? (rawDerivedStats as Record<string, unknown>)
      : {};
  const rawHp =
    typeof source.hp === 'object' && source.hp !== null
      ? (source.hp as Record<string, unknown>)
      : {};
  const rawMp =
    typeof source.magicPoints === 'object' && source.magicPoints !== null
      ? (source.magicPoints as Record<string, unknown>)
      : {};
  const rawSanity =
    typeof source.sanity === 'object' && source.sanity !== null
      ? (source.sanity as Record<string, unknown>)
      : {};
  const rawLuck =
    typeof source.luck === 'object' && source.luck !== null
      ? (source.luck as Record<string, unknown>)
      : {};
  const rawDodge =
    typeof source.dodge === 'object' && source.dodge !== null
      ? (source.dodge as Record<string, unknown>)
      : {};

  const con = characteristics.CON?.regular ?? DEFAULT_CHARACTERISTIC_SCORE;
  const siz = characteristics.SIZ?.regular ?? DEFAULT_CHARACTERISTIC_SCORE;
  const str = characteristics.STR?.regular ?? DEFAULT_CHARACTERISTIC_SCORE;
  const dex = characteristics.DEX?.regular ?? DEFAULT_CHARACTERISTIC_SCORE;
  const pow = characteristics.POW?.regular ?? DEFAULT_CHARACTERISTIC_SCORE;
  const numericAge = typeof ageValue === 'number' ? ageValue : parseInt(String(ageValue || '30'), 10) || 30;

  const maxHP = cocHitPoints(con, siz);
  const majorWoundThreshold = Math.max(1, Math.floor(maxHP / 2));
  const hpCurrent =
    typeof rawHp.current === 'number' && Number.isFinite(rawHp.current)
      ? rawHp.current
      : maxHP;
  const hpMaximum =
    typeof rawHp.maximum === 'number' && Number.isFinite(rawHp.maximum)
      ? rawHp.maximum
      : maxHP;

  const maxMP = cocMagicPoints(pow);
  const mpCurrent =
    typeof rawMp.current === 'number' && Number.isFinite(rawMp.current)
      ? rawMp.current
      : maxMP;
  const mpMaximum =
    typeof rawMp.maximum === 'number' && Number.isFinite(rawMp.maximum)
      ? rawMp.maximum
      : maxMP;

  const cthulhuMythos = skills?.cthulhuMythos?.currentValue || 0;
  const maxSanity = cocMaxSanity(cthulhuMythos);
  const startingSanityBounded =
    typeof rawSanity.starting === 'number' && Number.isFinite(rawSanity.starting)
      ? Math.min(99, Math.max(0, Math.trunc(rawSanity.starting)))
      : Math.min(99, Math.max(0, pow));
  const currentSanityBounded =
    typeof rawSanity.current === 'number' && Number.isFinite(rawSanity.current)
      ? Math.min(maxSanity, Math.max(0, Math.trunc(rawSanity.current)))
      : Math.min(maxSanity, startingSanityBounded);

  const { damageBonus, build } = cocDamageBonusAndBuild(str, siz);
  const moveRate =
    typeof source.moveRate === 'number' && Number.isFinite(source.moveRate)
      ? source.moveRate
      : cocMoveRate(str, dex, siz, numericAge);

  const dodgeBase = cocDodgeBase(dex);
  const dodgeValue =
    typeof rawDodge.value === 'number' && Number.isFinite(rawDodge.value)
      ? rawDodge.value
      : (skills?.dodge?.currentValue ?? dodgeBase);

  return {
    hp: {
      maximum: hpMaximum,
      current: hpCurrent,
      majorWoundThreshold,
      formula: typeof rawHp.formula === 'string' && rawHp.formula ? rawHp.formula : '(CON + SIZ) / 10, rounded down',
    },
    magicPoints: {
      maximum: mpMaximum,
      current: mpCurrent,
      formula: typeof rawMp.formula === 'string' && rawMp.formula ? rawMp.formula : 'POW / 5',
    },
    sanity: {
      starting: startingSanityBounded,
      maximum: maxSanity,
      current: currentSanityBounded,
      formula: typeof rawSanity.formula === 'string' && rawSanity.formula ? rawSanity.formula : 'Starts equal to POW; max is 99 minus Cthulhu Mythos skill',
    },
    luck: {
      score:
        typeof rawLuck.score === 'number' && Number.isFinite(rawLuck.score)
          ? Math.min(99, Math.max(0, Math.trunc(rawLuck.score)))
          : 50,
      notes: typeof rawLuck.notes === 'string' ? rawLuck.notes : '',
    },
    damageBonus: typeof source.damageBonus === 'string' && source.damageBonus ? source.damageBonus : damageBonus,
    build: typeof source.build === 'number' && Number.isFinite(source.build) ? source.build : build,
    moveRate,
    dodge: {
      value: dodgeValue,
      formula: typeof rawDodge.formula === 'string' && rawDodge.formula ? rawDodge.formula : 'DEX / 2',
      improvementChecked: rawDodge.improvementChecked === true,
    },
  };
}

function createDefaultAppearance(rawAppearance?: unknown): CoC7eAppearance {
  const source =
    typeof rawAppearance === 'object' && rawAppearance !== null
      ? (rawAppearance as Record<string, unknown>)
      : {};
  return {
    age: typeof source.age === 'number' || typeof source.age === 'string' ? (source.age as number) : ('' as unknown as number),
    height: typeof source.height === 'string' ? source.height : '',
    weight: typeof source.weight === 'string' ? source.weight : '',
    eyes: typeof source.eyes === 'string' ? source.eyes : '',
    hair: typeof source.hair === 'string' ? source.hair : '',
    skin: typeof source.skin === 'string' ? source.skin : '',
  };
}

function createDefaultWealth(rawWealth?: unknown): CoC7eWealth {
  const source =
    typeof rawWealth === 'object' && rawWealth !== null
      ? (rawWealth as Record<string, unknown>)
      : {};
  return {
    spendingLevel: typeof source.spendingLevel === 'string' ? source.spendingLevel : 'Average',
    cash: typeof source.cash === 'number' && Number.isFinite(source.cash) ? source.cash : 0,
    assets: typeof source.assets === 'string' ? source.assets : '',
    notes: typeof source.notes === 'string' ? source.notes : '',
  };
}

function createDefaultBackstory(rawBackstory?: unknown): CoC7eBackstory {
  const source =
    typeof rawBackstory === 'object' && rawBackstory !== null
      ? (rawBackstory as Record<string, unknown>)
      : {};
  return {
    description: typeof source.description === 'string' ? source.description : '',
    personalDescription: typeof source.personalDescription === 'string' ? source.personalDescription : '',
    ideology: typeof source.ideology === 'string' ? source.ideology : '',
    significantPeople: typeof source.significantPeople === 'string' ? source.significantPeople : '',
    meaningfulLocations: typeof source.meaningfulLocations === 'string' ? source.meaningfulLocations : '',
    treasuredPossessions: typeof source.treasuredPossessions === 'string' ? source.treasuredPossessions : '',
    traits: typeof source.traits === 'string' ? source.traits : '',
    injuriesAndScars: typeof source.injuriesAndScars === 'string' ? source.injuriesAndScars : '',
    phobiasAndManias: typeof source.phobiasAndManias === 'string' ? source.phobiasAndManias : '',
    arcaneTomesAndSpells: typeof source.arcaneTomesAndSpells === 'string' ? source.arcaneTomesAndSpells : '',
    encountersWithStrangeEntities: typeof source.encountersWithStrangeEntities === 'string' ? source.encountersWithStrangeEntities : '',
  };
}

function createDefaultConditions(rawConditions?: unknown): CoC7eConditions {
  const source =
    typeof rawConditions === 'object' && rawConditions !== null
      ? (rawConditions as Record<string, unknown>)
      : {};
  return {
    unconscious: source.unconscious === true,
    dying: source.dying === true,
    majorWound: source.majorWound === true,
    temporaryInsanity: source.temporaryInsanity === true,
    indefiniteInsanity: source.indefiniteInsanity === true,
  };
}

/**
 * CallOfCthulhu7eCharacterEditor - Editable CoC 7e character sheet
 */
export const CallOfCthulhu7eCharacterEditor: React.FC<CallOfCthulhu7eCharacterEditorProps> = ({
  character,
  onSave,
  onCancel,
  onDirtyChange,
  onDone,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isSaving, setIsSaving] = useState(false);
  const [themeColor, setThemeColor] = useState(COC7E_COLOR_PRESETS[0]);
  const [isCustomColor, setIsCustomColor] = useState(false);
  const [customColorHex, setCustomColorHex] = useState('');
  const [colorPickerFocusKey, setColorPickerFocusKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const data = character.data as CoC7eFormData;
  // The Keeper is sent the notes field always, and nobody else ever is.
  const keeperNotesShown = typeof data.notes === 'string';

  // Form state
  const [formData, setFormData] = useState<CoC7eFormData>(() => {
    const characteristics = createDefaultCharacteristics(data.characteristics);
    const derivedStats = createDefaultDerivedStats(
      data.derivedStats,
      characteristics,
      data.skills,
      data.age
    );
    const appearance = createDefaultAppearance(data.appearance);
    const wealth = createDefaultWealth(data.wealth);
    const backstory = createDefaultBackstory(data.backstory);
    const conditions = createDefaultConditions(data.conditions);

    return {
      ...data,
      characteristics,
      derivedStats,
      skills: (data.skills || {}) as CoC7eSkills,
      combat: (data.combat || { weapons: [] }) as CoC7eCombat,
      possessions: data.possessions || [],
      wealth,
      backstory,
      appearance,
      contacts: data.contacts || [],
      conditions,
    };
  });

  // Report the first edit up to whoever is hosting this sheet, so leaving with
  // unsaved work can be caught. One effect on the whole form rather than a call
  // in each of the ~40 field handlers: it cannot be forgotten when a field is
  // added, and it catches changes made any way at all. The initial render is
  // skipped, and the flag is reset after a successful save.
  // Two conditions, both required, because either alone gets it wrong.
  //
  // The sheet recalculates derived values (the half/fifth columns, hit points,
  // magic points, sanity) from effects that run as it mounts, so `formData`
  // changes identity — and often value — before anyone has touched anything.
  // Reporting on identity alone marked every investigator dirty on open, and
  // comparing values alone still did, because those effects genuinely write
  // different numbers to a sheet whose stored values had drifted.
  //
  // So: until the first real interaction the baseline simply follows the form,
  // absorbing that settling. From the first interaction onwards the baseline is
  // frozen and edits are measured against it — which also means typing a value
  // and putting it back reads as clean, as it should.
  const dirtyRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const cleanSnapshotRef = useRef<string | null>(null);

  // Capture-phase, so it runs before the field's own handler updates state.
  // Pointer events are included because plenty of edits here are button
  // presses (add a skill, adjust a track) rather than typing.
  const noteInteraction = () => { hasInteractedRef.current = true; };

  // Token image state
  const [tokenImageFile, setTokenImageFile] = useState<File | null>(null);
  const [tokenImagePreview, setTokenImagePreview] = useState<string | null>(
    character.tokenImageUrl
  );

  // The header colour and a newly chosen token picture are kept outside the
  // form, and are unsaved changes too.
  const snapshotOf = (form: typeof formData, theme: string, picture: File | null) => JSON.stringify({
    formData: form,
    themeColor: theme,
    tokenImage: picture ? `${picture.name}:${picture.size}:${picture.lastModified}` : null,
  });
  const themeChoice = isCustomColor ? customColorHex : themeColor.name;
  const sheetSnapshot = snapshotOf(formData, themeChoice, tokenImageFile);
  if (cleanSnapshotRef.current === null) {
    cleanSnapshotRef.current = sheetSnapshot;
  }
  // Always the current state, for reading inside async callbacks.
  const latestSnapshotRef = useRef(sheetSnapshot);
  latestSnapshotRef.current = sheetSnapshot;

  useEffect(() => {
    if (!hasInteractedRef.current) {
      cleanSnapshotRef.current = sheetSnapshot;
      return;
    }
    const dirty = sheetSnapshot !== cleanSnapshotRef.current;
    if (dirty !== dirtyRef.current) {
      dirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [sheetSnapshot, onDirtyChange]);

  // Auto-calculate half and fifth values for characteristics
  useEffect(() => {
    if (!formData.characteristics) return;

    // Rebuild each entry rather than spreading one level and assigning into it:
    // a shallow copy shares the nested characteristic objects with state, so the
    // old version mutated `formData` in place.
    const updated: Partial<CoC7eCharacteristics> = {};
    let changed = false;
    (Object.keys(formData.characteristics) as (keyof CoC7eCharacteristics)[]).forEach((char) => {
      const entry = formData.characteristics[char];
      const regular = entry.regular || 0;
      const { half, fifth } = cocHalfAndFifth(regular);
      if (entry.half !== half || entry.fifth !== fifth) changed = true;
      updated[char] = { ...entry, half, fifth };
    });

    // Skip the update when the derived columns already agree, so simply opening
    // a sheet does not queue a state change.
    if (changed) {
      setFormData((prev) => ({ ...prev, characteristics: updated as CoC7eCharacteristics }));
    }
  }, [
    formData.characteristics?.STR?.regular,
    formData.characteristics?.CON?.regular,
    formData.characteristics?.SIZ?.regular,
    formData.characteristics?.DEX?.regular,
    formData.characteristics?.APP?.regular,
    formData.characteristics?.INT?.regular,
    formData.characteristics?.POW?.regular,
    formData.characteristics?.EDU?.regular,
  ]);

  // The DEX the derived stats were last worked out from, so a DEX change made
  // here can move Dodge's base without taking away the points spent on it.
  // Null until the sheet has been read once.
  const dodgeDexRef = useRef<number | null>(null);

  // Auto-calculate derived stats
  useEffect(() => {
    const char = formData.characteristics;
    const age = formData.age || 30;

    if (char) {
      const con = char.CON?.regular || 0;
      const siz = char.SIZ?.regular || 0;
      const str = char.STR?.regular || 0;
      const dex = char.DEX?.regular || 0;
      const pow = char.POW?.regular || 0;

      // HP
      const maxHP = cocHitPoints(con, siz);
      const majorWoundThreshold = Math.floor(maxHP / 2);

      // Magic Points
      const maxMP = cocMagicPoints(pow);

      // Damage Bonus and Build
      const { damageBonus, build } = cocDamageBonusAndBuild(str, siz);

      // Move Rate
      const moveRate = cocMoveRate(str, dex, siz, age);

      // Dodge's base is half DEX. Its value is the base plus the skill points
      // and improvements the investigator has put into it, so it is kept.
      const dodgeBase = cocDodgeBase(dex);
      const previousDex = dodgeDexRef.current;
      dodgeDexRef.current = dex;
      const previousDodgeBase = previousDex === null ? null : cocDodgeBase(previousDex);

      // Max Sanity (99 - Cthulhu Mythos)
      const cthulhuMythos = formData.skills?.cthulhuMythos?.currentValue || 0;
      const maxSanity = cocMaxSanity(cthulhuMythos);

      setFormData((prev) => {
        const storedDodge = prev.skills?.dodge;
        const dodge = storedDodge ? settleDodge(storedDodge, dodgeBase, previousDodgeBase) : undefined;
        return {
          ...prev,
          ...(dodge && dodge !== storedDodge ? { skills: { ...prev.skills, dodge } as CoC7eSkills } : {}),
          derivedStats: {
            ...prev.derivedStats,
            hp: {
              maximum: maxHP,
              current: prev.derivedStats?.hp?.current ?? maxHP,
              majorWoundThreshold,
              formula: '(CON + SIZ) / 10, rounded down',
            },
            magicPoints: {
              maximum: maxMP,
              current: prev.derivedStats?.magicPoints?.current ?? maxMP,
              formula: 'POW / 5',
            },
            damageBonus,
            build,
            moveRate,
            // The same number as the Dodge skill, which is what is rolled.
            dodge: {
              value: dodge?.currentValue ?? dodgeBase,
              formula: 'DEX / 2',
              improvementChecked: prev.derivedStats?.dodge?.improvementChecked || false,
            },
            sanity: {
              starting: Math.min(99, Math.max(0, prev.derivedStats?.sanity?.starting ?? pow)),
              maximum: maxSanity,
              current: Math.min(
                maxSanity,
                Math.max(0, prev.derivedStats?.sanity?.current ?? Math.min(99, pow))
              ),
              formula: 'Starts equal to POW; max is 99 minus Cthulhu Mythos skill',
            },
            luck: prev.derivedStats?.luck || { score: 50, notes: '' },
          },
        };
      });
    }
  }, [
    formData.characteristics?.CON?.regular,
    formData.characteristics?.SIZ?.regular,
    formData.characteristics?.STR?.regular,
    formData.characteristics?.DEX?.regular,
    formData.characteristics?.POW?.regular,
    formData.age,
    formData.skills?.cthulhuMythos?.currentValue,
  ]);

  // Handle token image selection
  const handleTokenImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTokenImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setTokenImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle save
  const handleSave = async () => {
    // A completed save means nothing is pending any more.
    // Unless the sheet was edited again while the save was in flight, which the
    // recheck preserves.
    const savedSnapshot = sheetSnapshot;
    const savedForm = formData;
    const savedTheme = themeChoice;
    const uploadedPicture = tokenImageFile;
    const markClean = () => {
      const stillDirty = latestSnapshotRef.current !== savedSnapshot;
      // A picture that went up with this save is on the character now, so the
      // next save must not upload it again. One chosen while saving stays.
      if (uploadedPicture) {
        setTokenImageFile((current) => (current === uploadedPicture ? null : current));
        cleanSnapshotRef.current = snapshotOf(savedForm, savedTheme, null);
      } else {
        cleanSnapshotRef.current = savedSnapshot;
      }
      dirtyRef.current = stillDirty;
      onDirtyChange?.(stillDirty);
      // Typed while the save was in flight: the editor keeps it, unsaved.
      if (!stillDirty) onDone?.();
    };
    // The server refuses a colour it cannot read, and a custom hex too pale
    // for the fixed light header text, and the whole save with it.
    const colourError = customHeaderColourError(isCustomColor, customColorHex);
    if (colourError) {
      setErrors((prev) => ({ ...prev, themeColor: colourError }));
      setColorPickerFocusKey((n) => n + 1);
      return;
    }
    setIsSaving(true);
    try {
      // Include color customization in saved data
      const updatedData = {
        ...formData,
        themeColor: isCustomColor ? (toStoredHexColor(customColorHex) ?? '') : themeColor.name,
        possessions: omitUnnamedRows(formData.possessions, 'name'),
        contacts: omitUnnamedRows(formData.contacts, 'name'),
        combat: formData.combat
          ? { ...formData.combat, weapons: omitUnnamedRows(formData.combat.weapons, 'name') ?? [] }
          : formData.combat,
        skills: formData.skills
          ? {
              ...formData.skills,
              languageOther: omitUnnamedRows(formData.skills.languageOther, 'language') ?? [],
              science: omitUnnamedRows(formData.skills.science, 'specialization') ?? [],
            }
          : formData.skills,
      };

      // The derived copy of Dodge follows the skill, which is the one edited
      // and rolled. It is not kept in step while typing, where holding the
      // value at its base would turn a "5" on the way to "55" into 25.
      if (updatedData.skills?.dodge && updatedData.derivedStats?.dodge) {
        updatedData.derivedStats = {
          ...updatedData.derivedStats,
          dodge: { ...updatedData.derivedStats.dodge, value: updatedData.skills.dodge.currentValue },
        };
      }

      // Upload token image if a new one was selected
      let newTokenImageUrl: string | undefined = undefined;
      if (tokenImageFile) {
        try {
          const assetFormData = new FormData();
          assetFormData.append('file', tokenImageFile);
          assetFormData.append('type', 'TOKEN');
          if (character.campaignId) {
            assetFormData.append('scope', 'CAMPAIGN');
            assetFormData.append('campaignId', character.campaignId);
          } else {
            assetFormData.append('scope', 'USER');
          }
          assetFormData.append('name', assetNameFrom(`${formData.personalDetails?.name || 'Investigator'} Token`));

          const uploadResponse = await api.uploadAsset(assetFormData);
          const assetId = uploadResponse.asset.id;

          // Store the new token URL to pass separately to onSave
          newTokenImageUrl = `/api/assets/tokens/${assetId}`;
        } catch (uploadError: unknown) {
          console.error('Error uploading token image:', uploadError);
          setErrors({ ...errors, tokenImage: apiErrorMessage(uploadError) || 'Failed to upload token image' });
          setIsSaving(false);
          return;
        }
      }

      // Pass the tokenImageUrl as a separate parameter if it was uploaded
      await onSave(updatedData, true, newTokenImageUrl);
      markClean();
    } catch (error) {
      console.error('Failed to save character:', error);
      setErrors((prev) => ({ ...prev, submit: 'Failed to save character. Please try again.' }));
    } finally {
      setIsSaving(false);
    }
  };

  // Load saved color preference from character metadata
  useEffect(() => {
    if (formData.themeColor) {
      const savedColor = COC7E_COLOR_PRESETS.find(c => c.name === formData.themeColor);
      if (savedColor) {
        setThemeColor(savedColor);
        setIsCustomColor(false);
      } else {
        // Custom hex colour, a three-digit one expanded, so it opens as itself
        // rather than as the default preset.
        const hex = toStoredHexColor(formData.themeColor);
        if (hex) {
          setCustomColorHex(hex);
          setIsCustomColor(true);
          const colourError = customHeaderColourError(true, hex);
          if (colourError) setErrors((prev) => ({ ...prev, themeColor: colourError }));
        }
      }
    }
  }, [formData.themeColor]);

  // Handle custom color change
  const handleCustomColorChange = (hex: string) => {
    setCustomColorHex(hex);
    setIsCustomColor(true);
    setErrors((prev) => ({ ...prev, themeColor: '' }));
  };

  // Handle preset color selection
  const handlePresetColorSelect = (color: ColorPreset) => {
    const vintage =
      COC7E_COLOR_PRESETS.find((preset) => preset.name === color.name) ?? COC7E_COLOR_PRESETS[0];
    setThemeColor(vintage);
    setIsCustomColor(false);
    setErrors((prev) => ({ ...prev, themeColor: '' }));
  };

  // Render header with save/cancel buttons
  // flex-1 on the name row/column, with SheetHeader's min-w-0, so the
  // column can shrink below its content width and stay inside the reserved padding.
  const renderHeader = () => (
    <SheetHeader
      variant="vintage"
      mode="edit"
      presets={COC7E_COLOR_PRESETS}
      selectedPreset={themeColor}
      isCustomColor={isCustomColor}
      customColorHex={customColorHex}
      defaultHex={COC7E_DEFAULT_HEX}
      token={{
        sizeClass: 'w-24 h-24',
        preview: tokenImagePreview,
        alt: formData.investigatorName || 'Investigator',
        circleClass: 'border-4 border-amber-600/50 shadow-xl',
        emptyClass: 'bg-sepia-900',
        placeholder: <Upload className="w-8 h-8 text-amber-400/60" />,
        hover: 'fade',
        onFileChange: handleTokenImageChange,
        error: errors.tokenImage,
        personalHint: !character.campaignId,
      }}
      name={{
        value: formData.investigatorName || '',
        onChange: (value) => setFormData({ ...formData, investigatorName: value }),
        placeholder: 'Investigator Name',
      }}
      extraNameRowClassName="flex-1"
      extraNameColumnClassName="flex-1 space-y-3"
      onSave={handleSave}
      onCancel={onCancel}
      isSaving={isSaving}
      colorError={errors.themeColor}
      onCustomColorChange={handleCustomColorChange}
      onPresetSelect={handlePresetColorSelect}
      colorPickerFocusKey={colorPickerFocusKey}
      meta={(paint) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            {/* Read-only: the player name is whoever owns this investigator,
                filled from their display name at creation. */}
            <span className={`text-sm px-2 py-1 ${paint.text} self-center`}>
              {formData.playerName || '—'}
            </span>
            <input
              type="text"
              value={formData.occupation || ''}
              onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
              placeholder="Occupation"
              aria-label="Occupation"
              className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
            />
            <input
              type="text"
              value={formData.era || ''}
              onChange={(e) => setFormData({ ...formData, era: e.target.value })}
              placeholder="Era (e.g., 1920s)"
              aria-label="Era"
              className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <NumberField
              value={formData.age ?? 0}
              onChange={(v: number) => setFormData({ ...formData, age: v })}
              placeholder="Age"
              aria-label="Age"
              className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
              fallback={0}
            />
            <input
              type="text"
              value={formData.sex || ''}
              onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
              placeholder="Sex"
              aria-label="Sex"
              className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
            />
            <input
              type="text"
              value={formData.residence || ''}
              onChange={(e) => setFormData({ ...formData, residence: e.target.value })}
              placeholder="Residence"
              aria-label="Residence"
              className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 col-span-2 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
            />
          </div>

          <input
            type="text"
            value={formData.birthplace || ''}
            onChange={(e) => setFormData({ ...formData, birthplace: e.target.value })}
            placeholder="Birthplace"
            aria-label="Birthplace"
            className={`text-sm ${paint.fieldBg} border ${paint.fieldBorder} rounded px-2 py-1 w-full ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
          />
        </>
      )}
    />
  );

  // Render tabs
  const renderTabs = () => (
    <div className="flex space-x-1 border-b-2 border-sepia-400 bg-parchment-light/50 px-4">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center space-x-2 px-4 py-3 font-medium transition-colors
              ${
                isActive
                  ? 'text-green-800 border-b-2 border-green-800 -mb-0.5 bg-parchment'
                  : 'text-sepia-600 hover:text-sepia-900 hover:bg-parchment-light/70'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  // Render Overview tab
  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Characteristics */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-4">Characteristics</h3>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
          {orderedCharacteristics(formData.characteristics as unknown as Record<string, unknown>).map((charKey) => (
            <CharacteristicBlock
              key={charKey}
              label={charKey}
              regular={formData.characteristics[charKey as keyof CoC7eCharacteristics].regular}
              half={formData.characteristics[charKey as keyof CoC7eCharacteristics].half}
              fifth={formData.characteristics[charKey as keyof CoC7eCharacteristics].fifth}
              editable
              onChange={(value) => {
                setFormData({
                  ...formData,
                  characteristics: {
                    ...formData.characteristics,
                    [charKey]: {
                      ...formData.characteristics[charKey as keyof CoC7eCharacteristics],
                      regular: value,
                    },
                  },
                });
              }}
            />
          ))}
        </div>
      </div>

      {/* Sanity Tracker */}
      <SanityTracker
        current={formData.derivedStats?.sanity?.current || 0}
        starting={formData.derivedStats?.sanity?.starting || 0}
        maximum={formData.derivedStats?.sanity?.maximum || 99}
        cthulhuMythos={formData.skills?.cthulhuMythos?.currentValue || 0}
        editable
        onChange={{
          current: (value) => {
            setFormData({
              ...formData,
              derivedStats: {
                ...formData.derivedStats,
                sanity: { ...formData.derivedStats!.sanity, current: value },
              } as CoC7eDerivedStats,
            });
          },
          starting: (value) => {
            setFormData({
              ...formData,
              derivedStats: {
                ...formData.derivedStats,
                sanity: { ...formData.derivedStats!.sanity, starting: value },
              } as CoC7eDerivedStats,
            });
          },
        }}
      />

      {/* Derived Stats (showing auto-calculated values) */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-4">Derived Attributes (Auto-Calculated)</h3>
        <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 space-y-2 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-blue-700 font-semibold">HP Max:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.hp?.maximum || 0}</span>
              <div className="text-xs text-blue-600">(CON + SIZ) / 10</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">MP Max:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.magicPoints?.maximum || 0}</span>
              <div className="text-xs text-blue-600">POW / 5</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">Dodge:</span>{' '}
              <span className="text-blue-900">
                {formData.skills?.dodge?.currentValue ?? formData.derivedStats?.dodge?.value ?? 0}%
              </span>
              <div className="text-xs text-blue-600">
                Starts at half DEX ({cocDodgeBase(formData.characteristics?.DEX?.regular || 0)}); raise it on the Skills tab
              </div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">Move:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.moveRate || 8}</span>
              <div className="text-xs text-blue-600">Based on STR/DEX/SIZ/Age</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">DB:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.damageBonus || '0'}</span>
              <div className="text-xs text-blue-600">From STR + SIZ</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">Build:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.build || 0}</span>
              <div className="text-xs text-blue-600">From STR + SIZ</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">Max SAN:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.sanity?.maximum || 99}</span>
              <div className="text-xs text-blue-600">99 - Cthulhu Mythos</div>
            </div>
            <div>
              <span className="text-blue-700 font-semibold">Major Wound:</span>{' '}
              <span className="text-blue-900">{formData.derivedStats?.hp?.majorWoundThreshold || 0} HP</span>
              <div className="text-xs text-blue-600">HP Max / 2</div>
            </div>
          </div>
        </div>
      </div>

      {/* Current HP, MP, Luck (editable) */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-4">Current Status</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white border border-sepia-400 rounded-md p-3">
            <label className="text-xs text-sepia-600 uppercase block mb-1">Current HP</label>
            <NumberField
              aria-label="Current HP"
              value={formData.derivedStats?.hp?.current}
              onChange={(v: number) => {
                setFormData({
                  ...formData,
                  derivedStats: {
                    ...formData.derivedStats,
                    hp: { ...formData.derivedStats!.hp, current: v },
                  } as CoC7eDerivedStats,
                });
              }}
              className="w-full text-center text-2xl font-bold text-red-700 border-none bg-transparent focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
              fallback={0}
            />
          </div>
          <div className="bg-white border border-sepia-400 rounded-md p-3">
            <label className="text-xs text-sepia-600 uppercase block mb-1">Current MP</label>
            <NumberField
              aria-label="Current MP"
              value={formData.derivedStats?.magicPoints?.current}
              onChange={(v: number) => {
                setFormData({
                  ...formData,
                  derivedStats: {
                    ...formData.derivedStats,
                    magicPoints: {
                      ...formData.derivedStats!.magicPoints,
                      current: v,
                    },
                  } as CoC7eDerivedStats,
                });
              }}
              className="w-full text-center text-2xl font-bold text-purple-700 border-none bg-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 rounded"
              fallback={0}
            />
          </div>
          <div className="bg-white border border-sepia-400 rounded-md p-3">
            <label className="text-xs text-sepia-600 uppercase block mb-1">Luck Score</label>
            <NumberField
              aria-label="Luck Score"
              value={formData.derivedStats?.luck?.score}
              onChange={(v: number) => {
                setFormData({
                  ...formData,
                  derivedStats: {
                    ...formData.derivedStats,
                    luck: { ...formData.derivedStats!.luck, score: v },
                  } as CoC7eDerivedStats,
                });
              }}
              className="w-full text-center text-2xl font-bold text-yellow-700 border-none bg-transparent focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded"
              fallback={0}
            />
          </div>
        </div>
      </div>

      {/* Current Conditions.
          Major Wound, Dying and Unconscious follow from hit points; Temporary
          and Indefinite Insanity from Sanity. All five are core 7th-edition
          mechanics and all five were readable on the sheet but had nowhere to
          be set, so an investigator could never actually be marked as hurt or
          mad through the app. */}
      <div className="mt-6">
        <h3 className="text-lg font-bold text-sepia-900 mb-3">Current Conditions</h3>
        <div className="bg-white border border-sepia-400 rounded-md p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
          {COC_CONDITIONS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-sepia-900 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.conditions?.[key] ?? false}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    conditions: { ...formData.conditions, [key]: e.target.checked } as CoC7eConditions,
                  });
                }}
                className="rounded border-sepia-400 text-red-700 focus:ring-red-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  // Render Skills tab
  const renderSkillsTab = () => (
    <div>
      <SkillsList
        skills={formData.skills || {}}
        themeColor={themeColor}
        editable
        onChange={(skillName, field, value) => {
          setFormData({
            ...formData,
            // `skillName` may name a skill inside a group, such as
            // `fighting.brawl`; this writes it there.
            skills: setCoC7eSkillField(formData.skills ?? {}, skillName, field, value) as CoC7eSkills,
          });
        }}
      />
    </div>
  );

  // Render Combat tab
  const renderCombatTab = () => (
    <div>
      <WeaponsList
        weapons={formData.combat?.weapons || []}
        editable
        onChange={(weapons) => {
          setFormData({
            ...formData,
            combat: { ...formData.combat, weapons },
          });
        }}
      />
    </div>
  );

  // Render Possessions tab
  const renderPossessionsTab = () => (
    <div className="space-y-6">
      {/* Wealth */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-4">Wealth</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-sepia-700 font-semibold block mb-1">Spending Level</label>
            <input
              type="text"
              value={formData.wealth?.spendingLevel || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  wealth: { ...formData.wealth, spendingLevel: e.target.value } as CoC7eWealth,
                })
              }
              placeholder="e.g., Average, Wealthy"
              className="w-full bg-white border border-sepia-400 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
            />
          </div>
          <div>
            <label className="text-sm text-sepia-700 font-semibold block mb-1">Cash on Hand</label>
            <NumberField
value={formData.wealth?.cash}
              onChange={(v: number) => setFormData({
                  ...formData,
                  wealth: { ...formData.wealth, cash: v } as CoC7eWealth,
                })
              }
              className="w-full bg-white border border-sepia-400 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
            fallback={0}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-sm text-sepia-700 font-semibold block mb-1">Assets</label>
          <textarea
            value={formData.wealth?.assets || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                wealth: { ...formData.wealth, assets: e.target.value } as CoC7eWealth,
              })
            }
            placeholder="Describe assets, property, investments..."
            rows={2}
            className="w-full bg-white border border-sepia-400 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
          />
        </div>
      </div>

      {/* Possessions — free-text field */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-4">Possessions & Equipment</h3>
        <ListField
          multiline
          value={Array.isArray(formData.possessions) ? formData.possessions : []}
          onChange={(possessions) => setFormData((prev) => ({ ...prev, possessions }))}
          parse={parsePossessions}
          format={formatPossessions}
          max={SHEET_LIST_MAX}
          noteClassName={LIMIT_NOTE_CLASS}
          placeholder="List possessions, one per line. Format: Item Name - Notes"
          rows={8}
          className="w-full bg-white border border-sepia-400 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sepia-500"
        />
      </div>
    </div>
  );

  // Render Backstory tab
  const renderBackstoryTab = () => (
    <div className="space-y-6">
      <BackstorySection
        backstory={formData.backstory || {}}
        editable
        onChange={(field, value) => {
          setFormData({
            ...formData,
            backstory: { ...formData.backstory, [field]: value } as CoC7eBackstory,
          });
        }}
      />

      {/* Appearance. Shown on the sheet when reading it, but with no field to
          type into — so these could only ever be empty. */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-3">Appearance</h3>
        <div className="bg-white border border-sepia-400 rounded-md p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
          {COC_APPEARANCE_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs text-sepia-600 uppercase block mb-1">{label}</label>
              <input
                type="text"
                value={formData.appearance?.[key] ?? ''}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    appearance: { ...formData.appearance, [key]: e.target.value } as CoC7eAppearance,
                  });
                }}
                aria-label={label}
                className="w-full px-2 py-1 border border-sepia-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Cthulhu Mythos rating and the spells the investigator knows. Both are
          on the official sheet and neither had anywhere to live in the app. */}
      <div>
        <h3 className="text-lg font-bold text-sepia-900 mb-3">Spells &amp; Mythos</h3>
        <div className="bg-white border border-sepia-400 rounded-md p-3 space-y-3">
          <div>
            <label className="text-xs text-sepia-600 uppercase block mb-1">Cthulhu Mythos</label>
            <NumberField
              value={formData.spellsAndMythos?.cthulhuMythos}
              min={0}
              max={100}
              fallback={0}
              onChange={(v: number) => {
                setFormData({
                  ...formData,
                  spellsAndMythos: {
                    cthulhuMythos: v,
                    spells: formData.spellsAndMythos?.spells ?? [],
                  },
                });
              }}
              className="w-24 px-2 py-1 border border-sepia-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
            />
          </div>
          <div>
            <label className="text-xs text-sepia-600 uppercase block mb-1">Spells (one per line)</label>
            <ListField
              multiline
              rows={4}
              value={formData.spellsAndMythos?.spells ?? []}
              onChange={(spells) => {
                setFormData((prev) => ({
                  ...prev,
                  spellsAndMythos: {
                    cthulhuMythos: prev.spellsAndMythos?.cthulhuMythos ?? 0,
                    spells,
                  },
                }));
              }}
              parse={parseLineList}
              format={formatLineList}
              max={SHEET_LIST_MAX}
              noteClassName={LIMIT_NOTE_CLASS}
              placeholder={'Contact Nyarlathotep\nElder Sign'}
              className="w-full px-2 py-1 border border-sepia-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
            />
          </div>
        </div>
      </div>

      {/* Keeper's Notes. The server sends them to the DM of the character's
          campaign alone, always (empty when nothing is written), and keeps
          them as stored when anyone else saves, so the box is offered only
          when the sheet arrived with the field. */}
      {keeperNotesShown && (
        <div>
          <h3 className="text-lg font-bold text-sepia-900 mb-1">Keeper&apos;s Notes</h3>
          <p className="text-sm text-sepia-700 mb-3">Only you, as the Keeper, can see or change these.</p>
          <textarea
            rows={4}
            value={formData.notes ?? ''}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Notes kept by the Keeper about this investigator"
            aria-label="Keeper's Notes"
            className="w-full bg-white border border-sepia-400 rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-sepia-500"
          />
        </div>
      )}
    </div>
  );

  // Main render
  return (
    <div
      className="glass-panel overflow-hidden"
      onInputCapture={noteInteraction}
      onChangeCapture={noteInteraction}
      onPointerDownCapture={noteInteraction}
    >
      {renderHeader()}
      {renderTabs()}
      <div className="p-6 bg-parchment max-h-[calc(100vh-200px)] overflow-y-auto">
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'skills' && renderSkillsTab()}
        {activeTab === 'combat' && renderCombatTab()}
        {activeTab === 'possessions' && renderPossessionsTab()}
        {activeTab === 'backstory' && renderBackstoryTab()}
      </div>
      {errors.submit && (
        <div role="alert" aria-live="assertive" className="px-6 py-3 text-sm text-red-700 bg-parchment">{errors.submit}</div>
      )}
    </div>
  );
};

export default CallOfCthulhu7eCharacterEditor;
