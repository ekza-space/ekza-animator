// The Dope Sheet (M2A-SPEC §5.10, §8 A3 public API): contract stubs landed by A0 (§3 rule 1). A3 replaces them; the
// A0 Dope Sheet panel is a placeholder that constructs no controller. `registerDopeSheetContributions` works from A0
// on and registers `dopeSheet.frame` as a stub that poll-fails with "not available yet".
import { type Disposer, EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId } from '@ekza-animator/doc';
import {
  type EditorApp,
  type OperatorArgs,
  type OperatorDef,
  PANEL,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type ToolWheelEvent,
} from '@ekza-animator/editor-core';
import type { DopeSheetHit, DopeSheetRow, DopeSheetViewState } from '../types';

function notImplemented(symbol: string): EkzaError {
  return new EkzaError('not-implemented', `curve-editor.${symbol}`);
}

/** §5.10 rows: Summary › Character › Body part › Control › Channel (A3). */
export function buildDopeSheetRows(
  _app: EditorApp,
  _opts: {
    readonly clip: ClipId | null;
    readonly controls: readonly ControlId[];
    readonly expanded: ReadonlySet<string>;
    readonly show: 'selected' | 'character';
  },
): DopeSheetRow[] {
  throw notImplemented('buildDopeSheetRows');
}

/** §5.10 aggregate hold rule over the given curves; intervals [t_i, t_{i+1}] in clip frames (A3). */
export function holdIntervals(
  _app: EditorApp,
  _curves: readonly CurveId[],
  _keyTimes: readonly Frame[],
): readonly (readonly [Frame, Frame])[] {
  throw notImplemented('holdIntervals');
}

/** The Dope Sheet controller (A3). The A0 stub refuses construction. */
export class DopeSheetController {
  readonly view: DopeSheetViewState = { f0: 0, sx: 1, scrollY: 0 };
  readonly dragging: boolean = false;

  constructor(_opts: { readonly app: EditorApp; readonly canvas: HTMLCanvasElement }) {
    throw notImplemented('DopeSheetController');
  }

  setView(_view: DopeSheetViewState): void {
    throw notImplemented('DopeSheetController.setView');
  }
  rows(): readonly DopeSheetRow[] {
    throw notImplemented('DopeSheetController.rows');
  }
  setExpanded(_row: string, _expanded: boolean): void {
    throw notImplemented('DopeSheetController.setExpanded');
  }
  setShow(_show: 'selected' | 'character'): void {
    throw notImplemented('DopeSheetController.setShow');
  }
  frame(_what: 'all' | 'selection'): void {
    throw notImplemented('DopeSheetController.frame');
  }
  resize(_cssWidth: number, _cssHeight: number, _dpr: number): void {
    throw notImplemented('DopeSheetController.resize');
  }
  hitTest(_x: number, _y: number): DopeSheetHit {
    throw notImplemented('DopeSheetController.hitTest');
  }
  glyphPoint(_row: string, _frame: Frame): { readonly x: number; readonly y: number } | null {
    throw notImplemented('DopeSheetController.glyphPoint');
  }
  regionPoint(_part: 'start' | 'middle' | 'end'): { readonly x: number; readonly y: number } | null {
    throw notImplemented('DopeSheetController.regionPoint');
  }
  pointerDown(_e: ToolPointerEvent): void {
    throw notImplemented('DopeSheetController.pointerDown');
  }
  pointerMove(_e: ToolPointerEvent): void {
    throw notImplemented('DopeSheetController.pointerMove');
  }
  pointerUp(_e: ToolPointerEvent): void {
    throw notImplemented('DopeSheetController.pointerUp');
  }
  wheel(_e: ToolWheelEvent): void {
    throw notImplemented('DopeSheetController.wheel');
  }
  key(_e: ToolKeyEvent): boolean {
    throw notImplemented('DopeSheetController.key');
  }
  redraw(_force?: boolean): void {
    throw notImplemented('DopeSheetController.redraw');
  }
  cancel(): void {
    throw notImplemented('DopeSheetController.cancel');
  }
  dispose(): void {
    throw notImplemented('DopeSheetController.dispose');
  }
}

/** `dopeSheet.frame` (F / A over the Dope Sheet): A0 stub, poll-fails until A3 lands the controller. */
export function dopeSheetFrameOperator(
  _focused: () => DopeSheetController | null,
): OperatorDef<OperatorArgs<'dopeSheet.frame'>, void, void> {
  return {
    id: 'dopeSheet.frame',
    label: 'Frame',
    description: 'Frame the selected keys (F) or all rows (A) in the Dope Sheet',
    category: 'graph',
    scope: PANEL.dopeSheet,
    poll: () => ({ ok: false, reason: 'not available yet' }),
    apply: () => {
      throw new EkzaError('not-implemented', 'operator dopeSheet.frame');
    },
  };
}

/**
 * Registers the Dope Sheet tools and `dopeSheet.frame` (acting on the focused controller). A0: no tools yet and
 * `dopeSheet.frame` as a poll-failing stub (A3 adds the tools and the operator's behaviour).
 */
export function registerDopeSheetContributions(app: EditorApp, focused: () => DopeSheetController | null): Disposer {
  const dispose = app.contribute({ kind: 'operator', def: dopeSheetFrameOperator(focused) });
  return () => dispose();
}
