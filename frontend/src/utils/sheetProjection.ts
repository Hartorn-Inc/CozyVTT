/**
 * sheetProjection.ts
 * Project a character sheet's derived values at read.
 *
 * ---------------------------------------------------------------------------
 * DUPLICATED FILE — these two copies must stay byte-for-byte identical:
 *   frontend/src/utils/sheetProjection.ts
 *   backend/src/utils/sheetProjection.ts
 * ---------------------------------------------------------------------------
 * Derived values stay on disk as compatibility caches. A stale cache must not
 * be what a view, a REST read, `character.updated`, or initiative uses, so
 * both sides project from the inputs when those inputs exist. Current
 * resources (current HP, remaining hit dice, current sanity, current magic
 * points, luck) are writes and are never overwritten. A number that would
 * leave the Zod schema is clamped into bounds.
 *
 * Creature printed totals are a different pipeline; this module does not
 * recompute them.
 */

import { DND5E_ABILITY_NAMES, DND5E_SKILLS, dnd5eSaveBonus, dnd5eSkillBonus } from './rules/dnd5e';
import {
  pf2eArmorClass,
  pf2eAttributeName,
  pf2eClassDC,
  pf2eProficiencyBonus,
} from './rules/pathfinder2e';
import {
  cocDamageBonusAndBuild,
  cocHalfAndFifth,
  cocHitPoints,
  cocMagicPoints,
  cocMaxSanity,
  cocMoveRate,
} from './rules/callOfCthulhu7e';

