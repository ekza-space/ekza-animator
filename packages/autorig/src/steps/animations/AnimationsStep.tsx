// ④ Animations (AUTORIG-SPEC §5.5, §8.1–§8.3; D5). In the side panel (a bottom sheet below 1024 px): the library
// grid over C12's manifest — search with synonyms, category chips, cards with label, duration, loop glyph and slot
// (a roving-tabindex list; a failed checksum disables the card) — then the clips **On <character>** (▶ through the
// shipped playback, the slot chip, ✎ back into the editor, ✕), the `.vrma` drop zone, OMOBA's note and *Skip*. Over
// the pane: the preview bar (play / stop, the preview's time) and the parameters (speed, trim, arm space, mirror, in
// place) with *+ Add to character* / *Update*. The footer: the clip count (or "No animations — …") and *Export ▸*.
// Hover never auto-plays; the preview starts on a click, Enter or Space only. Keys: `/` search, `Space` play / stop
// (form controls keep their own Space), `A` adds the focused or selected card, `Esc` stops (the frame's fall-through).
import type { ClipRecord } from '@ekza-studio/doc';
import { buttonClass, cn } from '@ekza-studio/ui';
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatNumber, messages } from '../../i18n';
import { ANIMATIONS_ACTIONS } from '../../keymap/steps/animations';
import { useDocument, useProgress, useSession, type WizardContext } from '../../shell/context';
import { bindingFor, inText } from '../../shell/keys';
import type { StepViewProps } from '../../shell/steps';
import { useSmall } from '../../shell/store';
import type { AutoRigSession, ClipParams } from '../../types';
import {
  addClip,
  animationsUi,
  cancelEdit,
  changeParams,
  characterClips,
  characterName,
  deleteDocumentClip,
  draftOf,
  editDocumentClip,
  editTargetOf,
  entryOf,
  importVrmaFiles,
  libraryClipOf,
  loadManifest,
  playDocumentClip,
  previewClip,
  recordedParams,
  setClipSlot,
  type StarterPackClip,
  stopDocumentClip,
  stopPreview,
  subjectCharacter,
  togglePreview,
} from './actions';
import {
  CATEGORIES,
  type ClipCategory,
  filterClips,
  IDENTITY,
  isIdentity,
  SLOT_VOCABULARY,
  speedText,
  trimFromSliders,
} from './data';
import { useHiddenControls } from '../markers/controls';
import { useHiddenParts } from '../model/hiddenParts';
import { clearDraft, markSkipped } from './slice';
import './strings';

const t = (): ReturnType<typeof messages>['animations'] => messages().animations;
const coarse = 'pointer-coarse:min-h-11';
const button = (variant: 'default' | 'primary' | 'ghost' = 'default', size: 'sm' | 'md' = 'md'): string =>
  cn(buttonClass(variant, size), coarse);

const CATEGORY_LABEL: Readonly<Record<'all' | ClipCategory, () => string>> = {
  all: () => t().categoryAll,
  move: () => t().categoryMove,
  combat: () => t().categoryCombat,
  react: () => t().categoryReact,
  fun: () => t().categoryFun,
  other: () => t().categoryOther,
};

const selectAnimations = (s: AutoRigSession): AutoRigSession['animations'] => s.animations;
const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;

/** The library preview (clip and seconds), re-read on every service change and, while it plays, every frame. */
function usePreview(
  ctx: WizardContext,
): { readonly clip: string; readonly seconds: number; readonly duration: number } | null {
  const { app } = ctx;
  const subscribe = useCallback(
    (listener: () => void) => {
      let frame = 0;
      const tick = (): void => {
        listener();
        if (app.library.service.preview !== null) frame = requestAnimationFrame(tick);
      };
      const off = app.library.service.subscribe(() => {
        cancelAnimationFrame(frame);
        tick();
      });
      return () => {
        cancelAnimationFrame(frame);
        off();
      };
    },
    [app],
  );
  const read = useCallback(() => {
    const preview = app.library.service.preview;
    return preview === null ? null : `${preview.clip}\u0000${preview.seconds.toFixed(2)}\u0000${preview.duration}`;
  }, [app]);
  const key = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => {
    if (key === null) return null;
    const [clip, seconds, duration] = key.split('\u0000') as [string, string, string];
    return { clip, seconds: Number(seconds), duration: Number(duration) };
  }, [key]);
}

