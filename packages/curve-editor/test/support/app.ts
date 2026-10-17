// Test support for the curve-editor browser tests: the shared test kit's fake app over the synthetic wave document,
// canvases mounted in the page, pointer/wheel event builders and dependency probes for stubbed packages.
import { EkzaError, type InfinityMode, type KeyData, type TangentType } from '@ekza-animator/anim-core';
import type {
  ChannelId,
  ClipId,
  ControlId,
  CurveId,
  CurveRecord,
  DocSnapshot,
  KeyId,
  KeyRecord,
  LayerId,
} from '@ekza-animator/doc';
import {
  type KeyPartSelection,
  moveKeys,
  parseNumericInput,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type ToolWheelEvent,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { commands } from 'vitest/browser';
import { GraphEditorController } from '../../src';

/** IDs of the synthetic wave document (fixtures/synthetic/wave-doc.json). */
export const WAVE = {
  character: 'chr_SyntheticWave001',
  clip: 'clp_SyntheticWave001' as ClipId,
  layer: 'lay_SyntheticWave001' as LayerId,
  curve: 'crv_SyntheticWave001' as CurveId,
  control: 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId,
  keys: ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'] as unknown as readonly [KeyId, KeyId, KeyId],
} as const;

let waveSnapshot: DocSnapshot | null = null;

export async function waveDoc(): Promise<DocSnapshot> {
  waveSnapshot ??= JSON.parse(await commands.readFile('../../fixtures/synthetic/wave-doc.json')) as DocSnapshot;
  return waveSnapshot;
}

export async function waveApp(opts?: { readonly platform?: 'mac' | 'other' }): Promise<FakeEditorApp> {
  return createFakeEditorApp({ snapshot: await waveDoc(), ...(opts?.platform === undefined ? {} : opts) });
}

export interface Mounted {
  readonly app: FakeEditorApp;
  readonly controller: GraphEditorController;
  readonly base: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  dispose(): void;
}

/** Two stacked canvases in the page, a controller over them, sized to `width × height` CSS px at `dpr`. */
export function mount(
  app: FakeEditorApp,
  opts?: {
    readonly width?: number;
    readonly height?: number;
    readonly dpr?: number;
    readonly curves?: readonly CurveId[];
  },
): Mounted {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 300;
  const host = document.createElement('div');
  host.style.cssText = `position:relative;width:${width}px;height:${height}px`;
  const base = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  for (const canvas of [base, overlay]) {
    canvas.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px`;
    host.append(canvas);
  }
  document.body.append(host);
  const controller = new GraphEditorController({ app, base, overlay });
  controller.resize(width, height, opts?.dpr ?? 1);
  controller.setCurves(opts?.curves ?? [WAVE.curve]);
  return {
    app,
    controller,
    base,
    overlay,
    dispose() {
      controller.dispose();
      host.remove();
      app.dispose();
    },
  };
}

/** PointerEvent.buttons bit of each PointerEvent.button (left, middle, right). */
const BUTTONS: readonly number[] = [1, 4, 2];

export function pointer(
  partial: Partial<ToolPointerEvent> & { readonly x: number; readonly y: number },
): ToolPointerEvent {
  return {
    panel: 'graph',
    paneId: null,
    button: 0,
    buttons: BUTTONS[partial.button ?? 0] ?? 1,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    pointerType: 'mouse',
    timeStamp: 0,
    detail: 1,
    ...partial,
  };
}

export function wheel(partial: Partial<ToolWheelEvent> & { readonly x: number; readonly y: number }): ToolWheelEvent {
  return {
    panel: 'graph',
    paneId: null,
    deltaX: 0,
    deltaY: 0,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    ...partial,
  };
}

export function keyEvent(partial: Partial<ToolKeyEvent> & { readonly code: string }): ToolKeyEvent {
  return { type: 'down', shift: false, alt: false, mod: false, ...partial };
}

/** Press at `from`, move through `steps` intermediate points to `to`, release there. */
export function drag(
  controller: GraphEditorController,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  extra?: Partial<ToolPointerEvent>,
  steps = 4,
): void {
  controller.pointerDown(pointer({ ...extra, ...from }));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    controller.pointerMove(pointer({ ...extra, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
  }
  controller.pointerUp(pointer({ ...extra, ...to, buttons: 0 }));
}

/** Lets pending operator runs (async prepare) settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function selectKeys(
  app: FakeEditorApp,
  entries: readonly (readonly [KeyId, Partial<KeyPartSelection>])[],
): void {
  const keys = new Map<KeyId, KeyPartSelection>(
    entries.map(([key, parts]) => [key, { key: false, in: false, out: false, ...parts }]),
  );
  const selection = app.session.getState().selection;
  app.session.setState({ selection: { ...selection, keys } });
}

/** The calls recorded for one operator id. */
export function callsOf(app: FakeEditorApp, id: string): unknown[] {
  return app.calls.filter((call) => call.id === id).map((call) => call.args);
}

// ---------------------------------------------------------------------------------------------------------------
// Building extra curves in the wave document

let counter = 0;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function base62(n: number, length: number): string {
  let out = '';
  let value = n;
  for (let i = 0; i < length; i++) {
    out = (BASE62[value % 62] as string) + out;
    value = Math.floor(value / 62);
  }
  return out;
}

export function key(t: number, v: number, inType: TangentType = 'auto', outType: TangentType = inType): KeyData {
  return {
    t,
    v,
    inType,
    outType,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  };
}

/** Adds a curve with `keys` on the wave clip's base layer (one transaction); returns its id and key ids. */
export function addCurve(
  app: FakeEditorApp,
  opts: {
    readonly control?: ControlId;
    readonly channel: ChannelId;
    readonly keys: readonly KeyData[];
    readonly weighted?: boolean;
    readonly pre?: InfinityMode;
    readonly post?: InfinityMode;
    readonly locked?: boolean;
  },
): { readonly curve: CurveId; readonly keys: readonly KeyId[] } {
  const curveId = `crv_T${base62(++counter, 15)}` as CurveId;
  const keyIds = opts.keys.map(() => `k_T${base62(++counter, 11)}` as KeyId);
  const curve: CurveRecord = {
    id: curveId,
    clip: WAVE.clip,
    layer: WAVE.layer,
    control: opts.control ?? WAVE.control,
    channel: opts.channel,
    weighted: opts.weighted ?? false,
    pre: opts.pre ?? 'constant',
    post: opts.post ?? 'constant',
    staticValue: null,
    locked: opts.locked ?? false,
    muted: false,
    deleted: null,
  };
  app.store.transact({ label: 'Test curve' }, (tx) => {
    tx.put('curves', curve);
    opts.keys.forEach((data, i) => {
      const record: KeyRecord = { ...data, id: keyIds[i] as KeyId, clip: WAVE.clip, curve: curveId };
      tx.put('keys', record);
    });
  });
  return { curve: curveId, keys: keyIds };
}

// ---------------------------------------------------------------------------------------------------------------
// Probes for packages that are still stubs (MVP-SPEC §8.1: dependent tests wait for the blocking WP)

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

/** WP-7a edit kernel (moveKeys, setKeyHandle, selectionSnapshot) is implemented. */
export const KERNEL_READY: boolean = implemented(() => {
  const app = createFakeEditorApp();
  try {
    app.store.transact({ label: 'probe' }, (tx) =>
      moveKeys(app, tx, [], 0, 0, { snap: true, resolveCollisions: false }),
    );
  } finally {
    app.dispose();
  }
});

/** WP-7a numeric input parser is implemented. */
export const NUMERIC_READY: boolean = implemented(() => parseNumericInput('1', 0));
