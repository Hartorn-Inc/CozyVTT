/**
 * Shipped starter templates keep feature, feat, and skill names and drop
 * rules prose (ADR 0013 / issue #61).
 *
 * Expected values are literals in this file. Do not recompute "is this rules
 * prose?" with a production helper.
 */

import { getAllTemplates } from '..';
import { dnd5eFighterTemplate } from '../dnd5e-templates';
import { pf2eFighterTemplate } from '../pathfinder2e-templates';
import { coc7ePrivateInvestigatorTemplate } from '../callOfCthulhu7e-templates';
import { shadowrun6eStreetsamurai } from '../shadowrun6e-templates';

type NamedEntry = {
  name?: unknown;
  description?: unknown;
  notes?: unknown;
};

/** Rules-prose blocks that used to ship on starters and must now be gone. */
const DROPPED_RULES_PROSE = [
  'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level. Once you use this feature, you must finish a short or long rest before you can use it again.',
  'While you are wearing armor, you gain a +1 bonus to AC.',
  'You can see in darkness and dim light as well as you can see in bright light.',
  'Make a melee Strike. The Strike deals two extra weapon damage dice.',
  'You can make melee Strikes against creatures that move adjacent to you or take certain actions.',
  'You can use your shield to prevent damage.',
  'Hardness 5, HP 20, BT 10',
  'AC +3, Dex Cap +2',
  'AC 16, Heavy Armor',
  '+2 AC',
  'Versatile (1d8/1d10)',
  'Damage includes damage bonus',
  'No penalty for using off-hand weapon',
  '+1 Reaction, +1d6 Initiative',
  'Low-light vision, Image Link, Smartlink',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function namedList(value: unknown): NamedEntry[] {
  return Array.isArray(value) ? (value as NamedEntry[]) : [];
}

function featureLikeFields(data: Record<string, unknown>): Array<{
  path: string;
  name: unknown;
  text: string;
}> {
  const found: Array<{ path: string; name: unknown; text: string }> = [];

  const collect = (list: unknown, listPath: string) => {
    namedList(list).forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null) return;
      found.push({
        path: `${listPath}[${i}].description`,
        name: entry.name,
        text: typeof entry.description === 'string' ? entry.description : '',
      });
      found.push({
        path: `${listPath}[${i}].notes`,
        name: entry.name,
        text: typeof entry.notes === 'string' ? entry.notes : '',
      });
    });
  };

  collect(data.featuresAndTraits, 'featuresAndTraits');
  collect(data.classFeatures, 'classFeatures');
  collect(data.qualities, 'qualities');
  collect(data.augmentations, 'augmentations');
  collect(data.inventory, 'inventory');
  collect(data.gear, 'gear');

  const feats = asRecord(data.feats);
  if (feats) {
    for (const [category, list] of Object.entries(feats)) {
      collect(list, `feats.${category}`);
    }
  }

  return found;
}

function isInventoryOrGearPath(path: string): boolean {
  return path.startsWith('inventory[') || path.startsWith('gear[');
}

