// The Last-op card (M6A-SPEC §8.6, §5.7; B11): a lazy chunk drawn in the bottom-left slot of the pane where the last
// operation ran. A collapsed pill (`⟲ Extrude · 0.500 m ▸`) expands on click or `T`; the fields come from the
// operation's params (hidden and data params omitted, the primary first); a typed value or a slider release runs
// `edit.adjustLast` once (history length unchanged); a label drag previews a mesh op from its pre-op mesh
// (`beginCardPreview`, ≤ 1 re-run per frame, "update on release" above 50 ms) with the capture window armed on the
// dragged field (§5.10 (a)); `Reset ⟲` restores the defaults; `✕` hides the card and keeps the operation for `G`. A
// closed card shows its reason in the pill's tooltip for 3 s, then disappears.
import type { ParamDef, ParamValue, ParamValues } from '@ekza-animator/anim-core';
import {
  beginCardPreview,
  dismissLastOpCard,
  type EditorApp,
  formatParamValue,
  type LastOpCardState,
  type LastRun,
  lastRunWarnings,
  type NumericTarget,
  numericParams,
  type RunContext,
  setLastOpCardExpanded,
  visibleParams,
} from '@ekza-animator/editor-core';
import { cn } from '@ekza-animator/ui';
import { type JSX, type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import { useOptionalShell } from '../../shell/context';
import { BUTTON } from '../channel-box/kit/styles';
import { ParamField, type ParamSliderHooks } from './ParamField';

/** How long a closed card shows its reason before it disappears (§8.6). */
export const CLOSED_CARD_MS = 3000;

export interface LastOpCardViewProps {
  readonly app: EditorApp;
  readonly paneId: string;
  readonly lastRun: LastRun;
  readonly card: LastOpCardState;
}

/** Runs from the card go through the shell (help line for refusals) when there is one. */
function useRunner(app: EditorApp): (op: string, args: unknown, ctx: RunContext) => void {
  const shell = useOptionalShell();
  return (op, args, ctx) => {
    if (shell !== null) void shell.runFromUi(op, args, ctx);
    else void app.runUntyped(op, args, ctx);
  };
}

/** The card's slider hooks: preview through the mesh runtime, the capture window armed on the dragged field. */
function cardSlider(app: EditorApp, lastRun: LastRun, commit: (args: ParamValues) => void): ParamSliderHooks {
  return {
    begin(def: ParamDef) {
      const preview = beginCardPreview(app);
      const draft: Record<string, ParamValue> = { ...lastRun.args };
      const typed = new Set<string>();
      let frame: number | null = null;
      let pending: ParamValues | null = null;
      const flush = (): void => {
        frame = null;
        if (pending !== null && preview !== null && !preview.slow) preview.update(pending);
        pending = null;
      };
      const schedule = (patch: ParamValues): void => {
        pending = { ...pending, ...patch };
        if (frame === null) frame = requestAnimationFrame(flush);
      };
      let finished = false;
      const numberOf = (field: string): number => {
        const v = draft[field];
        return typeof v === 'number' ? v : 0;
      };
      const target: NumericTarget = {
        fields: numericParams(lastRun.params),
        active: def.name,
        value: numberOf,
        set(field, value) {
          draft[field] = value;
          typed.add(field);
          schedule({ [field]: value });
        },
        // Enter / Esc in the capture window end the drag like a release / Esc on the label.
        confirm: () => end(numberOf(def.name), true),
        cancel: () => end(0, false),
      };
      const end = (value: number, ok: boolean): void => {
        if (finished) return;
        finished = true;
        if (frame !== null) cancelAnimationFrame(frame);
        if (app.capture.state.armed === 'drag') app.capture.disarm();
        if (!ok) {
          preview?.cancel();
          return;
        }
        if (!typed.has(def.name)) draft[def.name] = value;
        const changed: Record<string, ParamValue> = {};
        for (const field of visibleParams(lastRun.params)) {
          if (draft[field.name] !== lastRun.args[field.name]) changed[field.name] = draft[field.name] ?? null;
        }
        if (Object.keys(changed).length > 0) commit(changed);
        else preview?.cancel();
      };
      app.capture.arm('drag', target);
      return {
        update(value: number) {
          if (finished || typed.has(def.name)) return; // a typed entry wins over the pointer (§5.10)
          draft[def.name] = value;
          schedule({ [def.name]: value });
        },
        end,
      };
    },
  };
}

/**
 * The card sits inside the pane's surface, which takes every `pointerdown` (navigation, picking, pointer capture):
 * presses on the card stop there, natively, so its buttons, fields and sliders get their clicks.
 */
function useOwnPresses(ref: RefObject<HTMLElement | null>, mounted: unknown): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const stop = (event: Event): void => event.stopPropagation();
    element.addEventListener('pointerdown', stop);
    element.addEventListener('wheel', stop, { passive: true });
    return () => {
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('wheel', stop);
    };
  }, [ref, mounted]);
}

