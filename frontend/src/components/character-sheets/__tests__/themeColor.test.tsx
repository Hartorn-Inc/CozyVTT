/**
 * The custom header colour on each editable sheet.
 *
 * The server accepts a preset name or a six-digit `#rrggbb` colour that meets
 * 4.5:1 against white header text. The hex box let anything from `#` to six
 * digits through, so a short colour was sent as typed and the whole save was
 * refused. A stored three-digit colour also opened as the default preset and
 * was saved over. Pale custom hex such as `#FFFF00` is refused, not auto-adjusted.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DnD5eCharacterEditor } from '../dnd5e/DnD5eCharacterEditor';
import { DnD5eCharacterView } from '../dnd5e/DnD5eCharacterView';
import { Pathfinder2eCharacterEditor } from '../pathfinder2e/Pathfinder2eCharacterEditor';
import { Pathfinder2eCharacterView } from '../pathfinder2e/Pathfinder2eCharacterView';
import { CallOfCthulhu7eCharacterEditor } from '../call-of-cthulhu-7e/CallOfCthulhu7eCharacterEditor';
import { CallOfCthulhu7eCharacterView } from '../call-of-cthulhu-7e/CallOfCthulhu7eCharacterView';
import { pf2eCharacter } from '../pathfinder2e/__tests__/pf2eFixture';
import { cocCharacter } from '../call-of-cthulhu-7e/__tests__/cocFixture';
import { PALE_HEADER_COLOUR_MESSAGE, customHeaderTextClass } from '@/utils/themeColor';
import type { Character, CharacterData } from '../../../types';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

const ability = { score: 10, modifier: 0 };

function dndCharacter(overrides: Record<string, unknown> = {}): Character {
  return {
    id: 'char-1',
    userId: 'user-1',
    name: 'Aldra',
    gameSystem: 'DND_5E',
    campaignId: null,
    tokenImageUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      characterName: 'Aldra',
      class: 'Fighter',
      level: 1,
      race: 'Human',
      proficiencyBonus: 2,
      stats: {
        strength: ability, dexterity: ability, constitution: ability,
        intelligence: ability, wisdom: ability, charisma: ability,
      },
      ...overrides,
    },
  } as unknown as Character;
}

type EditorProps = {
  character: Character;
  onSave: (data: CharacterData, showToast?: boolean, tokenImageUrl?: string) => Promise<void>;
  onCancel: () => void;
};

const EDITORS: { system: string; Editor: React.FC<EditorProps>; character: (o?: Record<string, unknown>) => Character }[] = [
  { system: 'D&D 5e', Editor: DnD5eCharacterEditor, character: dndCharacter },
  { system: 'Pathfinder 2e', Editor: Pathfinder2eCharacterEditor, character: pf2eCharacter },
  { system: 'Call of Cthulhu 7e', Editor: CallOfCthulhu7eCharacterEditor, character: cocCharacter },
];

function open({ Editor, character }: (typeof EDITORS)[number], sheet: Record<string, unknown> = {}) {
  const onSave = vi.fn<EditorProps['onSave']>().mockResolvedValue(undefined);
  render(<Editor character={character(sheet)} onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByTitle('Change theme color'));
  return onSave;
}

const hexBox = () => screen.getByLabelText('Custom colour hex code') as HTMLInputElement;
const savedColour = (onSave: ReturnType<typeof open>) =>
  (onSave.mock.calls[0][0] as unknown as { themeColor?: string }).themeColor;
const nameBox = () => screen.getByPlaceholderText(/^(Character|Investigator) Name$/);
const paletteButton = () => screen.getByTitle('Change theme color');

/** Near-threshold passing grey, a passing dark, and a stored pale hex. */
const STORED_CUSTOM_COLOURS = ['#737373', '#14532d', '#FFFF00'] as const;

