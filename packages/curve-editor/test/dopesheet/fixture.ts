// Shared set-up of the Dope Sheet tests: the synthetic wave document (humanoid rig, clip 0–30) in a fake EditorApp
// with the built-in operators, a mounted DopeSheetController with its contributions, curves with chosen keys,
// pointer events and pixel probes.
import type { Frame, TangentType } from '@ekza-studio/anim-core';
import {
  type ChannelId,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type KeyId,
  type KeyRecord,
  newId,
} from '@ekza-studio/doc';
import { registerBuiltinOperators, type ToolPointerEvent, type ToolWheelEvent } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { DopeSheetController, registerDopeSheetContributions } from '../../src';
import { WAVE, waveSnapshot } from '../timeline/fixture';

export { WAVE } from '../timeline/fixture';

export const CONTROLS = {
  cog: 'rig_SyntheticWave001:cog' as ControlId,
  hips: WAVE.hips,
  shoulderL: 'rig_SyntheticWave001:fk.shoulder.L' as ControlId,
  upperArmL: WAVE.upperArmL,
  lowerArmL: WAVE.lowerArmL,
  handL: WAVE.handL,
  upperLegL: 'rig_SyntheticWave001:fk.upperLeg.L' as ControlId,
} as const;

export async function dopeApp(opts: { readonly builtins?: boolean } = {}): Promise<FakeEditorApp> {
  const app = createFakeEditorApp({ snapshot: await waveSnapshot() });
  if (opts.builtins !== false) registerBuiltinOperators(app);
  return app;
}

export type Point = readonly [t: Frame, v: number, breakdown?: boolean];

/**
 * Replaces the keys of the base-layer curve (wave clip, control, channel) with `points` (creating the curve), with
 * `tangent` tangents on both sides. Returns the curve and its key ids in time order.
 */
export function keyCurve(
  app: FakeEditorApp,
  control: ControlId,
  channel: ChannelId,
  points: readonly Point[],
  opts: { readonly tangent?: TangentType; readonly curve?: Partial<CurveRecord> } = {},
): { readonly curve: CurveId; readonly keys: readonly KeyId[] } {
  const tangent = opts.tangent ?? 'auto';
  return app.store.transact({ label: 'Keys', undoable: false }, (tx) => {
    let curve = tx.query.curveFor(WAVE.clip, WAVE.layer, control, channel);
    if (curve === undefined) {
      curve = {
        id: newId('curve'),
        clip: WAVE.clip,
        layer: WAVE.layer,
        control,
        channel,
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue: null,
        locked: false,
        muted: false,
        deleted: null,
        ...opts.curve,
      };
      tx.put('curves', curve);
    } else if (opts.curve !== undefined) {
      tx.patch('curves', curve.id, opts.curve);
    }
    for (const key of tx.query.keysOfCurve(curve.id)) tx.remove('keys', key.id);
    const keys = [...points]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v, breakdown]): KeyRecord => {
        const key: KeyRecord = {
          id: newId('key'),
          clip: WAVE.clip,
          curve: curve.id,
          t,
          v,
          inType: tangent,
          outType: tangent,
          inHandle: { dt: 0, dv: 0 },
          outHandle: { dt: 0, dv: 0 },
          broken: false,
          weightLocked: true,
          ...(breakdown === true ? { breakdown: true } : {}),
        };
        tx.put('keys', key);
        return key;
      });
    return { curve: curve.id, keys: keys.map((key) => key.id) };
  });
}

/** Key times of a curve, ascending. */
export function times(app: FakeEditorApp, curve: CurveId): number[] {
  return app.store.query.keysOfCurve(curve).map((key) => key.t);
}

export function selectControls(app: FakeEditorApp, controls: readonly ControlId[]): void {
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, controls } });
}

export function selectedKeys(app: FakeEditorApp): KeyId[] {
  return [...app.session.getState().selection.keys].filter(([, parts]) => parts.key).map(([id]) => id);
}

export function setKeySelection(app: FakeEditorApp, keys: readonly KeyId[]): void {
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, keys: new Map(keys.map((key) => [key, { key: true, in: false, out: false }])) },
  });
}

export interface MountedSheet {
  readonly app: FakeEditorApp;
  readonly canvas: HTMLCanvasElement;
  readonly sheet: DopeSheetController;
  dispose(): void;
}

/** A controller on a `width`×`height` canvas with the Dope Sheet contributions registered. */
export function mountSheet(
  app: FakeEditorApp,
  opts: { readonly width?: number; readonly height?: number; readonly dpr?: number } = {},
): MountedSheet {
  const canvas = document.createElement('canvas');
  const width = opts.width ?? 640;
  const height = opts.height ?? 300;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.append(canvas);
  const sheet = new DopeSheetController({ app, canvas });
  const unregister = registerDopeSheetContributions(app, () => sheet);
  sheet.resize(width, height, opts.dpr ?? 1);
  return {
    app,
    canvas,
    sheet,
    dispose() {
      unregister();
      sheet.dispose();
      canvas.remove();
      app.dispose();
    },
  };
}

export function pointer(x: number, y: number, opts: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    panel: 'dopeSheet',
    paneId: null,
    x,
    y,
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    pointerType: 'mouse',
    timeStamp: 0,
    detail: 1,
    ...opts,
  };
}

export function wheel(x: number, y: number, opts: Partial<ToolWheelEvent> = {}): ToolWheelEvent {
  return {
    panel: 'dopeSheet',
    paneId: null,
    x,
    y,
    deltaX: 0,
    deltaY: 0,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    ...opts,
  };
}

/** Presses at `from`, moves through `via` to `to` and releases (canvas CSS px). */
export function dragPoints(
  sheet: DopeSheetController,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  opts: Partial<ToolPointerEvent> = {},
): void {
  sheet.pointerDown(pointer(from.x, from.y, opts));
  for (let step = 1; step <= 4; step++) {
    const x = from.x + ((to.x - from.x) * step) / 4;
    const y = from.y + ((to.y - from.y) * step) / 4;
    sheet.pointerMove(pointer(x, y, opts));
  }
  sheet.pointerUp(pointer(to.x, to.y, { ...opts, buttons: 0 }));
}

/** Lets the runner finish the operators the controller started (`app.run` is asynchronous). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Canvas x of a frame in the sheet's current view. */
export function xOf(sheet: DopeSheetController, frame: Frame): number {
  return (frame - sheet.view.f0) * sheet.view.sx;
}

export function pixel(canvas: HTMLCanvasElement, x: number, y: number, dpr = 1): readonly number[] {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context');
  return [...ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data];
}

export function hex(color: string): readonly number[] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}
