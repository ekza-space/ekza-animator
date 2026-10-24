// The Target panel (CHARACTER-CONTRACT-SPEC §8.4, §9 F2; C1): a lazy panel next to Clips (Windows › Target). For the
// active character: *For: <game> · <character> ▾* binds it to a game character of the bundled contract; then the slot
// checklist of that character in the game's order — ● yours, ○ game default, ⚠ to fix (with the contract's reason),
// ⊘ missing, ◌ fixed (opens in a later contract) — with the timing to aim for, and per row: *Game default ▶* (a
// preview of the default where the starter pack has it), *From library ▾* (Use Clip into the slot), *Use clip ▾* (a
// clip of the character), *Same as ▾* (reuse another slot's clip), *Use default* (clear). A row's name activates its
// clip. Clips the game will not use are listed with *Map to slot ▾*. Every change is one `target.*` / Use Clip step.
import type { CharacterId, ClipId, ClipRecord } from '@ekza-studio/doc';
import type { EditorApp, SessionState, TargetKit } from '@ekza-studio/editor-core';
import type { ContractModel } from '@ekza-studio/io';
import { type JSX, useMemo, useState } from 'react';
import { useSession } from '../../hooks';
import { runUntypedOperator } from '../channels/kit/run';
import { BUTTON, EMPTY_STATE, MUTED_TEXT, PANEL_ROOT, PRIMARY_BUTTON, SELECT, TOOLBAR } from '../channels/kit/styles';
import type { PanelProps } from '../types';
import {
  BUNDLED_GAMES,
  libraryClipForDefault,
  summaryText,
  useLatestContract,
  useLibraryManifest,
  usePreviewClip,
  useStoreVersion,
  useTargetKit,
} from './state';

const PANEL_KIND = 'target';

type Statuses = NonNullable<ReturnType<TargetKit['slotStatuses']>>;
type Row = Statuses['rows'][number];

const GLYPH: Readonly<Record<Row['status']['kind'], string>> = {
  custom: '●',
  invalid: '⚠',
  default: '○',
  missing: '⊘',
  fixed: '◌',
};
const GLYPH_CLASS: Readonly<Record<Row['status']['kind'], string>> = {
  custom: 'text-[var(--accent-text,#a996ff)]',
  invalid: 'text-[var(--warning,#e8b04a)]',
  default: 'text-fg-3',
  missing: 'text-[var(--danger,#ef6b6b)]',
  fixed: 'text-fg-3',
};
const STATUS_TEXT: Readonly<Record<Row['status']['kind'], string>> = {
  custom: 'yours',
  invalid: 'to fix',
  default: 'game default',
  missing: 'missing',
  fixed: 'fixed',
};

const selectCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const IDENTITY_IN_PLACE = { speed: 1, trim: null, mirror: false, inPlace: true, armSpace: 0 } as const;

const run = (app: EditorApp, id: string, args: unknown) => void runUntypedOperator(app, PANEL_KIND, id, args);

