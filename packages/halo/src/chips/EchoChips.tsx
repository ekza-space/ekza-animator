// Echo chips (STUDIO-TOUCH-SPEC §5.6, D5): after an operator whose runs can be adjusted (`flags.adjustable`, the
// `edit.adjustLast` contract), its parameters float as chips beside the result — `⟨Distance 0.12 m⟩ ⟨Segments 2⟩` —
// never over the selection. Drag a chip sideways to change it (distance scrub: finer the farther the finger moves
// away; the Thumb key's Fine works too), tap it for the numpad; each change is one Adjust Last (it replaces the step).
// Same numbers as Pro (P14): Pro's units — metres, degrees for angles (stored in radians), plain counts.
import type { ParamDef } from '@ekza-studio/anim-core';
import type { LastRun } from '@ekza-studio/editor-core';
import { ActionChip, type Box, ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useState } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useSessionValue } from '../shell/hooks';
import { useHaloStore } from '../shell/store';

const NumpadPanel = lazy(() => import('./NumpadPanel'));

const RAD = 180 / Math.PI;

/** A chip's display of a ParamDef: Pro's unit and step, and the conversion from the stored value. */
export function chipOf(param: ParamDef): {
  readonly unit?: string;
  readonly step: number;
  readonly toShown: (stored: number) => number;
  readonly toStored: (shown: number) => number;
  readonly min?: number;
  readonly max?: number;
} {
  const angle = param.kind === 'angle';
  const toShown = (v: number): number => (angle ? v * RAD : v);
  const toStored = (v: number): number => (angle ? v / RAD : param.kind === 'int' ? Math.round(v) : v);
  const step =
    param.kind === 'int' ? 1 : angle ? 1 : param.kind === 'distance' ? (param.step ?? 0.01) : (param.step ?? 0.01);
  return {
    ...(param.kind === 'distance' ? { unit: 'm' } : angle ? { unit: '°' } : {}),
    step,
    toShown,
    toStored,
    ...(param.min === undefined ? {} : { min: toShown(param.min) }),
    ...(param.max === undefined ? {} : { max: toShown(param.max) }),
  };
}

/** At most this many chips float beside a result (§5.6: `⟨Distance 0.12 m⟩ ⟨Segments 2⟩`); the rest are Options. */
export const MAX_ECHO = 3;

/**
 * The params a live, adjustable last run shows as chips: the primary one first, then the counts (segments,
 * divisions), then the other numbers in their order — visible, numeric, not pointer-bound, at most `MAX_ECHO`. The
 * operator's full option box is Options (T6b).
 */
export function echoParams(last: LastRun | null): readonly ParamDef[] {
  if (last === null || !last.adjustable || last.closed !== null) return [];
  const numbers = last.params.filter(
    (p) => p.hidden !== true && p.kind !== 'data' && p.bound !== 'pointer' && typeof last.args[p.name] === 'number',
  );
  // the primary value, the counts, then the ones with a plain name (Offset, Thickness), then the rest
  const rank = (p: ParamDef): number =>
    p.primary === true ? 0 : p.kind === 'int' ? 1 : en.chips.params[p.name] !== undefined ? 2 : 3;
  return [...numbers].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ECHO);
}

/** A chip's plain label (§3 P8): the common parameter names in plain words; Pro's label otherwise. */
export function chipLabel(param: ParamDef): string {
  return en.chips.params[param.name] ?? param.label;
}

export function EchoChips({
  controller,
  box,
  width,
  height,
  insetBottom,
}: {
  readonly controller: HaloController;
  readonly box: Box | null;
  readonly width: number;
  readonly height: number;
  readonly insetBottom: number;
}): JSX.Element | null {
  const { ctx } = controller;
  const last = useSessionValue(ctx.app, (s) => s.lastRun);
  const fine = useHaloStore(ctx.store, (s) => s.thumb.latch !== 'off');
  const [live, setLive] = useState<Readonly<Record<string, number>>>({});
  const [numpad, setNumpad] = useState<{ readonly name: string; readonly left: number; readonly top: number } | null>(
    null,
  );
  const params = echoParams(last);
  if (last === null || params.length === 0) return null;
  const adjust = (name: string, stored: number | boolean): void => {
    setLive({});
    void ctx.run('edit.adjustLast', { args: { [name]: stored } }).then(() => ctx.store.set({ form: null }));
  };
  // beside the result, never over it: right of the box when there is room, else below it
  const room = box === null ? 0 : width - box.right;
  const left = box === null ? 16 : room >= 260 ? box.right + 20 : Math.max(16, box.left);
  const top =
    box === null
      ? height - insetBottom - 120
      : room >= 260
        ? box.top
        : Math.min(height - insetBottom - 60, box.bottom + 16);
  const param = numpad === null ? null : (params.find((p) => p.name === numpad.name) ?? null);
  return (
    <div
      data-halo-chrome=""
      data-halo-echo=""
      data-testid="halo-echo"
      className="pointer-events-auto absolute flex max-w-[min(520px,calc(100%-32px))] flex-wrap items-center gap-2"
      style={{ left, top }}
    >
      {params.map((p) => {
        const shape = chipOf(p);
        const stored = last.args[p.name] as number;
        const shown = live[p.name] ?? shape.toShown(stored);
        return (
          <ValueChip
            key={p.name}
            data-testid={`halo-chip-${p.name}`}
            label={chipLabel(p)}
            proName={`${last.label} · ${p.label}`}
            value={shown}
            step={shape.step}
            {...(shape.unit === undefined ? {} : { unit: shape.unit })}
            {...(shape.min === undefined ? {} : { min: shape.min })}
            {...(shape.max === undefined ? {} : { max: shape.max })}
            modifier={fine ? 0.1 : 1}
            onChange={(v) => setLive((prev) => ({ ...prev, [p.name]: v }))}
            onCommit={(v) => adjust(p.name, shape.toStored(v))}
            onOpenNumpad={(chip) => {
              const host = chip.offsetParent?.getBoundingClientRect();
              const r = chip.getBoundingClientRect();
              setNumpad({ name: p.name, left: r.left - (host?.left ?? 0), top: r.bottom - (host?.top ?? 0) + 8 });
            }}
          />
        );
      })}
      {last.repeatable ? (
        <ActionChip icon={<Icon name="again" />} onClick={() => void ctx.run('edit.repeatLast')}>
          {en.chips.again}
        </ActionChip>
      ) : null}
      {numpad === null || param === null ? null : (
        <Suspense fallback={null}>
          <NumpadPanel
            label={chipLabel(param)}
            proName={`${last.label} · ${param.label}`}
            value={chipOf(param).toShown(last.args[param.name] as number)}
            {...(chipOf(param).unit === undefined ? {} : { unit: chipOf(param).unit as string })}
            style={{ position: 'absolute', left: 0, top: '100%', marginTop: 8 }}
            onDone={(v) => {
              setNumpad(null);
              adjust(param.name, chipOf(param).toStored(v));
            }}
            onCancel={() => setNumpad(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