/** Whether the timeline is playing (a document clip's ▶). */
function useTimelinePlaying(ctx: WizardContext): boolean {
  const { app } = ctx;
  const read = useCallback(() => app.session.getState().time.playing, [app]);
  return useSyncExternalStore(app.session.subscribe, read, read);
}

// ---------------------------------------------------------------------------------------------------------------------
// the library grid (§5.5.1)

function ClipCard(props: {
  readonly ctx: WizardContext;
  readonly entry: StarterPackClip;
  readonly selected: boolean;
  readonly playing: boolean;
  readonly failed: boolean;
  readonly focusable: boolean;
  readonly onFocus: () => void;
  readonly onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  const { ctx, entry } = props;
  const a = t();
  return (
    <li className="contents">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-field border px-2 py-1.5 text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
          props.selected ? 'border-accent bg-selected' : 'border-line bg-field hover:enabled:bg-hover',
          coarse,
        )}
        tabIndex={props.focusable ? 0 : -1}
        disabled={props.failed}
        aria-pressed={props.selected}
        title={props.failed ? a.checksumFailed : a.cardTitle(entry.label)}
        data-clip={entry.id}
        data-testid={`ar-clip-card-${entry.id}`}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
        onClick={() => void previewClip(ctx, entry.id)}
      >
        <span aria-hidden className="w-3 text-accent">
          {props.playing ? '▶' : ''}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.loop ? (
          <span aria-label={a.loop} title={a.loop} className="text-fg-3">
            ↻
          </span>
        ) : null}
        <span className="text-fg-3 tabular-nums">{a.seconds(formatNumber(entry.duration))}</span>
        {entry.slot === null ? (
          // a clip without a slot says so before Add, not only on ⑤ (AR-D9-9)
          <span className="px-1 text-[10px] text-fg-3" title={a.cardNoSlot} data-testid={`ar-clip-noslot-${entry.id}`}>
            {a.noSlot}
          </span>
        ) : (
          <span className="rounded-sm bg-panel px-1 text-[10px] text-fg-2">{entry.slot}</span>
        )}
      </button>
    </li>
  );
}

