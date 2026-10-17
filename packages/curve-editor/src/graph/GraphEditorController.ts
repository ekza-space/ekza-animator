// WP-6 stubs: final signatures (MVP-SPEC §7 WP-6; ADR 0007). The constructor throws until the Graph Editor lands;
// `registerGraphContributions` is a no-op so the app boots from day 1.
import { type Disposer, EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { CurveId, KeyId } from '@ekza-animator/doc';
import type { EditorApp, ToolKeyEvent, ToolPointerEvent, ToolWheelEvent } from '@ekza-animator/editor-core';
import type { GraphHit, GraphViewState } from '../types';

export class GraphEditorController {
  declare readonly view: GraphViewState;

  constructor(_opts: {
    readonly app: EditorApp;
    readonly base: HTMLCanvasElement;
    readonly overlay: HTMLCanvasElement;
  }) {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController');
  }

  setView(_view: GraphViewState): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.setView');
  }

  setCurves(_curves: readonly CurveId[]): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.setCurves');
  }

  frame(_what: 'all' | 'selection'): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.frame');
  }

  resize(_cssWidth: number, _cssHeight: number, _dpr: number): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.resize');
  }

  /** Canvas CSS px. */
  hitTest(_x: number, _y: number): GraphHit {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.hitTest');
  }

  keyPoint(_key: KeyId): { readonly x: number; readonly y: number } | null {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.keyPoint');
  }

  handlePoint(_key: KeyId, _side: 'in' | 'out'): { readonly x: number; readonly y: number } | null {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.handlePoint');
  }

  curvePoint(_curve: CurveId, _frame: Frame): { readonly x: number; readonly y: number } | null {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.curvePoint');
  }

  pointerDown(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.pointerDown');
  }

  pointerMove(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.pointerMove');
  }

  pointerUp(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.pointerUp');
  }

  wheel(_e: ToolWheelEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.wheel');
  }

  key(_e: ToolKeyEvent): boolean {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.key');
  }

  /** Draws dirty layers; call from R3F addAfterEffect or rAF. */
  redraw(_force?: boolean): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.redraw');
  }

  dispose(): void {
    throw new EkzaError('not-implemented', 'curve-editor.GraphEditorController.dispose');
  }
}

/** Registers graph tools, graph.frame and select.curveKeys (acting on the focused controller). */
export function registerGraphContributions(_app: EditorApp, _focused: () => GraphEditorController | null): Disposer {
  return () => {};
}
