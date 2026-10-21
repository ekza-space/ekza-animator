// The Getting started card (M6A-SPEC §8.8; research 16 §16.3; B13; lazy chunk): six steps at the top-right of the
// pane, ticked as the scene gets there — ① create a primitive (a mesh exists) ② face mode (entered) ③ extrude and type
// a value (an Extrude ran) ④ Symmetry › Object X (a symmetry is on) ⑤ colour faces (a face carries a non-default
// slot) ⑥ export the model (a static model export finished). Steps ②–⑥ stay ticked once reached in this session.
// Every key comes from the keymap (`KeymapManager.label` through `shortcutFor`); the card never takes input outside
// its own buttons, and ✕ dismisses it for this browser.
import type { DocumentStore } from '@ekza-studio/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-studio/editor-core';
import { type JSX, useEffect, useRef, useState } from 'react';
import { useDocQuery } from '../../hooks';
import { scopeChain } from '../../input/keyboard';
import { shortcutFor } from '../../shell/menus';
import { useMeshRuntimesVersion } from '../palette/hooks';
import { setGettingStartedDismissed } from './modelOverlays';
import { useModelExported } from './modelProgress';
import { useOwnPointer } from './ownPointer';

interface Progress {
  readonly created: boolean;
  readonly face: boolean;
  readonly extruded: boolean;
  readonly symmetry: boolean;
  readonly painted: boolean;
  readonly exported: boolean;
}

const hasMesh = (store: DocumentStore): boolean => store.list('meshes').length > 0;

/** Whether a mesh has a face painted with a slot other than 0 (the default every primitive starts with). */
export function anyFacePainted(app: EditorApp, store: DocumentStore): boolean {
  for (const record of store.list('meshes')) {
    const data = app.meshes.get(record.id)?.data() ?? null;
    const layer = data?.layers.get('paint');
    if (data === null || layer === undefined) continue;
    for (let f = 0; f < data.counts.faces; f++) if (layer.data[f] !== 0) return true;
  }
  return false;
}

/** Painting reached in this session, per app (step ⑤ stays ticked after an undo or a recolour back to slot 0). */
const paintedApps = new WeakSet<EditorApp>();

/** Steps reached in this session, per app: once ticked they stay ticked (a later run or mode switch moves on). */
const reachedSteps = new WeakMap<EditorApp, { face: boolean; extruded: boolean; symmetry: boolean }>();

function markReached(app: EditorApp, s: SessionState): string {
  const reached = reachedSteps.get(app) ?? { face: false, extruded: false, symmetry: false };
  reached.face ||= s.model.componentMode === 'face' || s.model.lastComponentMode === 'face';
  reached.extruded ||= s.lastRun?.id === 'mesh.extrude';
  reached.symmetry ||= [...s.model.symmetry.values()].some((settings) => settings.mode !== 'off');
  reachedSteps.set(app, reached);
  return [reached.face, reached.extruded, reached.symmetry].join(',');
}

export default function GettingStarted(props: { readonly app: EditorApp; readonly paneId: string }): JSX.Element {
  const { app, paneId } = props;
  // Re-renders on mesh record changes (a paint commit writes a revision) and when runtimes load or rebuild.
  const created = useDocQuery(hasMesh, ['meshes']);
  useMeshRuntimesVersion(app);
  const painted = paintedApps.has(app) || anyFacePainted(app, app.store);
  useEffect(() => {
    if (painted) paintedApps.add(app);
  }, [app, painted]);
  const exported = useModelExported(app);
  const card = useRef<HTMLElement>(null);
  useOwnPointer(card);
  const [reachedKey, setReachedKey] = useState(() => markReached(app, app.session.getState()));
  useEffect(() => app.session.subscribe((state) => setReachedKey(markReached(app, state))), [app]);
  const [face, extruded, symmetry] = reachedKey.split(',').map((v) => v === 'true');
  const progress: Progress = {
    created,
    face: face === true,
    extruded: extruded === true,
    symmetry: symmetry === true,
    painted,
    exported,
  };
  const scopes = scopeChain(app, { kind: PANEL.viewport, scope: PANEL.viewport, paneId }).scopes;
  const key = (op: string, args?: unknown): string | null => shortcutFor(app.keymap, op, args, scopes);
  const chord = (label: string | null): JSX.Element | null =>
    label === null ? null : (
      <kbd className="rounded-[3px] bg-[var(--bg-field,#17181b)] px-1 font-sans text-fg">{label}</kbd>
    );
  const steps: readonly { readonly done: boolean; readonly body: JSX.Element }[] = [
    { done: progress.created, body: <>Create a primitive</> },
    {
      done: progress.face,
      body: <>Face mode {chord(key('select.mode', { mode: 'face' }))}</>,
    },
    {
      done: progress.extruded,
      body: <>Extrude {chord(key('mesh.extrude'))} and type a value</>,
    },
    { done: progress.symmetry, body: <>Symmetry › Object X</> },
    { done: progress.painted, body: <>Colour faces in the Palette</> },
    {
      done: progress.exported,
      body: <>Export model {chord(key('ui.open', { dialog: 'export' }))}</>,
    },
  ];
  return (
    <section
      ref={card}
      className="pointer-events-auto w-56 rounded-md border border-line bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] p-2 text-[11px] text-fg-2 shadow"
      aria-label="Getting started"
      data-testid="getting-started"
    >
      <header className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-fg">Getting started</h2>
        <button
          type="button"
          className="grid size-5 place-items-center rounded text-fg-3 hover:bg-[var(--bg-hover,#30323a)] hover:text-fg"
          aria-label="Dismiss Getting started"
          title="Dismiss"
          data-testid="getting-started-dismiss"
          onClick={() => setGettingStartedDismissed(true)}
        >
          ✕
        </button>
      </header>
      <ol className="flex flex-col gap-0.5">
        {steps.map((step, i) => (
          <li
            // oxlint-disable-next-line react/no-array-index-key -- a fixed list of six steps
            key={i}
            className={`flex items-baseline gap-1.5 ${step.done ? 'text-fg-3 line-through decoration-fg-3' : ''}`}
            data-testid={`getting-started-step-${i + 1}`}
            data-done={step.done ? 'true' : undefined}
          >
            <span className="w-3 shrink-0 text-center" aria-hidden="true">
              {step.done ? '✓' : String.fromCodePoint(0x2460 + i)}
            </span>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