function Library(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const a = t();
  const ui = useSmall(animationsUi(ctx));
  const preview = usePreview(ctx);
  const [focused, setFocused] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const clips = useMemo(
    () => filterClips(ui.manifest?.clips ?? [], ui.category, ui.query),
    [ui.manifest, ui.category, ui.query],
  );
  const categories = useMemo(() => {
    const present = new Set((ui.manifest?.clips ?? []).map((clip) => clip.id));
    return CATEGORIES.filter(
      (category) =>
        category === 'all' || filterClips(ui.manifest?.clips ?? [], category, '').some((c) => present.has(c.id)),
    );
  }, [ui.manifest]);
  const focusable = clips.some((clip) => clip.id === focused) ? focused : (clips[0]?.id ?? null);
  // roving tabindex (§8.2): arrows move between the cards, Home / End to the ends
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key) || clips.length === 0) return;
    e.preventDefault();
    const index = Math.max(
      0,
      clips.findIndex((clip) => clip.id === focusable),
    );
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? clips.length - 1
          : e.key === 'ArrowDown' || e.key === 'ArrowRight'
            ? Math.min(clips.length - 1, index + 1)
            : Math.max(0, index - 1);
    const id = clips[next]?.id ?? null;
    setFocused(id);
    list.current?.querySelector<HTMLButtonElement>(`[data-clip="${id}"]`)?.focus();
  };
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ar-anim-library" data-testid="ar-anim-library">
      <h2 id="ar-anim-library" className="font-semibold">
        {a.libraryTitle}
      </h2>
      <input
        type="search"
        aria-label={a.search}
        placeholder={a.searchPlaceholder}
        className="h-8 rounded-field border border-line bg-field px-2 text-fg pointer-coarse:h-11"
        value={ui.query}
        data-testid="ar-anim-search"
        onChange={(e) => {
          const query = e.currentTarget.value;
          animationsUi(ctx).set((current) => ({ ...current, query }));
        }}
        onKeyDown={(e) => {
          // ↓ goes straight to the results (the grid's roving card), past the category chips (AR-D8-9)
          if (e.key !== 'ArrowDown') return;
          const grid = document.querySelector('[data-testid="ar-anim-grid"]');
          const card =
            grid?.querySelector<HTMLElement>('[data-clip][tabindex="0"]:not(:disabled)') ??
            grid?.querySelector<HTMLElement>('[data-clip]:not(:disabled)');
          if (card === null || card === undefined) return;
          e.preventDefault();
          card.focus();
        }}
      />
      <fieldset aria-label={a.categories} className="m-0 flex flex-wrap gap-1 border-0 p-0">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={cn(
              'rounded-full border px-2 py-0.5 text-fg-2',
              ui.category === category ? 'border-accent bg-selected text-fg' : 'border-line hover:bg-hover',
              coarse,
            )}
            aria-pressed={ui.category === category}
            data-testid={`ar-anim-category-${category}`}
            onClick={() => animationsUi(ctx).set((current) => ({ ...current, category }))}
          >
            {CATEGORY_LABEL[category]()}
          </button>
        ))}
      </fieldset>
      {ui.status === 'loading' ? (
        <output className="text-fg-2">{a.loadingLibrary}</output>
      ) : ui.status === 'error' ? (
        <div className="flex flex-col gap-1" role="alert">
          <p className="text-danger">{a.libraryFailed(ui.error ?? '')}</p>
          <button type="button" className={button()} onClick={() => void loadManifest(ctx)}>
            {a.retry}
          </button>
        </div>
      ) : clips.length === 0 ? (
        <p className="text-fg-2">{a.noMatch}</p>
      ) : (
        <ul ref={list} aria-label={a.libraryTitle} className="flex flex-col gap-1" data-testid="ar-anim-grid">
          {clips.map((entry) => (
            <ClipCard
              key={entry.id}
              ctx={ctx}
              entry={entry}
              selected={ui.selected === entry.id}
              playing={preview?.clip === entry.id}
              failed={ui.failed.has(entry.id)}
              focusable={focusable === entry.id}
              onFocus={() => setFocused(entry.id)}
              onKeyDown={onKeyDown}
            />
          ))}
        </ul>
      )}
      <p className="text-fg-3" data-testid="ar-anim-count">
        {clips.length === (ui.manifest?.clips.length ?? 0)
          ? a.clipCount(clips.length)
          : a.clipCountOf(clips.length, ui.manifest?.clips.length ?? 0)}{' '}
        · {a.credit}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the clips on the character (§5.5.2, §5.5.4)

