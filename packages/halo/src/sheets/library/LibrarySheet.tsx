// The Library (STUDIO-TOUCH-SPEC §10.6, §15.9, J5; T7): the starter pack's CC0 animations as cards, with search and
// kinds. Tap a card and it plays on your character at once (`library.preview`; the chrome stays live, *Stop preview* is
// on the card). Expand a card for its parameters — ⟨Speed⟩, Trim, *Swap sides*, *Stay in place*, *Arms out* — each
// previewed live; *Add* puts it on the character (`library.useClip`, one Use Clip step, Pro's Clip Library call).
// *Add starter set* adds Idle · Walk · Run with their slots; *+ From file* imports a `.vrma` or an animation GLB
// (`file.importAnimation`). A lazy chunk (§20.6), on the T6b sheet contract.
import type { CharacterId } from '@ekza-studio/doc';
import type { ClipParams, EditorApp } from '@ekza-studio/editor-core';
import { Segmented, ToggleChip, TouchButton, ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloSheetProps } from '../../manifest/sheets';
import { AnimateGlyph } from '../../stages/animate/icons';
import { animateCharacter } from '../../stages/animate/model';
import { HaloSheet, useAppVersion } from '../more/kit';
import {
  ARMS_OUT_DEG,
  addCall,
  cardLine,
  filterLibrary,
  IDENTITY_PARAMS,
  LIBRARY_KINDS,
  type LibraryKind,
  previewCall,
  starterCalls,
  trimOf,
} from './model';

const w = animateWords.library;

type Manifest = Awaited<ReturnType<EditorApp['library']['service']['manifest']>>;
type Entry = Manifest['clips'][number];

/** The sheet context: its `touch` is the frame's journey counter (P-T7-2, §9). */
export type CountingSheetContext = HaloSheetProps['ctx'];

/** A touch on the sheet. */
function useCount(ctx: CountingSheetContext): () => void {
  return () => ctx.touch?.();
}

