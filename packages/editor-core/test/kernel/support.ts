// Shared helpers of the kernel tests: the wave fixture app (fake app = real kernel over the naive kit), a two-
// character document, frame and selection setters, and a kernel builder with custom dependency bindings.
import type {
  CharacterId,
  ClipId,
  ClipRecord,
  ControlId,
  CurveId,
  DocSnapshot,
  KeyId,
  KeyRecord,
  Tx,
} from '@ekza-animator/doc';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { expect } from 'vitest';
import type { KernelDeps } from '../../src/app/deps';
import { createKernelApp, type KernelOptions } from '../../src/app/kernel';
import { createFakeEditorApp, createFakeServices, type FakeEditorApp, type FakeServices } from '../../src/testing';
import { naiveKernelDeps } from '../../src/testing/deps';
import type { EditorApp, OperatorDef, Prefs } from '../../src/types';
import { humanoidSkeleton, WAVE, waveDoc } from '../testing/fixtures';

export { DEG, humanoidSkeleton, WAVE, waveDoc } from '../testing/fixtures';

export function waveApp(opts?: {
  readonly platform?: 'mac' | 'other';
  readonly services?: Partial<FakeServices>;
}): FakeEditorApp {
  return createFakeEditorApp({ snapshot: waveDoc(), skeleton: humanoidSkeleton(), ...opts });
}

/** The fake app with its recording services exposed. */
export function waveAppWithServices(): { readonly app: FakeEditorApp; readonly services: FakeServices } {
  const services = createFakeServices();
  return { app: waveApp({ services }), services };
}

/** A kernel app over the naive kit with some bindings replaced (async model loading, failing loaders, …). */
export function kernelApp(opts: {
  readonly snapshot?: DocSnapshot;
  readonly skeleton?: SkeletonDesc | null;
  readonly deps?: (base: KernelDeps) => KernelDeps;
  readonly options?: Partial<KernelOptions>;
}): EditorApp {
  const base = naiveKernelDeps(opts.skeleton === undefined ? humanoidSkeleton() : opts.skeleton);
  const deps = opts.deps?.(base) ?? base;
  const store = deps.createStore();
  if (opts.snapshot !== undefined) store.load(opts.snapshot);
  return createKernelApp(
    { services: createFakeServices(), store, builtins: false, prefDefaults: { firstRunDone: true }, ...opts.options },
    deps,
  );
}

export function setFrame(app: EditorApp, sceneFrame: number): void {
  app.session.setState({ time: { ...app.session.getState().time, sceneFrame } });
}

export function select(app: EditorApp, controls: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls } });
}

export function setPrefs(app: EditorApp, prefs: Partial<Prefs>): void {
  app.prefs.setState(prefs);
}

/** Registers an operator for a test and returns its id. */
export function addOperator<A = unknown, R = unknown, P = unknown>(app: EditorApp, def: OperatorDef<A, R, P>): string {
  app.operators.register(def);
  return def.id;
}

export function edit<R>(app: EditorApp, label: string, fn: (tx: Tx) => R): R {
  return app.store.transact({ label }, fn);
}

export function keysOf(app: EditorApp, curve: CurveId): readonly KeyRecord[] {
  return app.store.query.keysOfCurve(curve);
}

/** The wave curve's keys as [t, v] pairs. */
export function wavePoints(app: EditorApp): [number, number][] {
  return keysOf(app, WAVE.curve).map((key) => [key.t, key.v]);
}

/** The base-layer curve of a control channel in the wave clip (undefined without one). */
export function curveOf(app: EditorApp, control: ControlId, channel: string, clip: ClipId = WAVE.clip) {
  const layer = app.store.query.baseLayer(clip);
  return layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as 'rz');
}

export const SECOND = {
  character: 'chr_SyntheticWave002' as CharacterId,
  clip: 'clp_SyntheticWave002' as ClipId,
  curve: 'crv_SyntheticWave002' as CurveId,
  keys: ['k_SynthWave101', 'k_SynthWave102', 'k_SynthWave103'] as unknown as readonly [KeyId, KeyId, KeyId],
  lowerArmL: 'rig_SyntheticWave002:fk.lowerArm.L' as ControlId,
} as const;

/** The wave document with a second character (same skeleton, its own rig, clip `wave` and keys). */
export function twoCharacterDoc(edit?: {
  readonly first?: Partial<ClipRecord>;
  readonly second?: Partial<ClipRecord>;
}): DocSnapshot {
  const doc = waveDoc();
  const tables = doc.tables as unknown as Record<string, Record<string, Record<string, unknown>>>;
  const cloneTable = (name: string): Record<string, Record<string, unknown>> => {
    const json = JSON.stringify(tables[name] ?? {})
      .replaceAll('SyntheticWave001', 'SyntheticWave002')
      .replaceAll('k_SynthWave00', 'k_SynthWave10');
    return JSON.parse(json) as Record<string, Record<string, unknown>>;
  };
  const next: Record<string, Record<string, Record<string, unknown>>> = { ...tables };
  for (const name of ['characters', 'rigs', 'controls', 'clips', 'layers', 'curves', 'keys']) {
    next[name] = { ...tables[name], ...cloneTable(name) };
  }
  const second = next['characters']?.[SECOND.character];
  if (second !== undefined) {
    second['name'] = 'Second Humanoid';
    second['order'] = 'a1';
  }
  const clips = next['clips'] ?? {};
  if (edit?.first !== undefined) clips[WAVE.clip] = { ...clips[WAVE.clip], ...edit.first };
  if (edit?.second !== undefined) clips[SECOND.clip] = { ...clips[SECOND.clip], ...edit.second };
  return { ...doc, tables: next as unknown as DocSnapshot['tables'] };
}

/** Element-wise toBeCloseTo of two number lists. */
export function expectClose(actual: readonly number[], expected: readonly number[], digits: number): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, digits));
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export { WAVE as W };