describe('shipped starter templates drop rules prose', () => {
  it("keeps D&D fighter feature names with empty descriptions", () => {
    const features = namedList(dnd5eFighterTemplate.data.featuresAndTraits);
    expect(features.map((f) => f.name)).toEqual(['Second Wind', 'Fighting Style: Defense']);
    expect(features.map((f) => f.description)).toEqual(['', '']);
  });

  it('keeps PF2e class feature and feat names with empty descriptions and notes', () => {
    const classFeatures = namedList(pf2eFighterTemplate.data.classFeatures);
    expect(classFeatures.map((f) => f.name)).toEqual(['Attack of Opportunity', 'Shield Block']);
    expect(classFeatures.map((f) => f.description)).toEqual(['', '']);

    const feats = asRecord(pf2eFighterTemplate.data.feats);
    const ancestry = namedList(feats?.ancestryAndHeritage);
    const classFeats = namedList(feats?.class);
    expect(ancestry.map((f) => f.name)).toEqual(['Darkvision']);
    expect(ancestry.map((f) => f.notes)).toEqual(['']);
    expect(classFeats.map((f) => f.name)).toEqual(['Power Attack']);
    expect(classFeats.map((f) => f.notes)).toEqual(['']);
  });

  it('keeps skill and feature name keys on shipped starters', () => {
    expect(asRecord(dnd5eFighterTemplate.data.skills)).toHaveProperty('athletics');
    expect(namedList(dnd5eFighterTemplate.data.featuresAndTraits).map((f) => f.name)).toContain(
      'Second Wind',
    );

    expect(asRecord(pf2eFighterTemplate.data.skills)).toHaveProperty('athletics');
    expect(namedList(pf2eFighterTemplate.data.classFeatures).map((f) => f.name)).toContain(
      'Attack of Opportunity',
    );

    expect(asRecord(coc7ePrivateInvestigatorTemplate.data.skills)).toHaveProperty('spotHidden');
    expect(asRecord(coc7ePrivateInvestigatorTemplate.data.skills)).toHaveProperty('libraryUse');

    expect(asRecord(shadowrun6eStreetsamurai.data.skills)).toHaveProperty('firearms');
    expect(namedList(shadowrun6eStreetsamurai.data.knowledgeSkills).map((s) => s.name)).toEqual([
      'Street Gangs',
      'Security Procedures',
    ]);
    expect(namedList(shadowrun6eStreetsamurai.data.qualities).map((q) => q.name)).toContain(
      'Ambidextrous',
    );
  });

  it('empties mechanical inventory and weapon notes that were rules prose', () => {
    const dndInventory = namedList(dnd5eFighterTemplate.data.inventory);
    expect(dndInventory.find((item) => item.name === 'Chain Mail')?.notes).toBe('');
    expect(dndInventory.find((item) => item.name === 'Shield')?.notes).toBe('');
    expect(dndInventory.find((item) => item.name === 'Longsword')?.notes).toBe('');

    const pfInventory = namedList(pf2eFighterTemplate.data.inventory);
    expect(pfInventory.find((item) => item.name === 'Steel Shield')?.notes).toBe('');
    expect(pfInventory.find((item) => item.name === 'Scale Mail')?.notes).toBe('');

    const weapons = namedList(asRecord(coc7ePrivateInvestigatorTemplate.data.combat)?.weapons);
    expect(weapons.find((weapon) => weapon.name === 'Fists/Punch')?.notes).toBe('');
  });

  it('leaves no rules-prose block on feature, feat, classFeature, quality, augmentation, or inventory text', () => {
    const leftovers: string[] = [];

    for (const template of Object.values(getAllTemplates()).flat()) {
      for (const field of featureLikeFields(template.data)) {
        if (field.text.trim() === '') continue;
        // Inventory and gear may keep flavor notes; fail only on the dropped
        // rules-prose literals. Augmentations and feature-like fields must be empty.
        if (isInventoryOrGearPath(field.path)) {
          if ((DROPPED_RULES_PROSE as readonly string[]).includes(field.text)) {
            leftovers.push(`${template.name} ${field.path} (${String(field.name)}): ${field.text}`);
          }
          continue;
        }
        leftovers.push(`${template.name} ${field.path} (${String(field.name)}): ${field.text}`);
      }
    }

    expect(leftovers).toEqual([]);
  });

  it('does not still ship the dropped rules-prose strings on those fields', () => {
    const remaining: string[] = [];

    for (const template of Object.values(getAllTemplates()).flat()) {
      for (const field of featureLikeFields(template.data)) {
        if ((DROPPED_RULES_PROSE as readonly string[]).includes(field.text)) {
          remaining.push(`${template.name} ${field.path}: ${field.text}`);
        }
      }
    }

    expect(remaining).toEqual([]);
  });
});
