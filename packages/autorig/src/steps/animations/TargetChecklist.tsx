// ④ Animations in contract mode (CHARACTER-CONTRACT-SPEC §8.5, §9 F1; GAME-PROTOCOL-SPEC §4.7; C1). The step's new
// first line *For a game…* binds the character to a target of the bundled game contract (`target.bind`; the contract
// and the target chunk load on that tap, not on entry). Bound, the line reads *For: OMOBA · Wildspark* with *Change*
// and *Not for a game*, and the checklist of the target's character package (its `character` offer: the clips)
// replaces the free clip list: "Wildspark: 2 yours · 7 game default", each slot with its status
// (● yours, ○ game default, ⚠ to fix with the contract's reason, ◌ fixed), *Game default ▶* (a preview of the default
// where the starter pack has it), *Pick from library…* (`autorig.clip.add` with the slot: one Use Clip step), *Use
// clip…* (a clip of the character, `target.slot.assign`) and *Use default* (`target.slot.clear`); clips the game will
// not use list *Map to a slot…*. Part of the step view's lazy chunk; the per-row file drop and *Animate in Studio ▸*
// come with C6.
import type { CharacterId, ClipId, ClipRecord } from '@ekza-studio/doc';
import { loadTargetKit, type TargetKit } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { messages } from '../../i18n';
import { useDocument, type WizardContext } from '../../shell/context';
import { useSmall } from '../../shell/store';
import { animationsUi, characterClips, previewClip, stopPreview } from './actions';
import './strings';

const t = (): ReturnType<typeof messages>['animations'] => messages().animations;
const coarse = 'pointer-coarse:min-h-11';
const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string => cn(buttonClass(variant, 'sm'), coarse);
const select =
  'h-7 min-w-0 max-w-40 rounded-field border border-line bg-field px-1 text-fg pointer-coarse:h-11 disabled:opacity-50';

/** The games Studio bundles a contract for. */
const GAMES: readonly string[] = ['omoba'];
const IN_PLACE = { speed: 1, trim: null, mirror: false, inPlace: true, armSpace: 0 } as const;
const IDENTITY = { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 } as const;

/** The protocol's contract model (io's, through the target chunk's types: Auto-Rig does not depend on io). */
type ContractModel = Parameters<TargetKit['contractTarget']>[0];
type Statuses = NonNullable<ReturnType<TargetKit['slotStatuses']>>;
type Row = Statuses['rows'][number];

const GLYPH: Readonly<Record<Row['status']['kind'], string>> = {
  custom: '●',
  invalid: '⚠',
  default: '○',
  missing: '⊘',
  fixed: '◌',
};

/** The target chunk once something here needs it (a bound character on entry, or the *For a game…* tap). */
function useKit(ctx: WizardContext, wanted: boolean): TargetKit | null {
  const [kit, setKit] = useState<TargetKit | null>(null);
  useEffect(() => {
    if (!wanted || kit !== null) return undefined;
    let live = true;
    loadTargetKit(ctx.app).then(
      (loaded) => live && setKit(loaded),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [ctx, wanted, kit]);
  return kit;
}

/** True when the document has a live target for the character (read without the chunk: the table may be opaque). */
export function hasTarget(ctx: WizardContext, character: CharacterId): boolean {
  const store = ctx.app.store as unknown as { get(table: string, id: string): { deleted: unknown } | undefined };
  const row = store.get('ekza.targets', `tgt:${character}`);
  return row !== undefined && row.deleted === null && ctx.app.store.get('characters', character) !== undefined;
}

function Picker(props: {
  readonly ctx: WizardContext;
  readonly kit: TargetKit;
  readonly character: CharacterId;
  readonly current: string | null;
  readonly onDone: () => void;
}): JSX.Element {
  const { ctx, kit, character, current, onDone } = props;
  const a = t();
  const game = GAMES[0] ?? 'omoba';
  const [model, setModel] = useState<ContractModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    kit
      .contractsOf(ctx.app)
      .latest(game)
      .then(
        (loaded) => live && setModel(loaded.model),
        (failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)),
      );
    return () => {
      live = false;
    };
  }, [ctx, kit, game]);
  if (error !== null) return <p className="text-danger">{error}</p>;
  if (model === null) return <p className="text-fg-2">{a.targetLoading}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-fg-2">{model.gameName}</span>
      <select
        className={select}
        aria-label={a.targetGameCharacter}
        value={current ?? ''}
        data-testid="ar-target-character"
        onChange={(event) => {
          const target = event.currentTarget.value;
          if (target === '' || target === current) return;
          void ctx.run('target.bind', { character, game, target }).then((result) => {
            if (result.status === 'finished') onDone();
          });
        }}
      >
        <option value="">{a.targetChoose}</option>
        {model.targets.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <button type="button" className={button('ghost')} data-testid="ar-target-picker-close" onClick={onDone}>
        {a.targetClose}
      </button>
    </div>
  );
}

