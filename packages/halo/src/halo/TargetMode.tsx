// Verb → target (STUDIO-TOUCH-SPEC §6.4): a verb that needs a second thing — Parent to…, and later Bridge to…, Weld
// to…, Copy pose to… — enters a "now tap the target" state, drawn as a glowing line from the subject to the finger or
// the Pencil, with ✕ Cancel in the session bar's place. The next tap on the canvas picks the target (the grammar runs
// the verb); this replaces drag-and-drop, modifiers and Outliner drags for edits that involve two objects.
import { type Box, Cluster, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useState } from 'react';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import { Icon } from './icons';

export function TargetBar({
  controller,
  top,
}: {
  readonly controller: HaloController;
  readonly top: number;
}): JSX.Element | null {
  const { store } = controller.ctx;
  const target = useHaloStore(store, (s) => s.target);
  if (target === null) return null;
  return (
    <div
      data-halo-chrome=""
      data-testid="halo-target"
      className="pointer-events-none absolute inset-x-0 flex justify-center px-(--touch-inset-left)"
      style={{ top }}
    >
      <Cluster
        role="toolbar"
        aria-label={target.label}
        className="pointer-events-auto flex items-center gap-1.5 p-[5px]"
      >
        <TouchButton variant="ghost" className="gap-1.5" onClick={() => store.set({ target: null })}>
          <Icon name="close" />
          {en.session.cancel}
        </TouchButton>
        <span className="px-2 font-semibold whitespace-nowrap">{target.label}</span>
        <span className="px-1 text-touch-label text-fg-2">{en.halo.targetHint}</span>
      </Cluster>
    </div>
  );
}

/** The line from the subject to the pointer (pane px), while a verb waits for its target. */
export function TargetLine({
  box,
  origin,
}: {
  readonly box: Box | null;
  readonly origin: { x: number; y: number };
}): JSX.Element | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent): void => setAt({ x: e.clientX - origin.x, y: e.clientY - origin.y });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', move);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
    };
  }, [origin.x, origin.y]);
  if (box === null || at === null) return null;
  const from = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <line
        x1={from.x}
        y1={from.y}
        x2={at.x}
        y2={at.y}
        stroke="var(--accent)"
        strokeWidth={3}
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px var(--accent))' }}
      />
      <circle cx={from.x} cy={from.y} r={5} fill="var(--accent)" />
    </svg>
  );
}
