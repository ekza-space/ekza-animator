// One viewport pane: header (camera menu, lock toggle, display toggles, maximize), the surface registered with the
// ViewportManager (receives pointer input; the shared canvas draws behind it) and the HUD overlay.
import type { CameraRecord } from '@ekza-animator/doc';
import { type EditorApp, PANEL } from '@ekza-animator/editor-core';
import {
  DEFAULT_DISPLAY,
  type DisplayFlags,
  defaultPaneCamera,
  type PaneCamera,
  type PaneState,
  type ViewportManager,
  type ViewPreset,
} from '@ekza-animator/viewport';
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import { CameraRadial, type CameraChoice } from './CameraRadial';
import { usePaneState } from './hooks';
import { PaneMenu, type PaneMenuItem } from './PaneMenu';

const VIEW_PRESETS: readonly ViewPreset[] = ['persp', 'top', 'front', 'side'];

/** Header toggles: display flag, short label, tooltip (hotkeys from MVP-SPEC §4.10). */
const DISPLAY_TOGGLES: readonly {
  readonly flag: keyof DisplayFlags;
  readonly label: string;
  readonly title: string;
}[] = [
  { flag: 'mesh', label: 'Mesh', title: 'Show meshes' },
  { flag: 'controls', label: 'Ctrls', title: 'Show controls (Alt+C)' },
  { flag: 'skeleton', label: 'Joints', title: 'Show skeleton (Alt+J)' },
  { flag: 'xray', label: 'X-ray', title: 'X-ray meshes (Alt+X)' },
  { flag: 'grid', label: 'Grid', title: 'Show grid' },
  { flag: 'hud', label: 'HUD', title: 'Heads-up display' },
  { flag: 'springBones', label: 'Springs', title: 'Preview VRM spring bones during playback' },
];

export function PaneView(props: {
  readonly app: EditorApp;
  readonly vm: ViewportManager | null;
  readonly paneId: string;
}): JSX.Element {
  const { app, vm, paneId } = props;
  const surface = useRef<HTMLDivElement>(null);
  const state = usePaneState(vm, paneId);

  useLayoutEffect(() => {
    const element = surface.current;
    if (vm === null || element === null) return undefined;
    const remembered = vm.rememberedPane(paneId);
    vm.registerPane({
      id: paneId,
      element,
      camera: remembered?.camera ?? defaultPaneCamera(paneId),
      display: remembered?.display ?? DEFAULT_DISPLAY,
    });
    return () => vm.unregisterPane(paneId);
  }, [vm, paneId]);

  // `w-full`: the pane fills the box its layout gives it. In the one-pane layouts (Single, a Space-maximized pane) that
  // box is a row flex container, where a section sized by its content took only its header's width — about 40 % of
  // the panel (fix round 2, M2A-INT-34); the split and quad panes sit in block boxes and always filled them.
  return (
    <section
      className="flex h-full w-full min-h-0 min-w-0 flex-col"
      aria-label={`Viewport pane ${state?.cameraName ?? paneId}`}
    >
      <PaneHeader app={app} paneId={paneId} state={state} />
      <div
        ref={surface}
        className="relative min-h-0 flex-1 overflow-hidden outline-none"
        data-testid={`pane-${paneId}`}
        data-ekza-panel={PANEL.viewport}
        data-ekza-pane={paneId}
      >
        {state === null || state.display.hud ? <Hud app={app} state={state} /> : null}
        {vm !== null && state !== null && state.radial !== null ? (
          <PaneRadial app={app} vm={vm} paneId={paneId} state={state} at={state.radial} />
        ) : null}
      </div>
    </section>
  );
}

/** The pane's cameras: the four view presets, then the live shot cameras by order. */
function useCameraChoices(state: PaneState | null): readonly CameraChoice[] {
  const cameras = useDocQuery(liveCameras, ['cameras']);
  return [
    ...VIEW_PRESETS.map((preset) => ({
      id: preset,
      label: preset,
      camera: { kind: 'view', preset } as const,
      checked: state?.cameraKind === 'view' && state.preset === preset,
    })),
    ...cameras.map((camera) => ({
      id: `shot-${camera.id}`,
      label: camera.locked ? `${camera.name} (locked)` : camera.name,
      camera: { kind: 'shot', cameraId: camera.id } as const,
      checked: state?.shotCameraId === camera.id,
    })),
  ];
}

function PaneRadial(props: {
  readonly app: EditorApp;
  readonly vm: ViewportManager;
  readonly paneId: string;
  readonly state: PaneState;
  readonly at: { readonly x: number; readonly y: number };
}): JSX.Element {
  const choices = useCameraChoices(props.state);
  return <CameraRadial app={props.app} vm={props.vm} paneId={props.paneId} at={props.at} choices={choices} />;
}