describe.each(EDITORS)('$system custom colour', (entry) => {
  it('saves a three-digit colour as the six-digit form the server accepts', async () => {
    const onSave = open(entry);
    fireEvent.change(hexBox(), { target: { value: '#123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedColour(onSave)).toBe('#112233');
  });

  it('refuses an unfinished colour with a message, and does not save', async () => {
    const onSave = open(entry);
    fireEvent.change(hexBox(), { target: { value: '#12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/#rgb or #rrggbb/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens a stored three-digit colour as that colour', async () => {
    const onSave = open(entry, { themeColor: '#123' });
    expect(hexBox().value).toBe('#112233');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedColour(onSave)).toBe('#112233');
  });

  it('does not save #FFFF00 and shows the pale-colour message', async () => {
    const onSave = open(entry);
    fireEvent.change(hexBox(), { target: { value: '#FFFF00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(PALE_HEADER_COLOUR_MESSAGE)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a preset colour', async () => {
    const onSave = open(entry);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedColour(onSave)).toMatch(/^[A-Za-z]/);
  });

  it('opens a stored #FFFF00 in the hex box', () => {
    open(entry, { themeColor: '#FFFF00' });
    expect(hexBox().value).toBe('#FFFF00');
  });

  it('shows the pale-colour message for a stored #FFFF00 before the picker is opened', () => {
    const { Editor, character } = entry;
    render(<Editor character={character({ themeColor: '#FFFF00' })} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(PALE_HEADER_COLOUR_MESSAGE)).toBeTruthy();
    expect(screen.queryByLabelText('Custom colour hex code')).toBeNull();
  });

  it('paints a custom header as the stored hex, not a translucent gradient', () => {
    open(entry, { themeColor: '#14532d' });
    const name = nameBox();
    const header = name.closest('[style]');
    expect(header?.getAttribute('style') ?? '').toMatch(/background:\s*(#14532d|rgb\(20,\s*83,\s*45\))/i);
    expect(header?.getAttribute('style') ?? '').not.toMatch(/linear-gradient/i);
    expect(name.className).toContain('placeholder:text-white');
    expect(name.className).not.toMatch(/placeholder-current\/50|placeholder:text-white\/50/);
    expect(name.className).toContain('bg-transparent');
    expect(name.className).not.toContain('bg-white/10');
  });

  it('paints black header text for a stored pale custom colour', () => {
    const { Editor, character } = entry;
    render(<Editor character={character({ themeColor: '#FFFF00' })} onSave={vi.fn()} onCancel={vi.fn()} />);
    const name = nameBox();
    expect(name.className).toContain('text-black');
    expect(name.className).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it('paints black header text for a stored mid-tone custom colour', () => {
    const { Editor, character } = entry;
    render(<Editor character={character({ themeColor: '#777777' })} onSave={vi.fn()} onCancel={vi.fn()} />);
    const name = nameBox();
    expect(name.className).toContain('text-black');
    expect(name.className).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it.each(STORED_CUSTOM_COLOURS)('paints the palette control on a transparent current-color surface for %s', (themeColor) => {
    const { Editor, character } = entry;
    render(<Editor character={character({ themeColor })} onSave={vi.fn()} onCancel={vi.fn()} />);
    const button = paletteButton();
    expect(button.className).not.toContain('bg-white/20');
    expect(button.className).not.toContain('bg-white/30');
    expect(button.className).toContain('bg-transparent');
    expect(button.className).toContain('border-current');
  });

  it.each(STORED_CUSTOM_COLOURS)('paints header field borders as current color for %s', (themeColor) => {
    const { Editor, character } = entry;
    render(<Editor character={character({ themeColor })} onSave={vi.fn()} onCancel={vi.fn()} />);
    const name = nameBox();
    expect(name.className).not.toContain('border-white/20');
    expect(name.className).not.toContain('border-white/30');
    expect(name.className).not.toContain('focus:border-white/40');
    expect(name.className).not.toContain('focus:ring-amber-500');
    expect(name.className).toContain('border-current');
    expect(name.className).toContain('focus:ring-2');
    expect(name.className).toContain('focus:ring-current');
  });
});

const VIEWS: { system: string; View: React.FC<{ character: Character }>; character: (o?: Record<string, unknown>) => Character }[] = [
  { system: 'D&D 5e', View: DnD5eCharacterView, character: dndCharacter },
  { system: 'Pathfinder 2e', View: Pathfinder2eCharacterView, character: pf2eCharacter },
  { system: 'Call of Cthulhu 7e', View: CallOfCthulhu7eCharacterView, character: cocCharacter },
];

describe.each(VIEWS)('$system custom colour view', ({ View, character }) => {
  it('paints a custom header as the stored hex, not a translucent gradient', () => {
    render(<View character={character({ themeColor: '#14532d' })} />);
    const header = document.querySelector('[style*="background"]');
    expect(header?.getAttribute('style') ?? '').toMatch(/background:\s*(#14532d|rgb\(20,\s*83,\s*45\))/i);
    expect(header?.getAttribute('style') ?? '').not.toMatch(/linear-gradient/i);
    expect(header?.className).toContain('text-white');
  });

  it('paints black header text for a stored pale custom colour', () => {
    render(<View character={character({ themeColor: '#FFFF00' })} />);
    const header = document.querySelector('[style*="background"]');
    expect(header?.className).toContain('text-black');
    expect(header?.className).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it('paints black header text for a stored mid-tone custom colour', () => {
    render(<View character={character({ themeColor: '#777777' })} />);
    const header = document.querySelector('[style*="background"]');
    expect(header?.className).toContain('text-black');
    expect(header?.className).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });
});

describe('customHeaderTextClass', () => {
  it('uses white when white contrasts more than black', () => {
    expect(customHeaderTextClass('#14532d')).toBe('text-white');
  });

  it('uses black for pale and mid-tone hex that fail against white', () => {
    expect(customHeaderTextClass('#FFFF00')).toBe('text-black');
    expect(customHeaderTextClass('#777777')).toBe('text-black');
    expect(customHeaderTextClass('#808080')).toBe('text-black');
  });
});

describe('Pathfinder custom header chips', () => {
  it('do not sit on a translucent white wash', () => {
    render(<Pathfinder2eCharacterView character={pf2eCharacter({ themeColor: '#737373' })} />);
    const chip = screen.getByText(/Level 1 Fighter/);
    expect(chip.className).not.toMatch(/bg-white\/(?:10|20)/);
  });
});

describe('Call of Cthulhu 7e view has no palette', () => {
  it('does not render a colour picker and still paints a stored custom colour', () => {
    render(
      <CallOfCthulhu7eCharacterView character={cocCharacter({ themeColor: '#14532d' })} />,
    );
    expect(screen.queryByTitle('Change theme color')).toBeNull();
    expect(screen.queryByLabelText('Custom colour hex code')).toBeNull();
    const header = document.querySelector('[style*="background"]');
    expect(header?.getAttribute('style') ?? '').toMatch(
      /background:\s*(#14532d|rgb\(20,\s*83,\s*45\))/i,
    );
  });
});

describe('view Edit control', () => {
  it('shows Edit on D&D, Pathfinder, and Call of Cthulhu views when onEdit is passed', () => {
    const onEdit = vi.fn();
    const { unmount: unmountDnD } = render(
      <DnD5eCharacterView character={dndCharacter()} onEdit={onEdit} />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    unmountDnD();

    const { unmount: unmountPf } = render(
      <Pathfinder2eCharacterView character={pf2eCharacter()} onEdit={onEdit} />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    unmountPf();

    render(<CallOfCthulhu7eCharacterView character={cocCharacter()} onEdit={onEdit} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('shows Call of Cthulhu Edit without a palette button', () => {
    render(
      <CallOfCthulhu7eCharacterView character={cocCharacter()} onEdit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByTitle('Change theme color')).toBeNull();
  });
});
