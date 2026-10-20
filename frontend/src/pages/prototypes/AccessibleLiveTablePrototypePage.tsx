/**
 * PROTOTYPE ONLY — Wayfinder #25.
 *
 * Question: what should an accessible live-table interaction model look like
 * for DM, player, spectator, and admin personas?
 *
 * Three deliberately different variants of a campaign table are switchable
 * with ?variant=A, ?variant=B, or ?variant=C. This route is mounted only by
 * the Vite development build and uses in-memory data.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

type VariantKey = 'A' | 'B' | 'C';
type Role = 'DM' | 'Player' | 'Spectator';
type Viewport = 'Desktop' | 'Narrow';
type CharacterKind = 'Player' | 'NPC';

type VariantOption = {
  key: VariantKey;
  name: string;
  question: string;
};

type PrototypeState = {
  role: Role;
  viewport: Viewport;
  selectedTool: string;
  selectedToken: string;
  selectedInitiative: string;
  lastAction: string;
};

type VariantProps = {
  state: PrototypeState;
  onAction: (message: string, patch?: Partial<PrototypeState>) => void;
};

type Character = {
  name: string;
  initials: string;
  kind: CharacterKind;
  className: string;
  controlledBy: string;
  hp: number;
  maxHp: number;
  armorClass: number;
  conditions: readonly string[];
  position: {
    left: string;
    top: string;
  };
};

const VARIANTS: readonly VariantOption[] = [
  {
    key: 'A',
    name: 'Tool rail',
    question: 'Map-first layout with a persistent keyboard-friendly tool rail.',
  },
  {
    key: 'B',
    name: 'Command deck',
    question: 'Initiative-first layout with a high-signal command strip.',
  },
  {
    key: 'C',
    name: 'Focus table',
    question: 'Single-surface layout with a contextual action tray.',
  },
];

const CHARACTERS: readonly Character[] = [
  {
    name: 'Mira',
    initials: 'M',
    kind: 'Player',
    className: 'Ranger',
    controlledBy: 'Lena',
    hp: 18,
    maxHp: 27,
    armorClass: 15,
    conditions: ['Inspired'],
    position: { left: '22%', top: '30%' },
  },
  {
    name: 'Ash Warden',
    initials: 'A',
    kind: 'NPC',
    className: 'Elite guardian',
    controlledBy: 'DM',
    hp: 42,
    maxHp: 58,
    armorClass: 17,
    conditions: ['Marked'],
    position: { left: '68%', top: '24%' },
  },
  {
    name: 'Pip',
    initials: 'P',
    kind: 'Player',
    className: 'Bard',
    controlledBy: 'Noah',
    hp: 9,
    maxHp: 22,
    armorClass: 13,
    conditions: ['Concentrating', 'Hidden'],
    position: { left: '48%', top: '66%' },
  },
];

const INITIATIVE = [
  { name: 'Mira', initiative: 18, status: 'Your turn', actions: '2 actions' },
  { name: 'Ash Warden', initiative: 14, status: 'Ready', actions: '1 reaction' },
  { name: 'Pip', initiative: 11, status: 'Waiting', actions: '3 actions' },
] as const;

function isVariant(value: string | null): value is VariantKey {
  return VARIANTS.some(({ key }) => key === value);
}

function getVariant(value: string | null): VariantKey {
  return isVariant(value) ? value : 'A';
}

function variantName(key: VariantKey) {
  return VARIANTS.find((variant) => variant.key === key)?.name ?? 'Tool rail';
}

function getCharacter(name: string): Character {
  return CHARACTERS.find((character) => character.name === name) ?? CHARACTERS[0];
}

function HpBar({ character }: { character: Character }) {
  const percentage = Math.max(0, Math.min(100, Math.round((character.hp / character.maxHp) * 100)));

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink-secondary">HP</span>
        <span className="font-semibold text-ink">
          {character.hp}/{character.maxHp}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-danger/15"
        role="progressbar"
        aria-label={`${character.name} hit points`}
        aria-valuemin={0}
        aria-valuemax={character.maxHp}
        aria-valuenow={character.hp}
      >
        <div
          className="h-full rounded-full bg-success transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function ConditionPills({ conditions }: { conditions: readonly string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1" aria-label="Conditions">
      {conditions.map((condition) => (
        <span key={condition} className="badge-neutral">
          {condition}
        </span>
      ))}
    </div>
  );
}

function RoleControl({
  role,
  onChange,
}: {
  role: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="prototype-role" className="text-xs font-semibold text-ink-secondary">
        Persona
      </label>
      <select
        id="prototype-role"
        className="input-cozy max-w-36 py-1.5 text-sm"
        value={role}
        onChange={(event) => onChange(event.target.value as Role)}
      >
        <option>DM</option>
        <option>Player</option>
        <option>Spectator</option>
      </select>
    </div>
  );
}

function ViewportControl({
  viewport,
  onChange,
}: {
  viewport: Viewport;
  onChange: (viewport: Viewport) => void;
}) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">Preview viewport</legend>
      {(['Desktop', 'Narrow'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${
            viewport === option
              ? 'bg-brand text-white'
              : 'bg-brand/10 text-brand hover:bg-brand/20'
          }`}
          aria-pressed={viewport === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}

function PrototypeStatePanel({
  variant,
  state,
}: {
  variant: VariantKey;
  state: PrototypeState;
}) {
  const selectedCharacter = getCharacter(state.selectedToken);

  return (
    <aside
      className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 shadow-sm"
      aria-labelledby="prototype-state-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="prototype-state-heading" className="font-heading text-lg font-bold text-brand-ink">
          Prototype state
        </h2>
        <span className="badge-neutral">read-only demo</span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-ink-secondary">Variant</dt>
        <dd className="font-semibold text-ink">
          {variant} · {variantName(variant)}
        </dd>
        <dt className="text-ink-secondary">Persona</dt>
        <dd className="font-semibold text-ink">{state.role}</dd>
        <dt className="text-ink-secondary">Viewport</dt>
        <dd className="font-semibold text-ink">{state.viewport}</dd>
        <dt className="text-ink-secondary">Tool</dt>
        <dd className="font-semibold text-ink">{state.selectedTool}</dd>
        <dt className="text-ink-secondary">Token</dt>
        <dd className="font-semibold text-ink">{state.selectedToken}</dd>
        <dt className="text-ink-secondary">HP</dt>
        <dd className="font-semibold text-ink">
          {selectedCharacter.hp}/{selectedCharacter.maxHp}
        </dd>
        <dt className="text-ink-secondary">Conditions</dt>
        <dd className="font-semibold text-ink">{selectedCharacter.conditions.join(', ')}</dd>
        <dt className="text-ink-secondary">Initiative</dt>
        <dd className="font-semibold text-ink">{state.selectedInitiative}</dd>
      </dl>
      <p className="alert-info mt-4" role="status" aria-live="polite">
        Last action: {state.lastAction}
      </p>
    </aside>
  );
}

function MapSurface({
  selectedToken,
  onAction,
  compact = false,
}: {
  selectedToken: string;
  onAction: (message: string, patch?: Partial<PrototypeState>) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-cozy border border-brand/20 bg-brand-dark/10 ${
        compact ? 'min-h-64' : 'min-h-[28rem]'
      }`}
      aria-label="Demo map with three selectable tokens"
      role="group"
    >
      <div
        className="absolute inset-0 opacity-50"
        aria-hidden="true"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--color-brand) / 0.14) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-brand) / 0.14) 1px, transparent 1px)',
          backgroundSize: '2rem 2rem',
        }}
      />
      <div className="absolute left-[8%] top-[12%] h-[30%] w-[28%] rounded-xl border-2 border-brand/30 bg-brand/10" />
      <div className="absolute bottom-[10%] right-[8%] h-[34%] w-[30%] rounded-xl border-2 border-accent/40 bg-accent/10" />
      <p className="absolute left-4 top-3 rounded-full bg-paper/85 px-3 py-1 text-xs font-semibold text-ink shadow-sm">
        Moonlit courtyard · current map
      </p>
      {CHARACTERS.map((character) => {
        const selected = character.name === selectedToken;
        return (
          <button
            key={character.name}
            type="button"
            className={`absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-sm font-bold shadow-md transition-transform hover:scale-110 focus:z-10 focus:outline-none focus:ring-4 focus:ring-accent/70 ${
              selected
                ? 'border-accent bg-accent text-accent-text'
                : 'border-brand bg-brand text-white'
            }`}
            style={{ left: character.position.left, top: character.position.top }}
            aria-label={`${character.name}, ${character.kind} token, ${character.hp} of ${character.maxHp} hit points${selected ? ', selected' : ''}`}
            aria-pressed={selected}
            onClick={() =>
              onAction(`${character.name} selected on the map`, {
                selectedToken: character.name,
              })
            }
          >
            {character.initials}
          </button>
        );
      })}
    </div>
  );
}

function CharacterRoster({
  selectedToken,
  onAction,
  compact = false,
}: {
  selectedToken: string;
  onAction: (message: string, patch?: Partial<PrototypeState>) => void;
  compact?: boolean;
}) {
  return (
    <section aria-labelledby="character-roster-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="character-roster-heading" className="font-heading text-lg font-bold text-brand-ink">
            Characters on the table
          </h2>
          <p className="text-sm text-ink-secondary">
            The selected token, HP, conditions, and control owner stay visible outside the map.
          </p>
        </div>
        <span className="badge-neutral">{CHARACTERS.length} active</span>
      </div>
      <div className={`mt-3 grid gap-3 ${compact ? 'sm:grid-cols-3' : 'md:grid-cols-3'}`}>
        {CHARACTERS.map((character) => {
          const selected = character.name === selectedToken;
          return (
            <button
              key={character.name}
              type="button"
              className={`min-h-36 rounded-cozy border p-3 text-left shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
                selected
                  ? 'border-accent bg-accent/15'
                  : 'border-ink-muted/20 bg-paper/70 hover:border-brand/50'
              }`}
              aria-label={`${character.name}, ${character.className}, ${character.hp} of ${character.maxHp} hit points`}
              aria-pressed={selected}
              onClick={() =>
                onAction(`${character.name} selected in character roster`, {
                  selectedToken: character.name,
                })
              }
            >
              <span className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-semibold text-ink">{character.name}</span>
                  <span className="block text-xs text-ink-secondary">
                    {character.className} · AC {character.armorClass}
                  </span>
                </span>
                <span className="badge-neutral">{character.kind}</span>
              </span>
              <HpBar character={character} />
              <ConditionPills conditions={character.conditions} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CharacterSheetPanel({
  selectedToken,
  onAction,
}: {
  selectedToken: string;
  onAction: (message: string, patch?: Partial<PrototypeState>) => void;
}) {
  const character = getCharacter(selectedToken);

  return (
    <section
      className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 shadow-sm"
      aria-labelledby="character-sheet-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Selected character</p>
          <h2 id="character-sheet-heading" className="font-heading text-xl font-bold text-brand-ink">
            {character.name}
          </h2>
          <p className="text-sm text-ink-secondary">
            {character.className} · controlled by {character.controlledBy}
          </p>
        </div>
        <span className="badge-neutral">sheet summary</span>
      </div>
      <HpBar character={character} />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-cozy bg-brand/10 p-3">
          <dt className="text-xs text-ink-secondary">Armor class</dt>
          <dd className="mt-1 text-lg font-bold text-ink">{character.armorClass}</dd>
        </div>
        <div className="rounded-cozy bg-brand/10 p-3">
          <dt className="text-xs text-ink-secondary">Control</dt>
          <dd className="mt-1 font-semibold text-ink">{character.controlledBy}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <p className="text-xs font-semibold text-ink-secondary">Conditions</p>
        <ConditionPills conditions={character.conditions} />
      </div>
      <button
        type="button"
        className="mt-4 min-h-11 w-full rounded-cozy border border-brand/30 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-accent"
        onClick={() => onAction(`${character.name} character sheet preview opened`)}
      >
        Open character sheet preview
      </button>
    </section>
  );
}

function ToolButton({
  label,
  selected,
  onClick,
  shortcut,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  shortcut: string;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-cozy px-3 py-2 text-left text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
        selected ? 'bg-brand text-white' : 'bg-brand/10 text-brand hover:bg-brand/20'
      }`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{label}</span>
      <kbd
        className={`rounded border px-1.5 py-0.5 text-[10px] ${
          selected ? 'border-white/40 text-white/80' : 'border-brand/20 text-ink-secondary'
        }`}
      >
        {shortcut}
      </kbd>
    </button>
  );
}

function InitiativeList({
  selectedInitiative,
  onAction,
  compact = false,
}: {
  selectedInitiative: string;
  onAction: (message: string, patch?: Partial<PrototypeState>) => void;
  compact?: boolean;
}) {
  return (
    <ol className={`space-y-2 ${compact ? '' : 'mt-3'}`}>
      {INITIATIVE.map((entry, index) => {
        const selected = entry.name === selectedInitiative;
        const character = getCharacter(entry.name);
        return (
          <li key={entry.name}>
            <button
              type="button"
              className={`flex min-h-14 w-full items-center gap-3 rounded-cozy border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
                selected
                  ? 'border-accent bg-accent/15'
                  : 'border-ink-muted/20 bg-paper/60 hover:border-brand/40'
              }`}
              aria-pressed={selected}
              onClick={() =>
                onAction(`${entry.name} selected in initiative`, {
                  selectedInitiative: entry.name,
                })
              }
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{entry.name}</span>
                <span className="block text-xs text-ink-secondary">
                  {character.className} · initiative {entry.initiative} · {entry.actions}
                </span>
                <HpBar character={character} />
                <ConditionPills conditions={character.conditions} />
              </span>
              <span className="shrink-0 text-right text-xs text-ink-secondary">{entry.status}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function VariantA({ state, onAction }: VariantProps) {
  const tools = [
    ['Select', 'S'],
    ['Pan map', 'Space'],
    ['Measure', 'M'],
    ['Fog', 'F'],
  ];

  return (
    <section aria-labelledby="variant-a-heading" className="grid min-w-0 gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_18rem]">
      <nav className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-3 shadow-sm" aria-label="Map tools">
        <h2 id="variant-a-heading" className="font-heading text-lg font-bold text-brand-ink">
          Tool rail
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">Persistent controls stay reachable without right-click.</p>
        <div className="mt-4 space-y-2">
          {tools.map(([label, shortcut]) => (
            <ToolButton
              key={label}
              label={label}
              shortcut={shortcut}
              selected={state.selectedTool === label}
              onClick={() => onAction(`${label} tool activated`, { selectedTool: label })}
            />
          ))}
        </div>
        <button
          type="button"
          className="mt-4 min-h-11 w-full rounded-cozy border border-brand/30 px-3 py-2 text-left text-sm font-semibold text-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-accent"
          onClick={() => onAction('Map help opened')}
        >
          Keyboard help
        </button>
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Variant A</p>
            <h2 className="font-heading text-2xl font-bold text-ink">Map-first table</h2>
          </div>
          <button
            type="button"
            className="min-h-11 rounded-cozy bg-accent px-4 py-2 font-semibold text-accent-text shadow-sm hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-brand"
            onClick={() => onAction('Turn ended; next actor is Ash Warden')}
          >
            End turn
          </button>
        </div>
        <MapSurface selectedToken={state.selectedToken} onAction={onAction} />
        <CharacterRoster selectedToken={state.selectedToken} onAction={onAction} compact />
        <div className="flex flex-wrap gap-2 rounded-cozy border border-ink-muted/20 bg-paper/70 p-3">
          {['Ping map', 'Open chat', 'Center on selected'].map((action) => (
            <button
              key={action}
              type="button"
              className="min-h-11 rounded-full border border-brand/30 px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-accent"
              onClick={() => onAction(`${action} action activated`)}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      <aside className="space-y-4 rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 shadow-sm">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-bold text-brand-ink">Initiative</h2>
            <span className="badge-success">live</span>
          </div>
          <InitiativeList selectedInitiative={state.selectedInitiative} onAction={onAction} />
        </div>
        <div className="border-t border-ink-muted/20 pt-4">
          <h2 className="font-heading text-lg font-bold text-brand-ink">Accessible status</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            The current action is announced in the live status region and remains visible in the state panel.
          </p>
        </div>
      </aside>
    </section>
  );
}

function VariantB({ state, onAction }: VariantProps) {
  return (
    <section aria-labelledby="variant-b-heading" className="space-y-4">
      <div className="rounded-cozy border border-brand/20 bg-brand-dark p-4 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Variant B</p>
            <h2 id="variant-b-heading" className="font-heading text-2xl font-bold">Command deck</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Previous', 'Next', 'Pause table'].map((action) => (
              <button
                key={action}
                type="button"
                className="min-h-11 rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent"
                onClick={() => onAction(`${action} command activated`)}
              >
                {action}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Table status">
          {[
            ['Current turn', 'Mira'],
            ['Map', 'Moonlit courtyard'],
            ['Connection', 'All players synced'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-cozy bg-white/10 px-3 py-2">
              <p className="text-xs text-white/70">{label}</p>
              <p className="font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <aside className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 shadow-sm" aria-labelledby="queue-heading">
          <h2 id="queue-heading" className="font-heading text-xl font-bold text-brand-ink">
            Turn queue
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">The primary path is selecting a turn, not finding a map tool.</p>
          <InitiativeList
            selectedInitiative={state.selectedInitiative}
            onAction={onAction}
            compact
          />
          <button
            type="button"
            className="mt-3 min-h-11 w-full rounded-cozy bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-accent"
            onClick={() => onAction('Initiative editor opened')}
          >
            Edit initiative
          </button>
        </aside>

        <div className="min-w-0 space-y-4">
          <MapSurface selectedToken={state.selectedToken} onAction={onAction} compact />
          <CharacterRoster selectedToken={state.selectedToken} onAction={onAction} compact />
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Move selected token', 'Uses arrow keys after focus.'],
              ['Roll selected action', 'Results announce without stealing focus.'],
            ].map(([title, description]) => (
              <button
                key={title}
                type="button"
                className="min-h-24 rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 text-left shadow-sm hover:border-brand/50 focus:outline-none focus:ring-2 focus:ring-accent"
                onClick={() => onAction(`${title} command activated`)}
              >
                <span className="block font-semibold text-ink">{title}</span>
                <span className="mt-1 block text-sm text-ink-secondary">{description}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4 shadow-sm" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="font-heading text-xl font-bold text-brand-ink">
            Activity
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            <li className="border-l-2 border-brand pl-3">
              <strong className="block text-ink">Mira moved</strong>
              <span className="text-ink-secondary">a token into the courtyard</span>
            </li>
            <li className="border-l-2 border-accent pl-3">
              <strong className="block text-ink">Ash Warden is ready</strong>
              <span className="text-ink-secondary">initiative is waiting</span>
            </li>
            <li className="border-l-2 border-info pl-3">
              <strong className="block text-ink">Pip reconnected</strong>
              <span className="text-ink-secondary">state was refreshed</span>
            </li>
          </ul>
          <button
            type="button"
            className="mt-4 min-h-11 w-full rounded-cozy border border-brand/30 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-accent"
            onClick={() => onAction('Activity history expanded')}
          >
            Show full history
          </button>
        </aside>
      </div>
    </section>
  );
}

function VariantC({ state, onAction }: VariantProps) {
  return (
    <section aria-labelledby="variant-c-heading" className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Variant C</p>
          <h2 id="variant-c-heading" className="font-heading text-3xl font-bold text-ink">
            Focus table
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            One clear surface, then a contextual tray for the selected thing. Good for small screens and reduced cognitive load.
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-full bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-accent"
          onClick={() => onAction('Focus moved to the map')}
        >
          Focus map
        </button>
      </div>

      <div className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-muted/20 pb-3">
          <div>
            <p className="text-xs text-ink-secondary">Current turn</p>
            <p className="font-heading text-xl font-bold text-brand-ink">{state.selectedInitiative}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Inspect', 'Move', 'Roll'].map((tool) => (
              <button
                key={tool}
                type="button"
                className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent ${
                  state.selectedTool === tool
                    ? 'bg-accent text-accent-text'
                    : 'border border-brand/30 text-brand hover:bg-brand/10'
                }`}
                aria-pressed={state.selectedTool === tool}
                onClick={() => onAction(`${tool} context action selected`, { selectedTool: tool })}
              >
                {tool}
              </button>
            ))}
          </div>
        </div>
        <div className="py-3">
          <MapSurface selectedToken={state.selectedToken} onAction={onAction} compact />
        </div>
        <div className="grid gap-3 border-t border-ink-muted/20 pt-3 sm:grid-cols-3">
          <button
            type="button"
            className="min-h-16 rounded-cozy bg-brand/10 p-3 text-left hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-accent"
            onClick={() => onAction('Context inspector opened')}
          >
            <span className="block font-semibold text-brand">Inspect selected</span>
            <span className="mt-1 block text-xs text-ink-secondary">Name, visibility, and permissions</span>
          </button>
          <button
            type="button"
            className="min-h-16 rounded-cozy bg-brand/10 p-3 text-left hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-accent"
            onClick={() => onAction('Accessible action list opened')}
          >
            <span className="block font-semibold text-brand">More actions</span>
            <span className="mt-1 block text-xs text-ink-secondary">Never hidden behind a context menu</span>
          </button>
          <button
            type="button"
            className="min-h-16 rounded-cozy bg-brand/10 p-3 text-left hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-accent"
            onClick={() => onAction('Chat composer focused')}
          >
            <span className="block font-semibold text-brand">Chat</span>
            <span className="mt-1 block text-xs text-ink-secondary">Persistent, labelled composer</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <CharacterRoster selectedToken={state.selectedToken} onAction={onAction} compact />
        <CharacterSheetPanel selectedToken={state.selectedToken} onAction={onAction} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4">
          <h2 className="font-heading text-lg font-bold text-brand-ink">Focus order</h2>
          <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-ink-secondary">
            <li>Current turn and primary action</li>
            <li>Map and selected token</li>
            <li>Contextual actions</li>
            <li>Chat and secondary utilities</li>
          </ol>
        </div>
        <div className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4">
          <h2 className="font-heading text-lg font-bold text-brand-ink">Responsive question</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Switch the preview to Narrow. Does the single-surface tray preserve the DM and player workflows without a desktop-only gate?
          </p>
        </div>
      </div>
    </section>
  );
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: VariantKey;
  onChange: (variant: VariantKey) => void;
}) {
  const index = VARIANTS.findIndex(({ key }) => key === current);
  const cycle = (offset: number) => {
    const nextIndex = (index + offset + VARIANTS.length) % VARIANTS.length;
    onChange(VARIANTS[nextIndex].key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        cycle(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <nav
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-brand/30 bg-brand-dark px-3 py-2 text-white shadow-2xl"
      aria-label="Prototype variant switcher"
    >
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label="Previous prototype variant"
        onClick={() => cycle(-1)}
      >
        <span aria-hidden="true">←</span>
      </button>
      <span className="min-w-0 max-w-32 truncate text-center text-sm font-semibold sm:min-w-36 sm:max-w-none">
        {current} · {variantName(current)}
      </span>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label="Next prototype variant"
        onClick={() => cycle(1)}
      >
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}

export default function AccessibleLiveTablePrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variant = getVariant(searchParams.get('variant'));
  const [state, setState] = useState<PrototypeState>({
    role: 'DM',
    viewport: 'Desktop',
    selectedTool: 'Select',
    selectedToken: 'Mira',
    selectedInitiative: 'Mira',
    lastAction: 'Prototype loaded',
  });

  const onAction = (message: string, patch: Partial<PrototypeState> = {}) => {
    setState((previous) => ({
      ...previous,
      ...patch,
      lastAction: message,
    }));
  };

  const onVariantChange = (nextVariant: VariantKey) => {
    setSearchParams({ variant: nextVariant }, { replace: true });
    onAction(`Switched to variant ${nextVariant} · ${variantName(nextVariant)}`);
  };

  const viewportClass =
    state.viewport === 'Narrow'
      ? 'w-full max-w-[430px] ring-4 ring-accent/20'
      : 'w-full max-w-[1600px]';

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-soft-cream via-parchment to-warm-amber/20 px-4 pb-28 pt-6 text-ink sm:px-6">
      <a
        href="#prototype-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-cozy focus:bg-brand focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-accent"
      >
        Skip to prototype
      </a>
      <div className={`mx-auto transition-all ${viewportClass}`}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Wayfinder #25 · prototype only</p>
            <h1 className="font-heading text-3xl font-bold text-brand-ink">Accessible live-table interaction</h1>
            <p className="mt-1 max-w-3xl text-sm text-ink-secondary">
              Compare three structural models before deciding what should become production UI. Nothing here saves data or sends a socket event.
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-3 rounded-cozy border border-ink-muted/20 bg-paper/70 p-3 shadow-sm">
            <RoleControl
              role={state.role}
              onChange={(role) => onAction(`Persona changed to ${role}`, { role })}
            />
            <ViewportControl
              viewport={state.viewport}
              onChange={(viewport) => onAction(`Preview viewport changed to ${viewport}`, { viewport })}
            />
          </div>
        </header>

        <main id="prototype-main" className="mt-6 rounded-cozy p-1">
          {variant === 'A' && <VariantA state={state} onAction={onAction} />}
          {variant === 'B' && <VariantB state={state} onAction={onAction} />}
          {variant === 'C' && <VariantC state={state} onAction={onAction} />}
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="rounded-cozy border border-ink-muted/20 bg-paper/70 p-4">
              <h2 className="font-heading text-lg font-bold text-brand-ink">Question for the reviewer</h2>
              <p className="mt-2 text-sm text-ink-secondary">
                {VARIANTS.find(({ key }) => key === variant)?.question}
              </p>
              <p className="mt-3 text-xs text-ink-muted">
                Use Tab, Shift+Tab, Enter, Space, and ←/→ on the variant switcher. Try each persona and the Narrow preview.
              </p>
            </div>
            <PrototypeStatePanel variant={variant} state={state} />
          </div>
        </main>
      </div>
      <PrototypeSwitcher current={variant} onChange={onVariantChange} />
    </div>
  );
}
