/**
 * The Flexible editor stops adding sections, stats, items, rows and columns
 * where the server stops keeping them.
 *
 * The server refuses a Flexible sheet past FLEXIBLE_MAX_*; an add button past
 * that made a sheet that could be filled in and not saved. Here the limits are
 * two, so two entries fill a list.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Character } from '@/types';
import type { FlexibleSection } from '@/types/flexible-character-sheet';
import { FlexibleCharacterSheetEdit } from '../flexible/FlexibleCharacterSheetEdit';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));
vi.mock('@/constants/sheetLimits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/constants/sheetLimits')>()),
  FLEXIBLE_MAX_SECTIONS: 2,
  FLEXIBLE_MAX_FIELDS: 2,
  FLEXIBLE_MAX_ROWS: 2,
  FLEXIBLE_MAX_COLUMNS: 2,
}));

const FULL = /This list is full: a sheet holds at most 2 entries here/;

function characterWith(sections: FlexibleSection[]): Character {
  return {
    id: 'flex-1',
    userId: 'user-1',
    name: 'Freeform',
    gameSystem: null,
    campaignId: null,
    tokenImageUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: { sections },
  } as unknown as Character;
}

function open(sections: FlexibleSection[]) {
  render(<FlexibleCharacterSheetEdit character={characterWith(sections)} onSave={vi.fn()} onCancel={vi.fn()} />);
}

const stat = (id: string, name: string) => ({ id, name, value: 10, modifier: 0 });
const item = (id: string, text: string) => ({ id, text, checked: false });
const column = (id: string, name: string) => ({ id, name });
const row = (id: string, cells: Record<string, string>) => ({ id, cells });

const statsSection = (fields: ReturnType<typeof stat>[]): FlexibleSection => ({
  id: 's-stats', title: 'Stats', type: 'stats', fields,
});
const listSection = (items: ReturnType<typeof item>[]): FlexibleSection => ({
  id: 's-list', title: 'Kit', type: 'list', items,
});
const tableSection = (
  columns: ReturnType<typeof column>[],
  rows: ReturnType<typeof row>[],
): FlexibleSection => ({
  id: 's-table', title: 'Gear', type: 'table', columns, rows,
});
const textSection = (id: string, title: string): FlexibleSection => ({
  id, title, type: 'text', value: '',
});

describe('Add Section', () => {
  it('turns its add button off at the limit, and says why', () => {
    open([textSection('a', 'One'), textSection('b', 'Two')]);
    expect(screen.getByRole('button', { name: 'Add Section' })).toBeDisabled();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });

  it('keeps its add button on while there is room', () => {
    open([textSection('a', 'One')]);
    expect(screen.getByRole('button', { name: 'Add Section' })).toBeEnabled();
    expect(screen.queryByText(FULL)).toBeNull();
  });
});

describe('Add Stat', () => {
  it('turns its add button off at the limit, and says why', () => {
    open([statsSection([stat('f1', 'Str'), stat('f2', 'Dex')])]);
    expect(screen.getByRole('button', { name: 'Add Stat' })).toBeDisabled();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });

  it('keeps its add button on while there is room', () => {
    open([statsSection([stat('f1', 'Str')])]);
    expect(screen.getByRole('button', { name: 'Add Stat' })).toBeEnabled();
    expect(screen.queryByText(FULL)).toBeNull();
  });
});

describe('Add Item', () => {
  it('turns its add button off at the limit, and says why', () => {
    open([listSection([item('i1', 'Rope'), item('i2', 'Torch')])]);
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeDisabled();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });

  it('keeps its add button on while there is room', () => {
    open([listSection([item('i1', 'Rope')])]);
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeEnabled();
    expect(screen.queryByText(FULL)).toBeNull();
  });
});

describe('Add Row', () => {
  it('turns its add button off at the limit, and says why', () => {
    open([tableSection([column('c1', 'Item')], [row('r1', { c1: 'Sword' }), row('r2', { c1: 'Axe' })])]);
    expect(screen.getByRole('button', { name: 'Add Row' })).toBeDisabled();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });

  it('keeps its add button on while there is room', () => {
    open([tableSection([column('c1', 'Item')], [row('r1', { c1: 'Sword' })])]);
    expect(screen.getByRole('button', { name: 'Add Row' })).toBeEnabled();
    expect(screen.queryByText(FULL)).toBeNull();
  });
});

describe('Add Column', () => {
  it('turns its add button off at the limit, and says why', () => {
    open([
      tableSection(
        [column('c1', 'Item'), column('c2', 'Qty')],
        [row('r1', { c1: 'Sword', c2: '1' })],
      ),
    ]);
    expect(screen.getByRole('button', { name: 'Add column' })).toBeDisabled();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });

  it('keeps its add button on while there is room', () => {
    open([tableSection([column('c1', 'Item')], [row('r1', { c1: 'Sword' })])]);
    expect(screen.getByRole('button', { name: 'Add column' })).toBeEnabled();
    expect(screen.queryByText(FULL)).toBeNull();
  });
});