function SlotRow(props: {
  readonly ctx: WizardContext;
  readonly character: CharacterId;
  readonly model: ContractModel;
  readonly row: Row;
  readonly rows: readonly Row[];
  readonly clips: readonly ClipRecord[];
}): JSX.Element {
  const { ctx, character, model, row, rows, clips } = props;
  const a = t();
  const ui = useSmall(animationsUi(ctx));
  const status = row.status;
  const filled = status.kind === 'custom' || status.kind === 'invalid';
  const spec = model.slots[row.slot];
  const open = spec?.customizable === true;
  const motion = row.default?.name.replaceAll('_', '-') ?? null;
  const defaultClip = motion !== null && ui.manifest?.clips.some((clip) => clip.id === motion) === true ? motion : null;
  const previewing = ui.selected === defaultClip && defaultClip !== null;
  const timing =
    filled && status.via === 'alias'
      ? a.targetSameAs(rows.find((other) => other.slot === status.from)?.label ?? status.from)
      : status.kind === 'fixed'
        ? a.targetFixed(row.customizableFrom ?? '?')
        : row.timing;
  return (
    <li
      className="flex flex-col gap-1 rounded-field border border-line px-2 py-1.5"
      data-testid={`ar-target-row-${row.slot}`}
      data-status={status.kind}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className={cn('w-3 text-center', filled ? 'text-accent' : 'text-fg-3')}>
          {GLYPH[status.kind]}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span data-testid={`ar-target-label-${row.slot}`}>
            {row.key === null ? '' : `${row.key} · `}
            {row.label}
            <span className="sr-only"> — {a.targetStatus(status.kind)}</span>
          </span>
          <span className="text-fg-3 tabular-nums" data-testid={`ar-target-timing-${row.slot}`}>
            {timing}
          </span>
        </div>
      </div>
      {filled && status.issues.length > 0 ? (
        <ul className="pl-5 text-fg-2" data-testid={`ar-target-issues-${row.slot}`}>
          {status.issues.map((issue) => (
            <li key={`${issue.rule}:${issue.message}`} className={issue.severity === 'error' ? 'text-warn' : ''}>
              {issue.severity === 'error' ? '⚠ ' : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-1 pl-5">
          {defaultClip !== null ? (
            <button
              type="button"
              className={button('ghost')}
              aria-pressed={previewing}
              data-testid={`ar-target-preview-${row.slot}`}
              onClick={() => void (previewing ? stopPreview(ctx) : previewClip(ctx, defaultClip))}
            >
              {previewing ? '■' : '▶'} {a.targetPreviewDefault}
            </button>
          ) : null}
          {filled ? (
            <button
              type="button"
              className={button('ghost')}
              data-testid={`ar-target-clear-${row.slot}`}
              onClick={() => void ctx.run('target.slot.clear', { character, slot: row.slot })}
            >
              {status.via === 'alias' ? a.targetUnlink : a.targetUseDefault}
            </button>
          ) : (
            <>
              <select
                className={select}
                aria-label={a.targetPickFor(row.label)}
                value=""
                disabled={ui.manifest === null || ui.busy !== null}
                data-testid={`ar-target-pick-${row.slot}`}
                onChange={(event) => {
                  const clip = event.currentTarget.value;
                  if (clip === '') return;
                  void ctx.run('autorig.clip.add', {
                    character,
                    clip,
                    params: spec?.animation?.inPlace === true ? IN_PLACE : IDENTITY,
                    slot: row.slot,
                  });
                }}
              >
                <option value="">{a.targetPick}</option>
                {(ui.manifest?.clips ?? []).map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.label}
                  </option>
                ))}
              </select>
              {clips.length > 0 ? (
                <select
                  className={select}
                  aria-label={a.targetUseClipFor(row.label)}
                  value=""
                  data-testid={`ar-target-assign-${row.slot}`}
                  onChange={(event) => {
                    const clip = event.currentTarget.value as ClipId | '';
                    if (clip !== '') void ctx.run('target.slot.assign', { character, slot: row.slot, clip });
                  }}
                >
                  <option value="">{a.targetUseClip}</option>
                  {clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.name}
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

/**
 * The step's target line and, when the character is bound, its checklist. `children` (the free clip list) shows when
 * it is not bound.
 */
export function TargetSection(props: {
  readonly ctx: WizardContext;
  readonly character: { readonly id: CharacterId; readonly name: string } | null;
  readonly children: JSX.Element;
}): JSX.Element {
  const { ctx, character } = props;
  const a = t();
  const bound = useDocument(ctx.app, () => character !== null && hasTarget(ctx, character.id));
  const [picking, setPicking] = useState(false);
  const kit = useKit(ctx, bound || picking);
  const binding = useDocument(ctx.app, () =>
    kit === null || character === null ? null : kit.bindingOf(ctx.app, character.id),
  );
  const statuses = useDocument(ctx.app, () =>
    kit === null || character === null ? null : kit.slotStatuses(ctx.app, character.id),
  );
  const clips = useDocument(ctx.app, () =>
    character === null ? [] : characterClips(ctx.app, character.id).filter((clip) => clip.source.kind !== 'test'),
  );
  if (character === null) return props.children;
  const model = binding?.model ?? null;
  const view = model === null || binding === null ? undefined : kit?.contractTarget(model, binding.target.target);
  const line = (
    <div className="flex flex-wrap items-center gap-2" data-testid="ar-target-line">
      {binding !== null && model !== null ? (
        <span className="font-semibold" data-testid="ar-target-title">
          {a.targetLine(model.gameName, view?.name ?? binding.target.target)}
        </span>
      ) : null}
      {picking && kit !== null ? (
        <Picker
          ctx={ctx}
          kit={kit}
          character={character.id}
          current={binding?.target.target ?? null}
          onDone={() => setPicking(false)}
        />
      ) : (
        <>
          <button
            type="button"
            className={button(binding === null ? 'default' : 'ghost')}
            title={a.targetForTitle}
            data-testid="ar-target-open"
            onClick={() => setPicking(true)}
          >
            {binding === null ? a.targetFor : a.targetChange}
          </button>
          {binding !== null ? (
            <button
              type="button"
              className={button('ghost')}
              data-testid="ar-target-unbind"
              onClick={() => void ctx.run('target.unbind', { character: character.id })}
            >
              {a.targetClear}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
  if (!bound || binding === null || model === null || statuses === null) {
    return (
      <>
        {line}
        {props.children}
      </>
    );
  }
  // ④ makes the character package: the rows and counts of the target's `character` offer (its clips)
  const offer = statuses.offers.find((candidate) => candidate.package === 'character');
  const rows = statuses.rows.filter((row) => offer !== undefined && row.offers.includes(offer.requirementId));
  const counts = offer?.counts ?? statuses.counts;
  const extras = statuses.extras
    .map((id) => clips.find((clip) => clip.id === id))
    .filter((clip): clip is ClipRecord => clip !== undefined);
  const openSlots = rows.filter((row) => model.slots[row.slot]?.customizable === true);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ar-target-summary" data-testid="ar-target">
      {line}
      <h2 id="ar-target-summary" className="font-semibold" data-testid="ar-target-summary">
        {a.targetSummary(
          view?.name ?? binding.target.target,
          a.targetCounts(counts.custom, counts.default, counts.invalid + counts.missing),
        )}
      </h2>
      <p className="text-fg-3">{a.targetNote(model.gameName)}</p>
      <ul className="flex flex-col gap-1" data-testid="ar-target-rows">
        {rows.map((row) => (
          <SlotRow
            key={row.slot}
            ctx={ctx}
            character={character.id}
            model={model}
            row={row}
            rows={rows}
            clips={clips}
          />
        ))}
      </ul>
      {extras.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="ar-target-extras">
          <h3 className="text-fg-2">{a.targetExtras(model.gameName)}</h3>
          {extras.map((clip) => (
            <div key={clip.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{clip.name}</span>
              <select
                className={select}
                aria-label={a.targetMapFor(clip.name)}
                value=""
                data-testid={`ar-target-map-${clip.id}`}
                onChange={(event) => {
                  const slot = event.currentTarget.value;
                  if (slot !== '') void ctx.run('target.slot.assign', { character: character.id, slot, clip: clip.id });
                }}
              >
                <option value="">{a.targetMap}</option>
                {openSlots.map((row) => (
                  <option key={row.slot} value={row.slot}>
                    {row.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