const PF2E_SAVE_ATTRIBUTES = {
  fortitude: 'constitution',
  reflex: 'dexterity',
  will: 'wisdom',
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampNumber(value: number, min: number, max?: number): number {
  if (value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function finiteAge(value: unknown): number | undefined {
  const n = finiteNumber(value);
  if (n !== undefined) return n;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function attributeModifier(data: Record<string, unknown>, name: string | null): number {
  if (!name) return 0;
  return finiteNumber(rec(rec(data.attributes)?.[name])?.modifier) ?? 0;
}

/**
 * The initiative bonus named by `initiative.usedStat`.
 *
 * Inlined here rather than imported from rules/initiative.ts: that module
 * projects through this file, and a cycle would make the lookup see a stale
 * sheet.
 */
function pf2eUsedStatBonus(data: Record<string, unknown>): number {
  const usedStat =
    typeof rec(data.initiative)?.usedStat === 'string'
      ? String(rec(data.initiative)!.usedStat)
      : 'perception';

  if (usedStat === 'perception') return finiteNumber(rec(data.perception)?.bonus) ?? 0;

  const skill = rec(rec(data.skills)?.[usedStat]);
  if (skill) return finiteNumber(skill.bonus) ?? 0;

  return finiteNumber(rec(data.perception)?.bonus) ?? 0;
}

function pf2eCheckBonus(
  data: Record<string, unknown>,
  entry: Record<string, unknown>,
  level: number,
  subtractArmorPenalty: boolean
): number {
  const attrMod = attributeModifier(data, pf2eAttributeName(entry.attribute));
  const prof = pf2eProficiencyBonus(level, entry.proficiencyRank);
  const itemBonus = finiteNumber(entry.itemBonus) ?? 0;
  const armorPenalty = subtractArmorPenalty ? (finiteNumber(entry.armorPenalty) ?? 0) : 0;
  return attrMod + prof + itemBonus - armorPenalty;
}

function projectPathfinder2e(data: Record<string, unknown>): Record<string, unknown> {
  let result: Record<string, unknown> | undefined;
  const out = (): Record<string, unknown> => {
    if (!result) result = { ...data };
    return result;
  };
  const sheet = (): Record<string, unknown> => result ?? data;
  const level = finiteNumber(data.level);

  const hp = rec(data.hp);
  const ancestryHp = hp ? finiteNumber(hp.ancestryHp) : undefined;
  const classHpPerLevel = hp ? finiteNumber(hp.classHpPerLevel) : undefined;
  if (hp && level !== undefined && ancestryHp !== undefined && classHpPerLevel !== undefined) {
    const conMod = attributeModifier(data, 'constitution');
    const maximum = clampNumber(ancestryHp + classHpPerLevel * level + conMod * level, 1);
    if (hp.maximum !== maximum) out().hp = { ...hp, maximum };
  }

  if (level !== undefined && rec(data.savingThrows) && rec(data.attributes)) {
    const savesIn = rec(data.savingThrows)!;
    let savesOut: Record<string, unknown> | undefined;
    (Object.keys(PF2E_SAVE_ATTRIBUTES) as Array<keyof typeof PF2E_SAVE_ATTRIBUTES>).forEach((save) => {
      const entry = rec(savesIn[save]);
      if (!entry) return;
      const attrMod = attributeModifier(data, PF2E_SAVE_ATTRIBUTES[save]);
      const bonus = attrMod + pf2eProficiencyBonus(level, entry.proficiencyRank) + (finiteNumber(entry.itemBonus) ?? 0);
      if (entry.bonus === bonus) return;
      if (!savesOut) savesOut = { ...savesIn };
      savesOut[save] = { ...entry, bonus };
    });
    if (savesOut) out().savingThrows = savesOut;
  }

  const perception = rec(data.perception);
  if (perception && level !== undefined && rec(data.attributes)) {
    const bonus =
      attributeModifier(data, 'wisdom') +
      pf2eProficiencyBonus(level, perception.proficiencyRank) +
      (finiteNumber(perception.itemBonus) ?? 0);
    if (perception.bonus !== bonus) out().perception = { ...perception, bonus };
  }

  const skillsIn = rec(data.skills);
  if (skillsIn && level !== undefined && rec(data.attributes)) {
    let skillsOut: Record<string, unknown> | undefined;
    Object.entries(skillsIn).forEach(([name, value]) => {
      const skill = rec(value);
      if (!skill) return;
      const bonus = pf2eCheckBonus(data, skill, level, true);
      if (skill.bonus === bonus) return;
      if (!skillsOut) skillsOut = { ...skillsIn };
      skillsOut[name] = { ...skill, bonus };
    });
    if (skillsOut) out().skills = skillsOut;
  }

  if (Array.isArray(data.loreSkills) && level !== undefined && rec(data.attributes)) {
    let loreChanged = false;
    const loreSkills = data.loreSkills.map((entry) => {
      const item = rec(entry);
      if (!item) return entry;
      const bonus = pf2eCheckBonus(data, item, level, false);
      if (item.bonus === bonus) return entry;
      loreChanged = true;
      return { ...item, bonus };
    });
    if (loreChanged) out().loreSkills = loreSkills;
  }

  const armorClass = rec(data.armorClass);
  if (armorClass && level !== undefined) {
    const total = clampNumber(pf2eArmorClass(data), 10);
    if (armorClass.total !== total) out().armorClass = { ...armorClass, total };
  }

  const classDC = rec(data.classDC);
  if (classDC && level !== undefined) {
    const total = clampNumber(pf2eClassDC(data), 10);
    if (classDC.total !== total) out().classDC = { ...classDC, total };
  }

  const live = sheet();
  const initiative = rec(live.initiative);
  if (initiative) {
    const bonus = pf2eUsedStatBonus(live);
    if (initiative.bonus !== bonus) out().initiative = { ...initiative, bonus };
  }

  const spellcasting = rec(data.spellcasting);
  if (spellcasting && rec(data.attributes) && level !== undefined) {
    const keyName = pf2eAttributeName(spellcasting.keyAttribute) ?? 'intelligence';
    const attrMod = attributeModifier(data, keyName);
    const attack = rec(spellcasting.spellAttackBonus);
    const prof = pf2eProficiencyBonus(level, attack?.proficiencyRank);
    const itemBonus = finiteNumber(attack?.itemBonus) ?? 0;
    const bonus = attrMod + prof + itemBonus;
    const dc = clampNumber(10 + attrMod + prof + itemBonus, 10);
    const nextAttack = attack ? (attack.bonus === bonus ? attack : { ...attack, bonus }) : undefined;
    const spellDC = rec(spellcasting.spellDC);
    const nextDC = spellDC ? (spellDC.dc === dc ? spellDC : { ...spellDC, dc }) : undefined;
    if (nextAttack !== attack || nextDC !== spellDC) {
      out().spellcasting = {
        ...spellcasting,
        ...(nextAttack ? { spellAttackBonus: nextAttack } : {}),
        ...(nextDC ? { spellDC: nextDC } : {}),
      };
    }
  }

  const strMod = finiteNumber(rec(rec(data.attributes)?.strength)?.modifier);
  if (strMod !== undefined) {
    const encumbered = clampNumber(5 + strMod, 0);
    const maximum = clampNumber(10 + strMod, 0);
    const bulk = rec(data.bulk);
    if (bulk) {
      if (bulk.encumbered !== encumbered || bulk.maximum !== maximum) {
        out().bulk = { ...bulk, encumbered, maximum };
      }
    }
  }

  return result ?? data;
}

function characteristicRegular(
  characteristics: Record<string, unknown>,
  key: string
): number | undefined {
  return finiteNumber(rec(characteristics[key])?.regular) ?? finiteNumber(rec(characteristics[key.toLowerCase()])?.regular);
}

function cocMythos(data: Record<string, unknown>): number | undefined {
  const fromSkill = finiteNumber(rec(rec(data.skills)?.cthulhuMythos)?.currentValue);
  if (fromSkill !== undefined) return fromSkill;
  return finiteNumber(rec(data.spellsAndMythos)?.cthulhuMythos);
}

function projectCallOfCthulhu(data: Record<string, unknown>): Record<string, unknown> {
  let result: Record<string, unknown> | undefined;
  const out = (): Record<string, unknown> => {
    if (!result) result = { ...data };
    return result;
  };

  const charsIn = rec(data.characteristics);
  if (charsIn) {
    let charsOut: Record<string, unknown> | undefined;
    Object.entries(charsIn).forEach(([key, value]) => {
      const ch = rec(value);
      if (!ch) return;
      const regular = finiteNumber(ch.regular);
      if (regular === undefined) return;
      const columns = cocHalfAndFifth(regular);
      const half = clampNumber(columns.half, 0, 50);
      const fifth = clampNumber(columns.fifth, 0, 20);
      if (ch.half === half && ch.fifth === fifth) return;
      if (!charsOut) charsOut = { ...charsIn };
      charsOut[key] = { ...ch, half, fifth };
    });
    if (charsOut) out().characteristics = charsOut;
  }

  // A missing, null, or non-object derivedStats stays as stored: inventing a
  // partial object would fail CoC Zod on the next PUT (hp, sanity, magicPoints,
  // luck, damageBonus, build, moveRate, and dodge are all required once present).
  const derivedIn = rec(data.derivedStats);
  if (!derivedIn) return result ?? data;

  let derivedOut: Record<string, unknown> | undefined;
  const setDerived = (key: string, value: unknown): void => {
    if (!derivedOut) derivedOut = { ...derivedIn };
    derivedOut[key] = value;
  };
  const mergeBlock = (key: string, fields: Record<string, unknown>): void => {
    const existing = rec(derivedIn[key]);
    if (!existing) return;
    const differs = Object.keys(fields).some((field) => existing[field] !== fields[field]);
    if (!differs) return;
    setDerived(key, { ...existing, ...fields });
  };
  const setScalar = (key: string, value: string | number): void => {
    if (derivedIn[key] === value) return;
    setDerived(key, value);
  };

  const characteristics = charsIn ?? {};
  const con = characteristicRegular(characteristics, 'CON');
  const siz = characteristicRegular(characteristics, 'SIZ');
  const str = characteristicRegular(characteristics, 'STR');
  const dex = characteristicRegular(characteristics, 'DEX');
  const pow = characteristicRegular(characteristics, 'POW');

  if (con !== undefined && siz !== undefined) {
    const maximum = clampNumber(cocHitPoints(con, siz), 1);
    const majorWoundThreshold = clampNumber(Math.floor(maximum / 2), 1);
    mergeBlock('hp', { maximum, majorWoundThreshold });
  }

  if (pow !== undefined) {
    mergeBlock('magicPoints', { maximum: clampNumber(cocMagicPoints(pow), 0) });
  }

  if (str !== undefined && siz !== undefined) {
    const { damageBonus, build } = cocDamageBonusAndBuild(str, siz);
    setScalar('damageBonus', damageBonus);
    setScalar('build', build);
  }

  const age = finiteAge(data.age);
  if (str !== undefined && dex !== undefined && siz !== undefined && age !== undefined) {
    setScalar('moveRate', clampNumber(cocMoveRate(str, dex, siz, age), 0));
  }

  const mythos = cocMythos(data);
  if (mythos !== undefined) {
    mergeBlock('sanity', { maximum: cocMaxSanity(mythos) });
  }

  const dodgeValue = finiteNumber(rec(rec(data.skills)?.dodge)?.currentValue);
  if (dodgeValue !== undefined) {
    mergeBlock('dodge', { value: clampNumber(dodgeValue, 0, 100) });
  }

  if (derivedOut) out().derivedStats = derivedOut;
  return result ?? data;
}

function projectDnDBonusGroup(
  data: Record<string, unknown>,
  group: 'skills' | 'savingThrows',
  keys: readonly string[],
  bonusOf: (sheet: Record<string, unknown>, key: string) => number
): Record<string, unknown> | undefined {
  const entries = rec(data[group]);
  if (!entries) return undefined;
  let next: Record<string, unknown> | undefined;
  keys.forEach((key) => {
    const entry = rec(entries[key]);
    if (!entry) return;
    if (finiteNumber(entry.otherBonus) === undefined) return;
    const bonus = bonusOf(data, key);
    if (entry.bonus === bonus) return;
    if (!next) next = { ...entries };
    next[key] = { ...entry, bonus };
  });
  return next;
}

function projectDnD5e(data: Record<string, unknown>): Record<string, unknown> {
  const skills = projectDnDBonusGroup(
    data,
    'skills',
    DND5E_SKILLS.map((skill) => skill.key),
    dnd5eSkillBonus
  );
  const savingThrows = projectDnDBonusGroup(data, 'savingThrows', DND5E_ABILITY_NAMES, dnd5eSaveBonus);
  if (!skills && !savingThrows) return data;
  return {
    ...data,
    ...(skills ? { skills } : {}),
    ...(savingThrows ? { savingThrows } : {}),
  };
}

/**
 * The sheet a reader is sent: derived values recomputed from inputs that
 * exist, current resources left as they were stored, out-of-bounds results
 * clamped. Returns `data` unchanged when it is not a plain object or the
 * system has nothing to project. Never mutates the input.
 */
export function projectCharacterData(
  gameSystem: string | null | undefined,
  data: unknown
): unknown {
  if (!isPlainObject(data)) return data;

  switch (gameSystem) {
    case 'PATHFINDER_2E':
      return projectPathfinder2e(data);
    case 'CALL_OF_CTHULHU_7E':
      return projectCallOfCthulhu(data);
    case 'DND_5E':
      return projectDnD5e(data);
    default:
      return data;
  }
}