/**
 * How many children of a row fit its width, from the left (all of them until the first one that would be cut).
 * Measured from layout, which `visibility: hidden` keeps, so hiding the rest never changes the answer.
 */
function useFittingCount(row: { readonly current: HTMLElement | null }, total: number): number {
  const [fitting, setFitting] = useState(total);
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const limit = element.getBoundingClientRect().right + 0.5;
      const children = [...element.children];
      const first = children.findIndex((child) => child.getBoundingClientRect().right > limit);
      setFitting(first === -1 ? children.length : first);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child); // labels re-measure when a web font lands
    return () => observer.disconnect();
  }, [row]);
  return fitting;
}

function PaneHeader(props: {
  readonly app: EditorApp;
  readonly paneId: string;
  readonly state: PaneState | null;
}): JSX.Element {
  const { app, paneId, state } = props;
  const choices = useCameraChoices(state);
  const run = (op: string, args: unknown): void => {
    void app.runUntyped(op, args, { panel: PANEL.viewport, paneId });
  };
  const lookThrough = (camera: PaneCamera): void => run('view.lookThrough', { paneId, camera });
  const binding = state?.binding;
  const items: PaneMenuItem[] = [
    ...choices.map((choice, index) => ({
      id: choice.id,
      label: choice.label,
      checked: choice.checked,
      separatorBefore: index === VIEW_PRESETS.length,
      onSelect: () => lookThrough(choice.camera),
    })),
    {
      id: 'copy-view-to-shot',
      label: 'Copy view to shot camera',
      separatorBefore: true,
      disabled: state?.cameraKind === 'shot',
      onSelect: () => run('view.copyViewToShot', { paneId }),
    },
    {
      id: 'frame-selection',
      label: 'Frame selection (F)',
      onSelect: () => run('view.frame', { what: 'selection', paneId }),
    },
    { id: 'frame-all', label: 'Frame all (A)', onSelect: () => run('view.frame', { what: 'all', paneId }) },
  ];
  const locked = state?.locked === true;
  const shot = state?.cameraKind === 'shot';
  const toggles = useRef<HTMLDivElement>(null);
  const fitting = useFittingCount(toggles, DISPLAY_TOGGLES.length);
  return (
    <header className="flex h-[22px] shrink-0 items-center gap-0.5 border-b border-line bg-header px-1 text-[11px] text-fg-2">
      <PaneMenu
        label={<span className="max-w-28 truncate">{state?.cameraName ?? '…'}</span>}
        title={binding?.kind === 'shot' ? 'Shot camera' : 'View camera'}
        testId={`pane-camera-menu-${paneId}`}
        items={items}
      />
      <button
        type="button"
        className="grid h-5 w-5 place-items-center rounded hover:bg-[var(--bg-hover,#30323a)] disabled:opacity-40 aria-pressed:text-[var(--locked-badge,#e3b34a)]"
        aria-pressed={locked}
        disabled={!shot}
        title={shot ? (locked ? 'Unlock camera (Alt+L)' : 'Lock camera (Alt+L)') : 'Only shot cameras can be locked'}
        aria-label={locked ? 'Unlock camera' : 'Lock camera'}
        data-testid={`pane-lock-${paneId}`}
        onClick={() => run('view.toggleCameraLock', { paneId })}
      >
        <LockIcon locked={locked} />
      </button>
      <span className="mx-1 h-3 w-px shrink-0 bg-line" aria-hidden="true" />
      {/* The toggles that do not fit the pane's width are hidden (never wrapped or cut) and listed in the "»" menu
          (acceptance round 2: at 1024 px "X-ray" wrapped and "Springs" was cut). */}
      <div ref={toggles} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {DISPLAY_TOGGLES.map(({ flag, label, title }, index) => {
          const on = state?.display[flag] ?? DEFAULT_DISPLAY[flag];
          const hidden = index >= fitting;
          return (
            <button
              key={flag}
              type="button"
              className={`h-5 shrink-0 whitespace-nowrap rounded px-1 text-fg-3 hover:bg-[var(--bg-hover,#30323a)] aria-pressed:bg-[var(--bg-pressed,#3a3d46)] aria-pressed:text-fg ${hidden ? 'invisible' : ''}`}
              aria-pressed={on}
              title={title}
              data-testid={`pane-display-${flag}-${paneId}`}
              data-overflow={hidden ? 'true' : undefined}
              onClick={() => run('view.display.toggle', { flag, paneId })}
            >
              {label}
            </button>
          );
        })}
      </div>
      {fitting < DISPLAY_TOGGLES.length ? (
        <PaneMenu
          label={<span aria-hidden="true">»</span>}
          title="More display toggles"
          testId={`pane-display-more-${paneId}`}
          align="right"
          items={DISPLAY_TOGGLES.slice(fitting).map(({ flag, title }) => ({
            id: flag,
            label: title,
            checkbox: true,
            checked: state?.display[flag] ?? DEFAULT_DISPLAY[flag],
            onSelect: () => run('view.display.toggle', { flag, paneId }),
          }))}
        />
      ) : null}
      <button
        type="button"
        className="grid h-5 w-5 place-items-center rounded hover:bg-[var(--bg-hover,#30323a)]"
        title="Maximize pane (Space)"
        aria-label="Maximize pane"
        data-testid={`pane-maximize-${paneId}`}
        onClick={() => run('view.toggleMaximize', { paneId })}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1.5 4.5v-3h3M7.5 1.5h3v3M10.5 7.5v3h-3M4.5 10.5h-3v-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </button>
    </header>
  );
}

