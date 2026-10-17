// WP-6t stubs: final signatures (MVP-SPEC §7 WP-6t, §4.11.17). The constructor throws until the time slider lands;
// `registerTimelineContributions` is a no-op so the app boots from day 1.
import { type Disposer, EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { EditorApp, ToolPointerEvent } from '@ekza-animator/editor-core';
import type { TimeSliderHit } from '../types';

export class TimeSliderController {
  constructor(_opts: { readonly app: EditorApp; readonly canvas: HTMLCanvasElement }) {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController');
  }

  resize(_cssWidth: number, _cssHeight: number, _dpr: number): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.resize');
  }

  /** Active-clip frames. */
  frameToX(_frame: Frame): number {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.frameToX');
  }

  xToFrame(_x: number): Frame {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.xToFrame');
  }

  hitTest(_x: number, _y: number): TimeSliderHit {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.hitTest');
  }

  tickPoint(_frame: Frame): { readonly x: number; readonly y: number } | null {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.tickPoint');
  }

  pointerDown(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.pointerDown');
  }

  pointerMove(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.pointerMove');
  }

  pointerUp(_e: ToolPointerEvent): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.pointerUp');
  }

  contextMenu(
    _x: number,
    _y: number,
  ): readonly { readonly id: string; readonly label: string; readonly op: string; readonly args?: unknown }[] {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.contextMenu');
  }

  redraw(_force?: boolean): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.redraw');
  }

  dispose(): void {
    throw new EkzaError('not-implemented', 'curve-editor.TimeSliderController.dispose');
  }
}

/** Registers time.selectBand (acting on the focused controller). */
export function registerTimelineContributions(_app: EditorApp, _focused: () => TimeSliderController | null): Disposer {
  return () => {};
}
