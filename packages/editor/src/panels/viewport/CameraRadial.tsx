// Space-hold camera radial (M1-stretch, MVP-SPEC §4.10 `Space` hold → view.cameraRadial): the pane's cameras on a
// ring around the pointer. Moving the pointer towards an item highlights it and releasing Space looks through it; a
// click on an item does the same. Escape, a press elsewhere or a release in the centre closes it unchanged.
import { type EditorApp, PANEL, type PaneCamera } from '@ekza-animator/editor-core';
import type { ViewportManager } from '@ekza-animator/viewport';
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface CameraChoice {
  readonly id: string;
  readonly label: string;
  readonly camera: PaneCamera;
  readonly checked: boolean;
}

/** Item ring radius and the centre dead zone, CSS px. */
export const RADIAL_RADIUS_PX = 72;
const DEAD_ZONE_PX = 18;

/** Item centre offsets (CSS px from the radial centre): clockwise from the top. */
export function radialOffsets(count: number): readonly { readonly x: number; readonly y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(count, 1);
    return { x: Math.cos(angle) * RADIAL_RADIUS_PX, y: Math.sin(angle) * RADIAL_RADIUS_PX };
  });
}

/** The item a pointer offset (dx, dy) from the centre points at: nearest angle outside the dead zone, else null. */
export function radialItemAt(count: number, dx: number, dy: number): number | null {
  if (count === 0 || Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  const step = (2 * Math.PI) / count;
  const angle = Math.atan2(dy, dx) + Math.PI / 2; // 0 at the top, clockwise
  const index = Math.round((((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / step) % count;
  return index;
}

/** Closes the radial and looks the pane through `camera` (nothing for null). */
function finish(app: EditorApp, vm: ViewportManager, paneId: string, camera: PaneCamera | null): void {
  vm.closeRadial();
  if (camera !== null) void app.run('view.lookThrough', { paneId, camera }, { panel: PANEL.viewport, paneId });
}

export function CameraRadial(props: {
  readonly app: EditorApp;
  readonly vm: ViewportManager;
  readonly paneId: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly choices: readonly CameraChoice[];
}): JSX.Element {
  const { app, vm, paneId, at, choices } = props;
  const root = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<number | null>(null);
  const hotRef = useRef<number | null>(null);
  // Latest props for the window listeners, which stay subscribed while the radial is open.
  const choicesRef = useRef(choices);
  const atRef = useRef(at);
  useLayoutEffect(() => {
    choicesRef.current = choices;
    atRef.current = at;
  });

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const pane = vm.paneRect(paneId);
      if (pane === null) return;
      const centre = atRef.current;
      const index = radialItemAt(
        choicesRef.current.length,
        e.clientX - pane.x - centre.x,
        e.clientY - pane.y - centre.y,
      );
      hotRef.current = index;
      setHot(index);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      const index = hotRef.current;
      finish(app, vm, paneId, index === null ? null : (choicesRef.current[index]?.camera ?? null));
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      vm.closeRadial();
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node && root.current?.parentElement?.contains(e.target) === true)) vm.closeRadial();
    };
    const onBlur = (): void => vm.closeRadial();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [app, vm, paneId]);

  const offsets = radialOffsets(choices.length);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 select-none"
      data-testid={`pane-radial-${paneId}`}
      role="menu"
      aria-label="Look through camera"
    >
      {/* Zero-size anchor at the radial centre: items are positioned around it. */}
      <div ref={root} className="absolute h-0 w-0" style={{ left: at.x, top: at.y }}>
        <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-[var(--border-strong,#4b4e58)] bg-[var(--bg-panel,#232428)]" />
        {choices.map((choice, i) => {
          const offset = offsets[i] ?? { x: 0, y: 0 };
          const isHot = hot === i;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.checked}
              className={`pointer-events-auto absolute max-w-28 -translate-x-1/2 -translate-y-1/2 truncate whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] ${
                isHot
                  ? 'border-accent bg-accent-fill text-white'
                  : 'border-line bg-[var(--bg-popover,#2c2e34)] text-fg hover:bg-[var(--bg-hover,#30323a)]'
              }`}
              style={{ left: offset.x, top: offset.y }}
              data-testid={`pane-radial-${paneId}-${choice.id}`}
              data-hot={isHot ? 'true' : undefined}
              onClick={() => finish(app, vm, paneId, choice.camera)}
            >
              {choice.checked ? '• ' : ''}
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
