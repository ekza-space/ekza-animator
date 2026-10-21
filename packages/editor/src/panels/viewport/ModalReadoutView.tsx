// The modal readout's drawing (M6A-SPEC §8.7; B12a), a lazy chunk of `ModalReadout.tsx`: a chip 16 px right of and
// below the pointer that flips at the pane edges (z-order 20), the snap candidate's ring and name, and the soft-select
// radius ring. During a capture entry the chip shows the field, the entry and the keys; the help line mirrors it.
import type { EditorApp, NumericCaptureState } from '@ekza-studio/editor-core';
import { setTransformReadout, type TransformReadout, transformReadout } from '@ekza-studio/viewport';
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOptionalShell } from '../../shell/context';

/** The chip's offset from the pointer (§8.7). */
const OFFSET = 16;
const KEYS = 'Enter ✓ · Esc ✕ · Tab next';

interface FieldsLike {
  fields?(): readonly { readonly name: string; readonly label: string }[];
}

/** The capture's active field label (the target's param label). */
function fieldLabel(app: EditorApp, field: string | null): string {
  if (field === null) return '';
  const fields = (app.capture as FieldsLike).fields?.() ?? [];
  return fields.find((f) => f.name === field)?.label ?? field;
}

/** The last pointer position inside this pane (for a capture entry without a drag). */
function usePanePointer(ref: React.RefObject<HTMLElement | null>): { x: number; y: number } | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const box = ref.current?.getBoundingClientRect();
      if (box === undefined) return;
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      if (x >= 0 && y >= 0 && x <= box.width && y <= box.height) setAt({ x, y });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [ref]);
  return at;
}

export default function ModalReadoutView(props: {
  readonly app: EditorApp;
  readonly paneId: string;
  readonly readout: TransformReadout | null;
  readonly capture: NumericCaptureState;
}): JSX.Element | null {
  const { app, readout, capture } = props;
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLOutputElement>(null);
  const pointer = usePanePointer(root);
  const shell = useOptionalShell();
  const [box, setBox] = useState({ w: 0, h: 0, cw: 0, ch: 0 });

  const typing = capture.armed !== null && capture.text !== null;
  const label = typing ? fieldLabel(app, capture.field) : (readout?.label ?? null);
  const value = typing ? `${capture.text ?? ''}_` : (readout?.value ?? null);
  const text = label === null || value === null ? null : `${label} ${value}`;
  const at = readout !== null ? { x: readout.x, y: readout.y } : pointer;

  // The help line mirrors a capture entry (§5.10). The entry may have ended before this effect runs (Enter or Esc in
  // the same frame as the last digit): then the line keeps what replaced the prompt (the committed value). When the
  // entry ends (applied, cancelled, or dropped with its drag) a prompt still on the line is cleared, so it never
  // outlives the entry.
  const prompt = typing && text !== null ? `${text} · ${KEYS}` : null;
  useEffect(() => {
    if (prompt === null || shell === null) return undefined;
    const live = app.capture.state;
    if (live.armed === null || live.text === null) return undefined;
    shell.help(prompt);
    return () => {
      if (shell.ui.getState().help?.text === prompt) shell.ui.setState({ help: null });
    };
  }, [app, prompt, shell]);

  // A drag committed with typed values: its announcement replaces the prompt on the help line (§5.10), once.
  useEffect(() => {
    if (readout?.said === undefined) return;
    shell?.help(readout.said);
    if (transformReadout(app) === readout) setTransformReadout(app, null);
  }, [app, readout, shell]);

  // The pane's and the chip's sizes (for the flip at the edges), measured after each change of the text or place.
  const x = at?.x ?? null;
  const y = at?.y ?? null;
  useLayoutEffect(() => {
    const pane = root.current;
    const c = chip.current;
    const next = {
      w: pane?.clientWidth ?? 0,
      h: pane?.clientHeight ?? 0,
      cw: c?.offsetWidth ?? 0,
      ch: c?.offsetHeight ?? 0,
    };
    setBox((prev) =>
      next.w === prev.w && next.h === prev.h && next.cw === prev.cw && next.ch === prev.ch ? prev : next,
    );
  }, [text, typing, x, y]);

  // 16 px right of and below the pointer; flipped to the other side at the pane's right and bottom edges.
  let left = 0;
  let top = 0;
  if (at !== null) {
    left = at.x + OFFSET + box.cw > box.w ? at.x - OFFSET - box.cw : at.x + OFFSET;
    top = at.y + OFFSET + box.ch > box.h ? at.y - OFFSET - box.ch : at.y + OFFSET;
  }
  const snap = readout?.snap ?? null;
  const ring = readout?.ring ?? null;

  return (
    <div
      ref={root}
      className="pointer-events-none"
      style={{ position: 'absolute', inset: 0, zIndex: 20 }}
      data-testid="modal-readout-layer"
    >
      {ring === null ? null : (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
          aria-hidden="true"
        >
          <circle
            cx={ring.x}
            cy={ring.y}
            r={Math.max(ring.r, 1)}
            fill="none"
            stroke="var(--soft-2, #ff8a3d)"
            strokeWidth={1.5}
            data-testid="soft-radius-ring"
          />
        </svg>
      )}
      {snap === null ? null : (
        <>
          <div
            className="rounded-full border-2"
            style={{
              position: 'absolute',
              left: snap.x - 7,
              top: snap.y - 7,
              width: 14,
              height: 14,
              borderColor: 'var(--comp-hover, #ffe58a)',
              boxShadow: '0 0 0 1px var(--comp-halo, #14151a)',
            }}
            data-testid="snap-candidate"
          />
          <div
            className="rounded bg-[var(--comp-halo,#14151a)] px-1.5 py-0.5 font-mono text-[11px] text-fg"
            style={{ position: 'absolute', whiteSpace: 'nowrap', left: snap.x + 10, top: snap.y - 22 }}
          >
            {snap.label}
          </div>
        </>
      )}
      {text === null || at === null ? null : (
        <output
          ref={chip}
          className="rounded border border-line bg-[var(--bg-popover,#2c2e34)] px-2 py-1 font-mono text-[11px] text-fg shadow"
          style={{ position: 'absolute', whiteSpace: 'nowrap', left, top }}
          data-testid="modal-readout"
        >
          <span>{text}</span>
          {typing ? <span className="ml-2 text-fg-3">{KEYS}</span> : null}
        </output>
      )}
    </div>
  );
}