function Picker(props: {
  readonly app: EditorApp;
  readonly kit: TargetKit;
  readonly character: CharacterId;
  readonly current: { readonly game: string; readonly gameCharacter: string } | null;
}): JSX.Element {
  const { app, kit, character, current } = props;
  const [game, setGame] = useState(current?.game ?? BUNDLED_GAMES[0] ?? 'omoba');
  const contract = useLatestContract(app, kit, game);
  const [choice, setChoice] = useState<string>(current?.gameCharacter ?? '');
  const model = contract.status === 'ready' ? contract.value : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="target-picker">
      <span className="text-fg-2">For:</span>
      <select
        className={SELECT}
        aria-label="Game"
        value={game}
        data-testid="target-game"
        onChange={(event) => setGame(event.currentTarget.value)}
      >
        {BUNDLED_GAMES.map((id) => (
          <option key={id} value={id}>
            {model !== null && model.game === id ? model.gameName : id}
          </option>
        ))}
      </select>
      <select
        className={`${SELECT} min-w-32`}
        aria-label="Game character"
        value={choice}
        disabled={model === null}
        data-testid="target-game-character"
        onChange={(event) => setChoice(event.currentTarget.value)}
      >
        <option value="">Choose a character…</option>
        {(model?.characters ?? []).map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
            {entry.subtitle === null ? '' : ` (${entry.subtitle})`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={PRIMARY_BUTTON}
        disabled={model === null || choice === '' || (current?.gameCharacter === choice && current.game === game)}
        data-testid="target-bind"
        onClick={() => run(app, 'target.bind', { character, game, gameCharacter: choice })}
      >
        {current === null ? 'Set target' : 'Change'}
      </button>
      {contract.status === 'error' ? (
        <span className="text-[var(--danger,#ef6b6b)]" data-testid="target-contract-error">
          {contract.error}
        </span>
      ) : null}
    </div>
  );
}

function SlotRowView(props: {
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly model: ContractModel;
  readonly row: Row;
  readonly rows: readonly Row[];
  readonly clips: readonly ClipRecord[];
  readonly manifest: ReturnType<typeof useLibraryManifest>;
  readonly previewing: string | null;
}): JSX.Element {
  const { app, character, model, row, rows, clips, manifest, previewing } = props;
  const status = row.status;
  const filled = status.kind === 'custom' || status.kind === 'invalid';
  const spec = model.slots[row.slot];
  const open = spec?.customizable === true;
  const defaultClip = row.default === null ? null : libraryClipForDefault(manifest, row.default.name);
  const playingDefault = defaultClip !== null && previewing === `${character}\u0000${defaultClip}`;
  const clipName = filled ? clips.find((clip) => clip.id === status.clip)?.name : undefined;
  const sameAs = rows.filter(
    (other) =>
      other.slot !== row.slot &&
      model.slots[other.slot]?.customizable === true &&
      (other.status.kind === 'custom' || other.status.kind === 'invalid') &&
      other.status.via === 'own',
  );
  const issues = filled ? status.issues : [];
  return (
    <li
      className="flex flex-col gap-0.5 rounded-[3px] px-1 py-0.5 hover:bg-[var(--bg-hover,#30323a)]"
      data-testid={`target-row-${row.slot}`}
      data-status={status.kind}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={`w-3 shrink-0 text-center ${GLYPH_CLASS[status.kind]}`}>
          {GLYPH[status.kind]}
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-fg disabled:text-fg-2"
          disabled={!filled}
          title={filled ? `Show ${clipName ?? 'the clip'}` : row.slot}
          data-testid={`target-row-label-${row.slot}`}
          onClick={() => filled && run(app, 'clip.setActive', { clip: status.clip })}
        >
          {row.label}
          <span className="sr-only"> — {STATUS_TEXT[status.kind]}</span>
        </button>
        <span className={`${MUTED_TEXT} shrink-0 tabular-nums`} data-testid={`target-row-timing-${row.slot}`}>
          {filled && status.via === 'alias'
            ? `same clip as ${rows.find((other) => other.slot === status.from)?.label ?? status.from}`
            : status.kind === 'fixed'
              ? `game default · opens with ${row.customizableFrom ?? 'a later contract'}`
              : row.timing}
        </span>
      </div>
      {issues.length > 0 ? (
        <ul className="ml-4.5 flex flex-col" data-testid={`target-row-issues-${row.slot}`}>
          {issues.map((issue) => (
            <li
              key={`${issue.rule}:${issue.message}`}
              className={issue.severity === 'error' ? 'text-[var(--warning,#e8b04a)]' : MUTED_TEXT}
              title={issue.rule}
            >
              {issue.severity === 'error' ? '⚠ ' : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="ml-4.5 flex flex-wrap items-center gap-1">
          {defaultClip !== null ? (
            <button
              type="button"
              className={BUTTON}
              aria-pressed={playingDefault}
              title="Preview the game's default on the character"
              data-testid={`target-row-preview-${row.slot}`}
              onClick={() =>
                run(
                  app,
                  playingDefault ? 'library.stop' : 'library.preview',
                  playingDefault ? undefined : { character, clip: defaultClip },
                )
              }
            >
              {playingDefault ? '■' : '▶'} Game default
            </button>
          ) : null}
          {filled ? (
            <button
              type="button"
              className={BUTTON}
              title="Leave the slot empty: the game plays its own animation"
              data-testid={`target-row-clear-${row.slot}`}
              onClick={() => run(app, 'target.slot.clear', { character, slot: row.slot })}
            >
              {status.via === 'alias' ? 'Unlink' : 'Use default'}
            </button>
          ) : (
            <>
              <select
                className={`${SELECT} max-w-28`}
                aria-label={`From library for ${row.label}`}
                value=""
                disabled={manifest === null}
                data-testid={`target-row-library-${row.slot}`}
                onChange={(event) => {
                  const clip = event.currentTarget.value;
                  if (clip === '') return;
                  run(app, 'library.useClip', {
                    character,
                    clip,
                    slot: row.slot,
                    ...(spec?.animation?.inPlace === true ? { params: IDENTITY_IN_PLACE } : {}),
                  });
                }}
              >
                <option value="">From library…</option>
                {(manifest?.clips ?? []).map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.label}
                  </option>
                ))}
              </select>
              <select
                className={`${SELECT} max-w-28`}
                aria-label={`Use a clip for ${row.label}`}
                value=""
                disabled={clips.length === 0}
                data-testid={`target-row-assign-${row.slot}`}
                onChange={(event) => {
                  const clip = event.currentTarget.value as ClipId | '';
                  if (clip !== '') run(app, 'target.slot.assign', { character, slot: row.slot, clip });
                }}
              >
                <option value="">Use clip…</option>
                {clips.map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.name}
                  </option>
                ))}
              </select>
              {sameAs.length > 0 ? (
                <select
                  className={`${SELECT} max-w-28`}
                  aria-label={`Same clip as another slot for ${row.label}`}
                  value=""
                  data-testid={`target-row-same-${row.slot}`}
                  onChange={(event) => {
                    const to = event.currentTarget.value;
                    if (to !== '') run(app, 'target.slot.alias', { character, slot: row.slot, to });
                  }}
                >
                  <option value="">Same as…</option>
                  {sameAs.map((other) => (
                    <option key={other.slot} value={other.slot}>
                      {other.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Checklist(props: {
  readonly app: EditorApp;
  readonly kit: TargetKit;
  readonly character: CharacterId;
  readonly binding: NonNullable<ReturnType<TargetKit['bindingOf']>>;
}): JSX.Element {
  const { app, kit, character, binding } = props;
  const model = binding.model;
  const statuses = kit.slotStatuses(app, character);
  const manifest = useLibraryManifest(app, true);
  const previewing = usePreviewClip(app);
  const clips = app.store.query
    .clipsOfCharacter(character)
    .filter((clip) => clip.deleted === null && clip.source.kind !== 'test');
  const view = model === null ? undefined : kit.contractCharacter(model, binding.target.gameCharacter);
  const sections = useMemo(() => {
    const out: { label: string; key: string | null; rows: Row[] }[] = [];
    for (const row of statuses?.rows ?? []) {
      const last = out.at(-1);
      if (last !== undefined && last.label === row.section) last.rows.push(row);
      else out.push({ label: row.section, key: row.key, rows: [row] });
    }
    return out;
  }, [statuses]);
  if (model === null || statuses === null) {
    return (
      <div className={EMPTY_STATE} data-testid="target-unreadable">
        {binding.error ?? 'The target’s contract cannot be read'}
      </div>
    );
  }
  const extras = statuses.extras
    .map((id) => clips.find((clip) => clip.id === id))
    .filter((clip): clip is ClipRecord => clip !== undefined);
  const openSlots = statuses.rows.filter((row) => model.slots[row.slot]?.customizable === true);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5" data-testid="target-checklist">
      <div className="flex flex-col gap-0.5" data-testid="target-header">
        <div className="font-semibold text-fg" data-testid="target-title">
          {model.gameName} · {view?.name ?? binding.target.gameCharacter}
        </div>
        <div className={MUTED_TEXT} title={model.revision} data-testid="target-revision">
          Contract {model.revision.slice(7, 15)} · {model.license}
        </div>
        <div className="text-fg-2" data-testid="target-summary">
          {summaryText(statuses.counts)}
        </div>
        <div className={MUTED_TEXT}>Empty slots use the game’s own animations.</div>
      </div>
      {sections.map((section) => (
        <section key={section.label} aria-label={section.label} className="flex flex-col gap-0.5">
          <h3 className="mt-1 text-[10px] font-semibold tracking-wide text-fg-3 uppercase">
            {section.key === null ? section.label : `${section.key} · ${section.label}`}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {section.rows.map((row) => (
              <SlotRowView
                key={row.slot}
                app={app}
                character={character}
                model={model}
                row={row}
                rows={statuses.rows}
                clips={clips}
                manifest={manifest}
                previewing={previewing}
              />
            ))}
          </ul>
        </section>
      ))}
      {extras.length > 0 ? (
        <section className="mt-1 flex flex-col gap-0.5" data-testid="target-extras">
          <h3 className="text-[10px] font-semibold tracking-wide text-fg-3 uppercase">Not used by {model.gameName}</h3>
          {extras.map((clip) => (
            <div key={clip.id} className="flex items-center gap-1.5" data-testid={`target-extra-${clip.id}`}>
              <span className="min-w-0 flex-1 truncate">{clip.name}</span>
              <select
                className={`${SELECT} max-w-32`}
                aria-label={`Map ${clip.name} to a slot`}
                value=""
                data-testid={`target-extra-map-${clip.id}`}
                onChange={(event) => {
                  const slot = event.currentTarget.value;
                  if (slot !== '') run(app, 'target.slot.assign', { character, slot, clip: clip.id });
                }}
              >
                <option value="">Map to a slot…</option>
                {openSlots.map((row) => (
                  <option key={row.slot} value={row.slot}>
                    {row.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export default function TargetPanel({ app, instanceId }: PanelProps): JSX.Element {
  const kit = useTargetKit(app);
  const character = useSession(selectCharacter);
  useStoreVersion(app);
  const ready = kit.status === 'ready' ? kit.value : null;
  const binding = ready === null || character === null ? null : ready.bindingOf(app, character);
  const name = character === null ? null : (app.store.get('characters', character)?.name ?? null);
  return (
    <div className={PANEL_ROOT} data-testid="target-panel" data-instance={instanceId}>
      <div className={TOOLBAR} role="toolbar" aria-label="Target">
        <span className="min-w-0 flex-1 truncate" data-testid="target-character">
          {name === null ? 'Target' : `Target · ${name}`}
        </span>
        {binding !== null && character !== null ? (
          <button
            type="button"
            className={BUTTON}
            title="Remove the target (clips stay)"
            data-testid="target-unbind"
            onClick={() => run(app, 'target.unbind', { character })}
          >
            Clear target
          </button>
        ) : null}
      </div>
      {kit.status === 'error' ? (
        <div className={EMPTY_STATE} data-testid="target-error">
          {kit.error}
        </div>
      ) : character === null ? (
        <div className={EMPTY_STATE} data-testid="target-empty">
          Select a character to see what a game needs from it.
        </div>
      ) : ready === null ? (
        <div className={EMPTY_STATE}>Loading…</div>
      ) : (
        <>
          <div className="border-b border-line p-1.5">
            <Picker
              key={binding === null ? 'none' : `${binding.target.game}:${binding.target.gameCharacter}`}
              app={app}
              kit={ready}
              character={character}
              current={binding === null ? null : binding.target}
            />
          </div>
          {binding === null ? (
            <div className={EMPTY_STATE} data-testid="target-unbound">
              Pick a game character to see the animations it needs. Empty slots use the game’s own animations.
            </div>
          ) : (
            <Checklist app={app} kit={ready} character={character} binding={binding} />
          )}
        </>
      )}
    </div>
  );
}