function liveCameras(store: { list(table: 'cameras'): readonly CameraRecord[] }): readonly CameraRecord[] {
  return [...store.list('cameras')]
    .filter((camera) => camera.deleted === null)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
}

function LockIcon(props: { readonly locked: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d={props.locked ? 'M4 5.5V4a2 2 0 0 1 4 0v1.5' : 'M4 5.5V4a2 2 0 0 1 3.9-.6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/**
 * HUD (MVP-SPEC §1.1, research 09 §4.4): camera name and LOCKED badge top-left, "Feet pinned", clip frame and scene
 * seconds bottom-right. Time readouts are written imperatively (no React render per frame during playback).
 */
function Hud(props: { readonly app: EditorApp; readonly state: PaneState | null }): JSX.Element {
  const { app, state } = props;
  const frameRef = useRef<HTMLSpanElement>(null);
  const secondsRef = useRef<HTMLSpanElement>(null);
  const feetPinned = useSession((s) => s.feetPins !== null && s.feetPins.character === s.activeCharacter);
  const flashing = useLockFlash(state?.lockFlash ?? 0);

  useEffect(() => {
    const write = (): void => {
      const session = app.session.getState();
      const character = session.activeCharacter;
      const frame = character === null ? null : app.evaluation.clipFrame(character);
      const fps = app.store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
      // Only real changes touch the DOM: the store calls this for every batch (drag previews included), and an
      // unchanged text written again still replaces the text node, which invalidates layout for the frame (M-1).
      setText(frameRef.current, frame === null ? '' : `f ${formatFrame(frame)}`);
      setText(secondsRef.current, `${((session.time.sceneFrame * fps.den) / fps.num).toFixed(2)} s`);
    };
    write();
    const unsubscribeSession = app.session.subscribe((next, previous) => {
      if (
        next.time !== previous.time ||
        next.activeCharacter !== previous.activeCharacter ||
        next.activeClip !== previous.activeClip
      ) {
        write();
      }
    });
    const unsubscribeStore = app.store.subscribe(write);
    return () => {
      unsubscribeSession();
      unsubscribeStore();
    };
  }, [app]);

  const locked = state?.locked === true;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none text-[11px] text-fg-2">
      <div className="absolute left-2 top-1.5 flex items-center gap-1.5" data-testid="pane-hud-camera">
        <span>{state?.cameraName ?? ''}</span>
        {locked ? (
          <span
            className={`rounded-sm px-1 text-[10px] font-semibold tracking-wide text-[#1b1c1f] ${flashing ? 'bg-[#fff1c2]' : 'bg-[var(--locked-badge,#e3b34a)]'}`}
            data-testid="pane-hud-locked"
            data-flash={flashing ? 'true' : undefined}
          >
            LOCKED
          </span>
        ) : null}
      </div>
      <div className="absolute bottom-1.5 right-2 flex items-center gap-2 tabular-nums">
        {feetPinned ? (
          <span className="rounded-sm bg-[var(--bg-pressed,#3a3d46)] px-1 text-fg" data-testid="pane-hud-feet-pinned">
            Feet pinned
          </span>
        ) : null}
        <span ref={secondsRef} className="text-fg-3" data-testid="pane-hud-seconds" />
        <span ref={frameRef} className="text-fg" data-testid="pane-hud-frame" />
      </div>
    </div>
  );
}

function setText(element: HTMLElement | null, text: string): void {
  if (element !== null && element.textContent !== text) element.textContent = text;
}

/** True for 300 ms after `counter` changes (a locked camera swallowed navigation). */
function useLockFlash(counter: number): boolean {
  const [flashing, setFlashing] = useState(false);
  const first = useRef(counter);
  useEffect(() => {
    if (counter === first.current) return undefined;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 300);
    return () => clearTimeout(timer);
  }, [counter]);
  return flashing;
}

function formatFrame(frame: number): string {
  return Number.isInteger(frame) ? String(frame) : frame.toFixed(1);
}
