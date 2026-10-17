// Shared set-up of the time-slider tests: the synthetic wave document in a fake EditorApp (MVP-SPEC §3
// convention 12), a mounted controller, pointer events and pixel probes.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import {
  type ChannelId,
  type CharacterId,
  type ClipId,
  type ClipRecord,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocSnapshot,
  type KeyId,
  type KeyRecord,
  type LayerId,
  newId,
} from '@ekza-animator/doc';
import { moveKeys, scaleKeys, selectionSnapshot, type ToolPointerEvent } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { commands } from 'vitest/browser';
import { registerTimelineContributions, TimeSliderController } from '../../src';

export const WAVE = {
  character: 'chr_SyntheticWave001' as CharacterId,
  clip: 'clp_SyntheticWave001' as ClipId,
  layer: 'lay_SyntheticWave001' as LayerId,
  curve: 'crv_SyntheticWave001' as CurveId,
  keys: ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'] as unknown as readonly [KeyId, KeyId, KeyId],
  lowerArmL: 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId,
  upperArmL: 'rig_SyntheticWave001:fk.upperArm.L' as ControlId,
  handL: 'rig_SyntheticWave001:fk.hand.L' as ControlId,
  hips: 'rig_SyntheticWave001:fk.hips' as ControlId,
} as const;

let waveJson: string | null = null;

/** wave-doc.json (keys on fk.lowerArm.L rz at 0/15/30, clip 0–30 at 30 fps, scene 30 fps). */
export async function waveSnapshot(): Promise<DocSnapshot> {
  waveJson ??= await commands.readFile('../../fixtures/synthetic/wave-doc.json');
  return JSON.parse(waveJson) as DocSnapshot;
}

export async function waveApp(): Promise<FakeEditorApp> {
  return createFakeEditorApp({ snapshot: await waveSnapshot() });
}

/** Adds a base-layer curve with keys at `times` (values = times in radians) to the wave clip. */
export function addCurve(
  app: FakeEditorApp,
  control: ControlId,
  channel: ChannelId,
  times: readonly Frame[],
  fields: Partial<CurveRecord> = {},
): { readonly curve: CurveId; readonly keys: readonly KeyId[] } {
  const curve: CurveRecord = {
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
    ...fields,
  };
  const keys = times.map(
    (t): KeyRecord => ({
      id: newId('key'),
      clip: WAVE.clip,
      curve: curve.id,
      t,
      v: t / 100,
      inType: 'auto',
      outType: 'auto',
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    }),
  );
  app.store.transact({ label: 'Add Curve', undoable: false }, (tx) => {
    tx.put('curves', curve);
    for (const key of keys) tx.put('keys', key);
  });
  return { curve: curve.id, keys: keys.map((key) => key.id) };
}

export function patchClip(app: FakeEditorApp, fields: Partial<Omit<ClipRecord, 'id'>>): void {
  app.store.transact({ label: 'Clip Settings', undoable: false }, (tx) => tx.patch('clips', WAVE.clip, fields));
}

export function selectControls(app: FakeEditorApp, controls: readonly ControlId[]): void {
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, controls } });
}

/** Key times of a curve, ascending. */
export function keyTimes(app: FakeEditorApp, curve: CurveId): number[] {
  return app.store.query.keysOfCurve(curve).map((key) => key.t);
}

export interface Mounted {
  readonly app: FakeEditorApp;
  readonly canvas: HTMLCanvasElement;
  readonly slider: TimeSliderController;
  dispose(): void;
}

/** A controller on a canvas of `width`×`height` CSS px with `time.selectBand` and the menu items registered. */
export function mount(app: FakeEditorApp, opts: { width?: number; height?: number; dpr?: number } = {}): Mounted {
  const canvas = document.createElement('canvas');
  const width = opts.width ?? 620;
  const height = opts.height ?? 30;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.append(canvas);
  const slider = new TimeSliderController({ app, canvas });
  const unregister = registerTimelineContributions(app, () => slider);
  slider.resize(width, height, opts.dpr ?? 1);
  return {
    app,
    canvas,
    slider,
    dispose() {
      unregister();
      slider.dispose();
      canvas.remove();
      app.dispose();
    },
  };
}

export function pointer(x: number, opts: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    panel: 'timeline',
    paneId: null,
    x,
    y: 20,
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

/** Lets the fake runner finish the operators the controller started (`app.run` is asynchronous). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** RGBA of the device pixel under canvas CSS point (x, y). */
export function pixel(canvas: HTMLCanvasElement, x: number, y: number, dpr = 1): readonly number[] {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context');
  return [...ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data];
}

export function hex(color: string): readonly number[] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

/** Calls of `id` recorded by the fake app, in order. */
export function callsOf(app: FakeEditorApp, id: string): unknown[] {
  return app.calls.filter((call) => call.id === id).map((call) => call.args);
}

/**
 * True once the WP-7a edit kernel (moveKeys, scaleKeys, selectionSnapshot) is implemented: until then those exports
 * are stubs throwing EkzaError('not-implemented') and the key-drag tests that need them are skipped.
 */
export function editKernelReady(): boolean {
  const app = createFakeEditorApp();
  try {
    selectionSnapshot(app.session.getState().selection);
    app.store.transact({ label: 'probe' }, (tx) => {
      moveKeys(app, tx, [], 0, 0, { snap: true, resolveCollisions: false });
      scaleKeys(app, tx, [], 0, 1, { snap: true, resolveCollisions: false });
    });
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  } finally {
    app.dispose();
  }
}