function ClipRow(props: {
  readonly ctx: WizardContext;
  readonly record: ClipRecord;
  readonly active: boolean;
}): JSX.Element {
  const { ctx, record } = props;
  const a = t();
  const ui = useSmall(animationsUi(ctx));
  const timeline = useTimelinePlaying(ctx);
  const editing = useSession(ctx.session, selectAnimations).editing === record.id;
  const playing = props.active && timeline;
  const source = libraryClipOf(ui.manifest, record);
  const params = recordedParams(record);
  const speed = speedText(params.speed);
  return (
    <li
      className={cn('flex flex-col gap-1 rounded-field border px-2 py-1', editing ? 'border-accent' : 'border-line')}
      data-testid={`ar-char-clip-${record.id}`}
      data-name={record.name}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(button('ghost', 'sm'), 'w-8 px-0')}
          aria-label={playing ? a.stop : a.playClip(record.name)}
          aria-pressed={playing}
          data-testid={`ar-char-clip-play-${record.id}`}
          onClick={() => void (playing ? stopDocumentClip(ctx) : playDocumentClip(ctx, record.id))}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="min-w-0 flex-1 truncate">{record.name}</span>
        {speed === null ? null : <span className="text-fg-3 tabular-nums">{speed}</span>}
        {params.mirror ? (
          <span className="text-fg-3" title={a.mirror} data-testid={`ar-char-clip-mirror-${record.id}`}>
            {a.rowMirrored}
          </span>
        ) : null}
        {params.inPlace ? (
          <span className="text-fg-3" data-testid={`ar-char-clip-inplace-${record.id}`}>
            {a.rowInPlace}
          </span>
        ) : null}
        {source === null ? null : (
          <button
            type="button"
            className={cn(button('ghost', 'sm'), 'w-8 px-0')}
            aria-label={a.editClip(record.name)}
            title={a.editClip(record.name)}
            data-testid={`ar-char-clip-edit-${record.id}`}
            onClick={() => void editDocumentClip(ctx, record.id)}
          >
            ✎
          </button>
        )}
        <button
          type="button"
          className={cn(button('ghost', 'sm'), 'w-8 px-0')}
          aria-label={a.deleteClip(record.name)}
          title={a.deleteClip(record.name)}
          data-testid={`ar-char-clip-delete-${record.id}`}
          onClick={() => void deleteDocumentClip(ctx, record.id)}
        >
          ✕
        </button>
      </div>
      <label className="flex items-center gap-2 text-fg-2">
        <span>{a.slot}</span>
        <select
          aria-label={a.slotFor(record.name)}
          className="h-7 min-w-0 flex-1 rounded-field border border-line bg-field px-1 text-fg pointer-coarse:h-11"
          value={record.slot ?? ''}
          data-testid={`ar-char-clip-slot-${record.id}`}
          onChange={(e) => {
            const value = e.currentTarget.value;
            void setClipSlot(ctx, record.id, value === '' ? null : value);
          }}
        >
          <option value="">{a.noSlot}</option>
          {SLOT_VOCABULARY.map((slot) => (
            <option key={slot} value={slot}>
              {slot}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function CharacterClips(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const a = t();
  useSession(ctx.session, selectSubject);
  const character = useDocument(ctx.app, () => subjectCharacter(ctx));
  const records = useDocument(ctx.app, () => (character === null ? [] : characterClips(ctx.app, character.id)));
  const activeClip = useSyncExternalStore(
    ctx.app.session.subscribe,
    () => (character === null ? null : (ctx.app.session.getState().activeClip[character.id] ?? null)),
    () => null,
  );
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ar-anim-character" data-testid="ar-anim-character">
      <h2 id="ar-anim-character" className="font-semibold">
        {a.onCharacter(character === null ? a.character : characterName(character))}
      </h2>
      {records.length === 0 ? (
        <p className="text-fg-2">{a.noClips}</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="ar-char-clips">
          {records.map((record) => (
            <ClipRow key={record.id} ctx={ctx} record={record} active={activeClip === record.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The `.vrma` drop zone (also a file picker) and OMOBA's note (§5.5.4). */
function DropZone(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const a = t();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="rounded-field border-2 border-dashed border-line-strong px-2 py-3 text-fg-2 hover:bg-hover pointer-coarse:min-h-11"
        data-testid="ar-anim-drop"
        onClick={() => picker.current?.click()}
      >
        {a.dropTitle}
      </button>
      <input
        ref={picker}
        type="file"
        accept=".vrma"
        multiple
        className="hidden"
        data-testid="ar-anim-picker"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length > 0) void importVrmaFiles(ctx, files);
        }}
      />
      <p className="text-fg-3">{a.omobaNote}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the panel: library, character, footer, keys

function Panel(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const a = t();
  const ui = useSmall(animationsUi(ctx));
  const slice = useSession(ctx.session, selectAnimations);
  const progress = useProgress(ctx);
  const character = useDocument(ctx.app, () => subjectCharacter(ctx));
  const count = useDocument(ctx.app, () => (character === null ? 0 : characterClips(ctx.app, character.id).length));

  useEffect(() => {
    if (animationsUi(ctx).get().manifest === null) void loadManifest(ctx);
  }, [ctx]);
  // the character plays its clips without the rig's controls over it (AR-D9-8)
  useHiddenControls(ctx, true, 'animations');
  useHiddenParts(ctx);

  // an info notice ("Added Walk") gives way to the count after a few seconds; an error stays until the next action
  useEffect(() => {
    const notice = ui.notice;
    if (notice === null || notice.tone !== 'info' || ui.busy !== null) return undefined;
    const timer = setTimeout(() => {
      animationsUi(ctx).set((current) => (current.notice === notice ? { ...current, notice: null } : current));
    }, 4000);
    return () => clearTimeout(timer);
  }, [ctx, ui.notice, ui.busy]);

  // the footer (§5.5.4): the count, or the note that OMOBA needs none; Export ▸ with zero clips too
  useEffect(() => {
    const notice = ui.notice;
    const status =
      notice !== null
        ? notice.text
        : character === null
          ? a.footerNoCharacter
          : count > 0
            ? a.footerCount(count, characterName(character))
            : slice.skipped
              ? a.skipped
              : a.footerNone;
    ctx.setFooter({
      status,
      ...(notice?.tone === 'error' ? { tone: 'error' as const } : {}),
      primary: { label: a.next, disabled: !progress.reachable.export, run: () => ctx.go('export') },
    });
  }, [ctx, a, ui.notice, character, count, slice.skipped, progress]);

  // keys (§8.1): the frame prevents `/` and `A` (its keymap rows); Space is handled here so form controls keep theirs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mac = ctx.app.keymap.platform === 'mac';
      if (ctx.session.getState().step !== 'animations') return;
      if (ctx.app.session.getState().dialog !== null || ctx.host.ui.getState().confirm !== null) return;
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat) {
        if (inText(e.target)) return;
        const tag = (e.target as { tagName?: string } | null)?.tagName ?? '';
        // a focused button, checkbox, slider or list keeps its own Space; Studio's Space binding never runs
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') {
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        void togglePreview(ctx);
        return;
      }
      const binding = bindingFor(e, 'animations', mac);
      if (binding === null || !('action' in binding.run)) return;
      if (binding.run.action === ANIMATIONS_ACTIONS.search) {
        const search = document.querySelector<HTMLInputElement>('[data-testid="ar-anim-search"]');
        search?.focus();
        search?.select();
      } else if (binding.run.action === ANIMATIONS_ACTIONS.add) {
        const focused = (e.target as { dataset?: DOMStringMap } | null)?.dataset?.['clip'];
        const clip = focused ?? animationsUi(ctx).get().selected;
        if (clip !== undefined && clip !== null) void addClip(ctx, clip);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [ctx]);

  return (
    <div className="flex flex-col gap-4" data-testid="ar-anim-panel">
      <CharacterClips ctx={ctx} />
      <Library ctx={ctx} />
      <DropZone ctx={ctx} />
      {count === 0 && !slice.skipped ? (
        <button
          type="button"
          className={button('ghost')}
          data-testid="ar-anim-skip"
          disabled={!progress.reachable.export}
          onClick={() => {
            markSkipped(ctx.session);
            ctx.go('export');
          }}
        >
          {a.skip}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// over the pane: the preview bar and the parameters (§5.5.2, §5.5.3)

const round = (value: number, step: number): number => Math.round(value / step) * step;

function Params(props: {
  readonly ctx: WizardContext;
  readonly entry: StarterPackClip;
  readonly open: boolean;
}): JSX.Element {
  const { ctx, entry } = props;
  const a = t();
  const slice = useSession(ctx.session, selectAnimations);
  const params = slice.draft[entry.id] ?? IDENTITY;
  const duration = entry.duration;
  const trim = params.trim ?? { start: 0, end: duration };
  const set = (patch: Partial<ClipParams>): void =>
    changeParams(ctx, entry.id, { ...draftOf(ctx, entry.id), ...patch });
  const setTrim = (start: number, end: number): void => {
    const next = trimFromSliders(start, end, duration);
    if (next !== undefined) set({ trim: next });
  };
  const field = 'flex items-center gap-2';
  const label = 'w-20 shrink-0 text-fg-2';
  const range = 'min-w-0 flex-1 accent-[var(--accent,#4f8cff)] pointer-coarse:h-11';
  return (
    <div
      id="ar-anim-params"
      className={cn(
        'grid-cols-1 gap-x-4 gap-y-1 min-[700px]:grid min-[700px]:grid-cols-2',
        props.open ? 'grid' : 'hidden',
      )}
      data-testid="ar-anim-params"
    >
      <label className={field}>
        <span className={label}>{a.speed}</span>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={params.speed}
          className={range}
          data-testid="ar-param-speed"
          onChange={(e) => set({ speed: round(Number(e.currentTarget.value), 0.05) })}
        />
        <output className="w-12 text-right tabular-nums">
          {a.speedValue(formatNumber(params.speed, { maximumFractionDigits: 2 }))}
        </output>
      </label>
      <label className={field}>
        <span className={label}>{a.arms}</span>
        <input
          type="range"
          min={-10}
          max={30}
          step={1}
          value={params.armSpace}
          className={range}
          data-testid="ar-param-arms"
          onChange={(e) => set({ armSpace: Math.round(Number(e.currentTarget.value)) })}
        />
        <output className="w-12 text-right tabular-nums">{a.armsValue(params.armSpace)}</output>
      </label>
      <div className={field}>
        <span className={label}>{a.trim}</span>
        <input
          type="range"
          aria-label={a.trimStart}
          min={0}
          max={duration}
          step={1 / 30}
          value={trim.start}
          className={range}
          data-testid="ar-param-trim-start"
          onChange={(e) => setTrim(Number(e.currentTarget.value), trim.end)}
        />
        <input
          type="range"
          aria-label={a.trimEnd}
          min={0}
          max={duration}
          step={1 / 30}
          value={trim.end}
          className={range}
          data-testid="ar-param-trim-end"
          onChange={(e) => setTrim(trim.start, Number(e.currentTarget.value))}
        />
        <output className="w-20 text-right tabular-nums">
          {a.trimValue(
            formatNumber(trim.start, { maximumFractionDigits: 2 }),
            formatNumber(trim.end, { maximumFractionDigits: 2 }),
          )}
        </output>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={params.mirror}
            data-testid="ar-param-mirror"
            onChange={(e) => set({ mirror: e.currentTarget.checked })}
          />
          {a.mirror}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={params.inPlace}
            data-testid="ar-param-inplace"
            onChange={(e) => set({ inPlace: e.currentTarget.checked })}
          />
          {a.inPlace}
        </label>
        <button
          type="button"
          className={button('ghost', 'sm')}
          disabled={isIdentity(params)}
          onClick={() => {
            clearDraft(ctx.session, entry.id);
            changeParams(ctx, entry.id, IDENTITY);
          }}
        >
          {a.reset}
        </button>
      </div>
    </div>
  );
}

/** *+ Add to character* / *Update* (and *Cancel* while a ✎ edit is open). */
function AddButtons(props: { readonly ctx: WizardContext; readonly entry: StarterPackClip }): JSX.Element {
  const { ctx, entry } = props;
  const a = t();
  const slice = useSession(ctx.session, selectAnimations);
  const ui = useSmall(animationsUi(ctx));
  // *Update* / *Cancel* only on the ✎-edited clip's own library clip (`editTargetOf`); other cards add.
  const editing =
    slice.editing !== null && editTargetOf(ui.manifest, ctx.app.store.get('clips', slice.editing), entry.id) !== null;
  return (
    <div className="flex items-center justify-end gap-2">
      {editing ? (
        <button
          type="button"
          className={button('ghost')}
          data-testid="ar-clip-cancel-edit"
          onClick={() => cancelEdit(ctx)}
        >
          {a.cancelEdit}
        </button>
      ) : null}
      <button
        type="button"
        className={button('primary')}
        disabled={ui.busy !== null || ui.failed.has(entry.id)}
        data-testid="ar-clip-add"
        onClick={() => void addClip(ctx, entry.id)}
      >
        {editing ? a.update : a.add}
      </button>
    </div>
  );
}

function PreviewBar(props: { readonly ctx: WizardContext }): JSX.Element | null {
  const { ctx } = props;
  const a = t();
  const ui = useSmall(animationsUi(ctx));
  const preview = usePreview(ctx);
  const [adjust, setAdjust] = useState(false);
  const entry = entryOf(ui, ui.selected);
  if (entry === null) {
    if (ui.status !== 'ready') return null;
    return (
      <div className="pointer-events-none absolute inset-x-2 bottom-7 flex justify-center">
        <p className="rounded-field bg-panel/90 px-3 py-1 text-fg-2">{a.previewNone}</p>
      </div>
    );
  }
  const playing = preview !== null && preview.clip === entry.id;
  const fraction = playing && preview.duration > 0 ? Math.min(1, preview.seconds / preview.duration) : 0;
  const speed = speedText((ctx.session.getState().animations.draft[entry.id] ?? IDENTITY).speed);
  return (
    <div
      className="pointer-events-auto absolute inset-x-2 bottom-7 flex max-h-[70%] flex-col gap-2 overflow-y-auto rounded-dialog border border-line bg-panel/95 p-2 text-fg shadow-popover"
      data-testid="ar-anim-preview"
      data-clip={entry.id}
      data-playing={playing}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(button(playing ? 'default' : 'primary', 'sm'), 'w-9 px-0')}
          aria-label={playing ? a.stop : a.play}
          title={a.playKey}
          data-testid="ar-preview-toggle"
          onClick={() => void (playing ? stopPreview(ctx) : previewClip(ctx, entry.id))}
        >
          {playing ? '■' : '▶'}
        </button>
        <span className="min-w-0 truncate font-semibold">
          {entry.label}
          {speed === null ? null : <span className="ml-1 font-normal text-fg-2">{speed}</span>}
        </span>
        <progress
          className="h-1.5 min-w-8 flex-1 accent-[var(--accent,#4f8cff)]"
          aria-label={a.previewing(entry.label)}
          max={1}
          value={fraction}
        />
        <span className="shrink-0 text-fg-2 tabular-nums" data-testid="ar-preview-time">
          {a.time(
            formatNumber(playing ? preview.seconds : 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            formatNumber(playing ? preview.duration : entry.duration, { maximumFractionDigits: 1 }),
          )}
        </span>
      </div>
      <Params ctx={ctx} entry={entry} open={adjust} />
      <div className="flex items-center gap-2">
        {/* phones and narrow panes: the parameters fold away so the character stays visible (§8.3) */}
        <button
          type="button"
          className={cn(button('ghost', 'sm'), 'min-[700px]:hidden')}
          aria-expanded={adjust}
          aria-controls="ar-anim-params"
          data-testid="ar-anim-adjust"
          onClick={() => setAdjust((open) => !open)}
        >
          {a.adjust} {adjust ? '▴' : '▾'}
        </button>
        <span className="flex-1" />
        <AddButtons ctx={ctx} entry={entry} />
      </div>
    </div>
  );
}

export default function AnimationsStep(props: StepViewProps): JSX.Element | null {
  return props.slot === 'panel' ? <Panel ctx={props.ctx} /> : <PreviewBar ctx={props.ctx} />;
}