export default function LastOpCardView(props: LastOpCardViewProps): JSX.Element | null {
  const { app, paneId, lastRun, card } = props;
  const root = useRef<HTMLElement>(null);
  const run = useRunner(app);
  const shell = useOptionalShell();
  const fields = useMemo(() => visibleParams(lastRun.params), [lastRun.params]);
  const primary = fields[0] ?? null;
  const closed = lastRun.closed;
  const [expired, setExpired] = useState<LastRun | null>(null);

  useEffect(() => {
    if (closed === null) return undefined;
    const timer = setTimeout(() => setExpired(lastRun), CLOSED_CARD_MS);
    return () => clearTimeout(timer);
  }, [closed, lastRun]);

  const ctx: RunContext = { source: 'card', paneId };
  const adjust = (args: ParamValues): void => run('edit.adjustLast', { args }, ctx);
  const slider = useMemo(() => cardSlider(app, lastRun, adjust), [app, lastRun]); // oxlint-disable-line react-hooks/exhaustive-deps -- adjust only closes over stable values
  const shown = fields.length > 0 && expired !== lastRun;
  const expanded = closed === null && card.expanded;
  useOwnPresses(root, `${String(shown)}:${String(expanded)}`);
  if (!shown) return null;

  const summary = primary === null ? '' : ` · ${formatParamValue(primary, lastRun.args[primary.name])}`;
  const warnings = lastRunWarnings(app);
  const message = (text: string): void => shell?.help(text, 'warning');

  if (!expanded) {
    return (
      <div
        ref={(element) => {
          root.current = element;
        }}
        className="pointer-events-auto mb-8"
        data-testid={`lastop-card-${paneId}`}
        data-state={closed === null ? 'collapsed' : 'closed'}
      >
        <button
          type="button"
          className={cn(
            'inline-flex h-6 max-w-[18rem] items-center gap-1 rounded-full border border-line bg-[var(--bg-overlay,#202227)]/90 px-2 text-ui-dense text-fg-2 shadow',
            closed === null ? 'hover:text-fg' : 'opacity-50',
          )}
          data-testid="lastop-pill"
          title={closed ?? `Adjust ${lastRun.label} (T)`}
          disabled={closed !== null}
          onClick={() => setLastOpCardExpanded(app, true)}
        >
          <span aria-hidden="true">⟲</span>
          <span className="truncate" data-testid="lastop-title">
            {lastRun.label}
          </span>
          <span className="truncate font-mono tabular-nums">{summary}</span>
          <span aria-hidden="true">▸</span>
        </button>
      </div>
    );
  }

  const reset = (): void => {
    const args: Record<string, ParamValue> = {};
    for (const field of fields) if (lastRun.args[field.name] !== field.default) args[field.name] = field.default;
    if (Object.keys(args).length > 0) adjust(args);
  };

  return (
    <section
      ref={root}
      className="pointer-events-auto mb-8 flex w-[17rem] flex-col gap-1 rounded-md border border-line bg-[var(--bg-overlay,#202227)]/95 p-1.5 text-ui-dense text-fg shadow-lg"
      data-testid={`lastop-card-${paneId}`}
      data-state="expanded"
      aria-label={`Adjust ${lastRun.label}`}
    >
      <header className="flex items-center gap-1">
        <span aria-hidden="true" className="text-fg-3">
          ⟲
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold" data-testid="lastop-title">
          {lastRun.label}
        </span>
        <button
          type="button"
          className={BUTTON}
          title="Collapse"
          aria-label="Collapse"
          data-testid="lastop-collapse"
          onClick={() => setLastOpCardExpanded(app, false)}
        >
          ⌄
        </button>
        <button type="button" className={BUTTON} title="Reset to defaults" data-testid="lastop-reset" onClick={reset}>
          ⟲ Reset
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Close (G still repeats it)"
          aria-label="Close"
          data-testid="lastop-close"
          onClick={() => dismissLastOpCard(app)}
        >
          ✕
        </button>
      </header>
      <div className="flex flex-col gap-0.5">
        {fields.map((def) => (
          <ParamField
            key={def.name}
            app={app}
            def={def}
            value={lastRun.args[def.name]}
            fieldTestId={`lastop-field-${def.name}`}
            nameTestId={`lastop-name-${def.name}`}
            onCommit={(value) => adjust({ [def.name]: value })}
            slider={slider}
            focus={card.focusField === def.name}
            focusToken={card.focusSeq}
            onMessage={message}
          />
        ))}
      </div>
      {warnings.length === 0 ? null : (
        <p className="text-[var(--warning,#e3b34a)]" data-testid="lastop-warning">
          {warnings.map((w) => w.message).join(' · ')}
        </p>
      )}
    </section>
  );
}