function Card({
  entry,
  params,
  open,
  previewing,
  onPreview,
  onToggle,
  onParams,
  onAdd,
  onStop,
  busy,
  count,
}: {
  readonly entry: Entry;
  readonly params: ClipParams;
  readonly open: boolean;
  readonly previewing: boolean;
  readonly onPreview: () => void;
  readonly onToggle: () => void;
  readonly onParams: (next: ClipParams) => void;
  readonly onAdd: () => void;
  readonly onStop: () => void;
  readonly busy: boolean;
  readonly count: () => void;
}): JSX.Element {
  const trim = params.trim ?? { start: 0, end: entry.duration };
  return (
    <div
      className={`flex flex-col gap-2 rounded-touch-card border p-2 ${previewing ? 'border-accent/70 bg-accent-soft' : 'border-line bg-panel'}`}
      data-testid={`halo-library-card-${entry.id}`}
      data-previewing={previewing ? '' : undefined}
      data-open={open ? '' : undefined}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex min-h-(--touch-hit) min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-touch-inner px-2 text-left hover:bg-hover active:bg-pressed"
          aria-label={`${w.preview} ${entry.label}`}
          aria-pressed={previewing}
          data-testid={`halo-library-preview-${entry.id}`}
          onClick={onPreview}
        >
          <span className="text-accent-text">
            <AnimateGlyph name="person" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-fg">{entry.label}</span>
            <span className="truncate text-touch-label text-fg-3">
              {cardLine(entry.loop, entry.duration, { loop: 'Loop', once: 'Once' })}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="inline-flex size-(--touch-hit) shrink-0 cursor-pointer items-center justify-center rounded-touch-inner text-fg-2 hover:bg-hover"
          aria-label={open ? w.collapse : w.expand(entry.label)}
          aria-expanded={open}
          data-testid={`halo-library-expand-${entry.id}`}
          onClick={onToggle}
        >
          <AnimateGlyph name="down" />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 px-1 pb-1" data-testid={`halo-library-params-${entry.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <ValueChip
              label={w.speed}
              value={params.speed}
              step={0.05}
              min={0.25}
              max={3}
              unit="×"
              data-testid={`halo-library-speed-${entry.id}`}
              onChange={(speed) => onParams({ ...params, speed })}
              onCommit={(speed) => {
                count();
                onParams({ ...params, speed });
              }}
            />
            <ValueChip
              label={w.trimStart}
              value={trim.start}
              step={0.01}
              min={0}
              max={entry.duration}
              unit="s"
              data-testid={`halo-library-trim-start-${entry.id}`}
              onCommit={(start) => {
                count();
                const next = trimOf(start, trim.end, entry.duration);
                if (next !== undefined) onParams({ ...params, trim: next });
              }}
            />
            <ValueChip
              label={w.trimEnd}
              value={trim.end}
              step={0.01}
              min={0}
              max={entry.duration}
              unit="s"
              data-testid={`halo-library-trim-end-${entry.id}`}
              onCommit={(end) => {
                count();
                const next = trimOf(trim.start, end, entry.duration);
                if (next !== undefined) onParams({ ...params, trim: next });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleChip
              label={w.swapSides}
              pressed={params.mirror}
              data-testid={`halo-library-mirror-${entry.id}`}
              onPressedChange={(mirror) => {
                count();
                onParams({ ...params, mirror });
              }}
            />
            <ToggleChip
              label={w.stayInPlace}
              pressed={params.inPlace}
              data-testid={`halo-library-inplace-${entry.id}`}
              onPressedChange={(inPlace) => {
                count();
                onParams({ ...params, inPlace });
              }}
            />
            <ToggleChip
              label={w.armsOut}
              pressed={params.armSpace !== 0}
              data-testid={`halo-library-arms-${entry.id}`}
              onPressedChange={(on) => {
                count();
                onParams({ ...params, armSpace: on ? ARMS_OUT_DEG : 0 });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TouchButton variant="primary" disabled={busy} data-testid={`halo-library-add-${entry.id}`} onClick={onAdd}>
              {w.add}
            </TouchButton>
            {previewing ? (
              <TouchButton data-testid={`halo-library-stop-${entry.id}`} onClick={onStop}>
                {w.stopPreview}
              </TouchButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LibrarySheet({ ctx }: { readonly ctx: CountingSheetContext }): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const count = useCount(ctx);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | LibraryKind>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ClipParams>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [, setPreviewTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const character: CharacterId | null = animateCharacter(app);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    (app.library.loaded ? Promise.resolve() : app.library.load())
      .then(() => app.library.service.manifest())
      .then(
        (next) => {
          if (!alive) return;
          setManifest(next);
          setStatus('ready');
        },
        () => {
          if (alive) setStatus('error');
        },
      );
    return () => {
      alive = false;
    };
  }, [app, attempt]);
  const load = (): void => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  };
  // the preview's state lives in the library service: follow it
  useEffect(() => {
    if (!app.library.loaded) return undefined;
    return app.library.service.subscribe(() => setPreviewTick((n) => n + 1));
  }, [app, status]);

  const preview = app.library.loaded ? app.library.service.preview : null;
  const draftOf = (id: string): ClipParams => drafts.get(id) ?? IDENTITY_PARAMS;
  const run = (op: string, args?: unknown) => ctx.run(op, args);

  const startPreview = (id: string, params: ClipParams): void => {
    if (character === null) return;
    const call = previewCall(character, id, params);
    void run(call.op, call.args);
  };
  const stopPreview = (): void => {
    if (app.library.loaded && app.library.service.preview !== null) void run('library.stop');
  };
  const close = (): void => {
    stopPreview();
    ctx.close();
  };
  const changeParams = (id: string, next: ClipParams): void => {
    setDrafts((current) => new Map(current).set(id, next));
    if (preview?.clip !== id) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      startPreview(id, next);
    }, 200);
  };
  const add = async (id: string): Promise<void> => {
    count();
    if (character === null || busy !== null) return;
    setBusy(id);
    const call = addCall(character, id, draftOf(id));
    const result = await run(call.op, call.args);
    setBusy(null);
    if (result.status === 'finished') stopPreview();
  };
  const addStarter = async (): Promise<void> => {
    count();
    if (character === null || manifest === null || busy !== null) return;
    setBusy('starter');
    for (const call of starterCalls(character, new Set(manifest.clips.map((c) => c.id)))) {
      const result = await run(call.op, call.args);
      if (result.status !== 'finished') break;
    }
    setBusy(null);
  };
  const fromFile = async (picked: File): Promise<void> => {
    if (character === null) return;
    const bytes = new Uint8Array(await picked.arrayBuffer());
    await run('file.importAnimation', { name: picked.name, bytes, character });
  };

  const clips = manifest === null ? [] : filterLibrary(manifest.clips, kind, query);
  return (
    <HaloSheet ctx={{ ...ctx, close }} id="library" title={w.title} description={w.description}>
      <div className="flex flex-col gap-3 pb-2" data-testid="halo-library">
        {character === null ? <p className="m-0 text-fg-2">{w.needsCharacter}</p> : null}
        <label className="flex items-center gap-2 rounded-touch-inner border border-line bg-field px-3">
          <AnimateGlyph name="search" />
          <input
            className="h-(--touch-hit) min-w-0 flex-1 bg-transparent text-(length:--touch-input-text) text-fg outline-none"
            placeholder={w.search}
            aria-label={w.search}
            value={query}
            data-testid="halo-library-search"
            onPointerDown={count}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="overflow-x-auto" data-touch-scroll="">
          <Segmented<'all' | LibraryKind>
            label={w.category}
            data-testid="halo-library-kinds"
            value={kind}
            onValueChange={(next) => {
              count();
              setKind(next);
            }}
            items={LIBRARY_KINDS.map((value) => ({ value, label: w.categories[value] ?? value }))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <TouchButton
            disabled={character === null || manifest === null || busy !== null}
            data-testid="halo-library-starter"
            onClick={() => void addStarter()}
          >
            {w.starterSet}
          </TouchButton>
          <TouchButton
            disabled={character === null}
            data-testid="halo-library-from-file"
            onClick={() => {
              count();
              file.current?.click();
            }}
          >
            {w.fromFile}
          </TouchButton>
          <input
            ref={file}
            type="file"
            accept=".vrma,.glb,.gltf"
            hidden
            data-halo-uncounted=""
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked !== undefined) void fromFile(picked);
            }}
          />
        </div>
        {status === 'loading' ? <p className="m-0 text-fg-3">{w.loading}</p> : null}
        {status === 'error' ? (
          <div className="flex items-center gap-2">
            <p className="m-0 flex-1 text-fg-2">{w.failed}</p>
            <TouchButton onClick={load}>{w.retry}</TouchButton>
          </div>
        ) : null}
        {status === 'ready' && clips.length === 0 ? <p className="m-0 text-fg-3">{w.none}</p> : null}
        <div className="grid grid-cols-1 gap-2" data-testid="halo-library-cards">
          {clips.map((entry) => (
            <Card
              key={entry.id}
              entry={entry}
              params={draftOf(entry.id)}
              open={open === entry.id}
              previewing={preview?.clip === entry.id}
              busy={busy !== null}
              count={count}
              onPreview={() => {
                count();
                if (preview?.clip === entry.id) stopPreview();
                else startPreview(entry.id, draftOf(entry.id));
              }}
              onToggle={() => {
                count();
                setOpen(open === entry.id ? null : entry.id);
              }}
              onParams={(next) => changeParams(entry.id, next)}
              onAdd={() => void add(entry.id)}
              onStop={() => {
                count();
                stopPreview();
              }}
            />
          ))}
        </div>
      </div>
    </HaloSheet>
  );
}
