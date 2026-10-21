// Plumbing of the conformance suite: the host test runner (through its globals, so the suite works under Vitest
// `globals: true`, Jest or Mocha without importing any of them), assertions with readable diffs, and a small scene
// built through the public store API.
import { EkzaError } from '@ekza-studio/anim-core';
import type {
  AssetId,
  CameraId,
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  IdSource,
  KeyId,
  LayerId,
  RigId,
} from '../../ids';
import { newId, seededIdSource } from '../../ids/generate';
import type { ChannelId, KeyRecord, Partition, RecordOf, TableName } from '../../records';
import { makeCamera, makeClip, makeCurve, makeKey, makeLayer, makeProject } from '../../records/factories';
import { fractionalIndex } from '../../records/order';
import { serializeSnapshot } from '../../snapshot/serialize';
import type { ChangeBatch, DocumentStore, ReadView, Tx } from '../../store';
import { deepEqual } from '../../store/diff';
import { makeTestAsset, makeTestCharacter, makeTestControl, makeTestRig } from '../document';

// ---------- runner ----------

type TestBody = () => void | Promise<void>;
export interface SuiteRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: TestBody, timeout?: number): void;
}

export function hostRunner(): SuiteRunner {
  const globals = globalThis as { describe?: unknown; it?: unknown };
  if (typeof globals.describe !== 'function' || typeof globals.it !== 'function') {
    throw new EkzaError(
      'unsupported',
      'runDocumentStoreConformance registers through the global describe/it of the test runner (Vitest: globals: true)',
    );
  }
  const describe = globals.describe as (name: string, body: () => void) => void;
  const it = globals.it as (name: string, body: TestBody, timeout?: number) => void;
  return { describe: (name, body) => describe(name, body), it: (name, body, timeout) => it(name, body, timeout) };
}

// ---------- assertions ----------

export class ConformanceError extends Error {
  override readonly name = 'ConformanceError';
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceError(message);
}

export function equal(actual: unknown, expected: unknown, message: string): void {
  if (deepEqual(actual, expected)) return;
  if (
    typeof actual === 'string' &&
    typeof expected === 'string' &&
    (actual.includes('\n') || expected.includes('\n'))
  ) {
    throw new ConformanceError(`${message}\n${firstDifference(expected, actual)}`);
  }
  throw new ConformanceError(`${message}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`);
}

/** The first differing line of two texts, with two lines of context. */
function firstDifference(expected: string, actual: string): string {
  const left = expected.split('\n');
  const right = actual.split('\n');
  let line = 0;
  while (line < left.length && line < right.length && left[line] === right[line]) line++;
  const from = Math.max(0, line - 2);
  const context = left.slice(from, line).map((text) => `    ${text}`);
  return [
    `  first difference at line ${line + 1}:`,
    ...context,
    `  - expected: ${left[line] ?? '<end>'}`,
    `  + actual:   ${right[line] ?? '<end>'}`,
  ].join('\n');
}

export function throwsCode(fn: () => unknown, code: string, message: string): void {
  try {
    fn();
  } catch (error) {
    const actual = error instanceof EkzaError ? error.code : `non-EkzaError ${String(error)}`;
    check(actual === code, `${message}: expected EkzaError('${code}'), got ${actual}`);
    return;
  }
  throw new ConformanceError(`${message}: expected EkzaError('${code}'), nothing was thrown`);
}

function show(value: unknown): string {
  const text = JSON.stringify(value, (_key, inner: unknown) => (inner === undefined ? '<undefined>' : inner));
  return text === undefined ? String(value) : text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/** Canonical text of the committed document (byte-equal ⇔ equal content). */
export function docText(store: DocumentStore): string {
  return serializeSnapshot(store.snapshot());
}

/** Records every emitted batch until disposed. */
export function recordBatches(store: DocumentStore): { readonly batches: ChangeBatch[]; dispose(): void } {
  const batches: ChangeBatch[] = [];
  const dispose = store.subscribe((batch) => batches.push(batch));
  return { batches, dispose };
}

// ---------- typed shorthands over the generic store API ----------

export const put = <T extends TableName>(tx: Tx, table: T, record: RecordOf<T>): void => tx.put(table, record);

export function read<T extends TableName>(view: ReadView, table: T, id: string): RecordOf<T> | undefined {
  return view.get(table, id as RecordOf<T>['id']);
}

export function readRaw<T extends TableName>(view: ReadView, table: T, id: string): RecordOf<T> | undefined {
  return view.getIncludingDeleted(table, id as RecordOf<T>['id']);
}

// ---------- a small scene ----------

/** IDs of the scene `seedScene` writes: one character, a rig with three controls, a clip with one rz curve. */
export interface Scene {
  readonly asset: AssetId;
  readonly camera: CameraId;
  readonly character: CharacterId;
  readonly rig: RigId;
  /** root, then two children of root (orders a0, a1). */
  readonly controls: readonly [ControlId, ControlId, ControlId];
  readonly clip: ClipId;
  readonly layer: LayerId;
  /** Base-layer rz curve of controls[0] with keys at frames 0, 10, 20. */
  readonly curve: CurveId;
  readonly keys: readonly [KeyId, KeyId, KeyId];
  readonly partitions: readonly Partition[];
  /** ID stream for further records of this test. */
  readonly ids: IdSource;
  readonly seed: number;
}

/** A fresh scene description (no writes). */
export function newScene(seed: number): Scene {
  const ids = seededIdSource(seed);
  const character = newId('character', ids);
  const rig = newId('rig', ids);
  const clip = newId('clip', ids);
  const root = `${rig}:root` as ControlId;
  return {
    asset: makeTestAsset(`scene-${seed}.vrm`).id,
    camera: newId('camera', ids),
    character,
    rig,
    controls: [root, `${rig}:arm.L` as ControlId, `${rig}:arm.R` as ControlId],
    clip,
    layer: newId('layer', ids),
    curve: newId('curve', ids),
    keys: [newId('key', ids), newId('key', ids), newId('key', ids)],
    partitions: ['scene', `char:${character}`, `clip:${clip}`],
    ids,
    seed,
  };
}

/** Values of the scene's keys at frames 0, 10, 20 (distinct, so a value identifies its key). */
export const SCENE_KEY_VALUES = [0.5, -0.5, 0.25] as const;

/** Writes the scene in dependency order (scene, char, clip) inside the given transaction. */
export function writeScene(tx: Tx, scene: Scene, opts?: { readonly withProject?: boolean }): void {
  if (opts?.withProject !== false && tx.get('project', 'project') === undefined)
    tx.put('project', makeProject({ name: 'Conformance' }));
  tx.put('assets', makeTestAsset(`scene-${scene.seed}.vrm`));
  tx.put(
    'cameras',
    makeCamera({ id: scene.camera, name: 'shotCam', transform: { t: [0, 1, 3], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
  );
  tx.put(
    'characters',
    makeTestCharacter({
      id: scene.character,
      asset: scene.asset,
      rig: scene.rig,
      name: 'Hero',
      order: fractionalIndex(null, null),
    }),
  );
  tx.put('rigs', makeTestRig(scene.rig, scene.character));
  const [root, left, right] = scene.controls;
  tx.put('controls', makeTestControl({ rig: scene.rig, key: 'root', parent: null, order: 'a0' }));
  tx.put('controls', { ...makeTestControl({ rig: scene.rig, key: 'arm.L', parent: root, order: 'a0' }), id: left });
  tx.put('controls', { ...makeTestControl({ rig: scene.rig, key: 'arm.R', parent: root, order: 'a1' }), id: right });
  tx.put('clips', makeClip({ id: scene.clip, character: scene.character, name: 'wave', fps: { num: 30, den: 1 } }));
  tx.put('layers', makeLayer({ id: scene.layer, clip: scene.clip }));
  tx.put('curves', makeCurve({ id: scene.curve, clip: scene.clip, layer: scene.layer, control: root, channel: 'rz' }));
  scene.keys.forEach((id, i) => {
    tx.put('keys', makeKey({ id, clip: scene.clip, curve: scene.curve, t: i * 10, v: SCENE_KEY_VALUES[i] as number }));
  });
}

/** Opens the scene's partitions and writes it in one transaction. */
export async function seedScene(store: DocumentStore, seed = 1): Promise<Scene> {
  const scene = newScene(seed);
  for (const partition of scene.partitions) await store.open(partition);
  store.transact({ label: 'Seed' }, (tx) => writeScene(tx, scene));
  return scene;
}

/** A key on a curve (defaults: auto tangents). */
export function keyAt(scene: Scene, curve: CurveId, t: number, v: number, id?: KeyId): KeyRecord {
  return makeKey({ id: id ?? newId('key', scene.ids), clip: scene.clip, curve, t, v });
}

/** A second (duplicate or new) curve on the scene's clip. */
export function curveOf(scene: Scene, control: ControlId, channel: ChannelId, id?: CurveId) {
  return makeCurve({ id: id ?? newId('curve', scene.ids), clip: scene.clip, layer: scene.layer, control, channel });
}

// ---------- projection invariants ----------

/**
 * Projection invariants every reader may rely on: every query runs; keys of each canonical curve have strictly
 * increasing times; controlsOfRig lists each live control of the rig exactly once with parents before children
 * (a parent listed after its child marks a detached cycle member); canonical curves are unique per channel.
 */
export function checkProjections(view: ReadView, label: string): void {
  const q = view.query;
  for (const clip of view.list('clips')) {
    const curves = q.curvesOfClip(clip.id);
    const channels = new Set<string>();
    for (const curve of curves) {
      const channelKey = `${curve.layer}/${curve.control}/${curve.channel}`;
      check(!channels.has(channelKey), `${label}: two canonical curves for ${channelKey}`);
      channels.add(channelKey);
      check(
        q.curveFor(clip.id, curve.layer, curve.control, curve.channel)?.id === curve.id,
        `${label}: curveFor disagrees`,
      );
      const keys = q.keysOfCurve(curve.id);
      for (let i = 1; i < keys.length; i++) {
        check(
          (keys[i - 1] as KeyRecord).t < (keys[i] as KeyRecord).t,
          `${label}: key times of ${curve.id} not strictly increasing`,
        );
      }
      for (const hidden of q.hiddenKeys(curve.id)) {
        const winner = keys.find((key) => key.t === hidden.t);
        check(winner !== undefined && winner.id > hidden.id, `${label}: hidden key ${hidden.id} has no greater winner`);
      }
    }
    q.layersOfClip(clip.id);
    q.baseLayer(clip.id);
  }
  for (const rig of view.list('rigs')) {
    const controls = q.controlsOfRig(rig.id);
    const live = view.list('controls').filter((control) => control.rig === rig.id);
    equal(
      controls.map((c) => c.id).sort(),
      live.map((c) => c.id).sort(),
      `${label}: controlsOfRig lists every live control once`,
    );
    const position = new Map(controls.map((control, i) => [control.id, i]));
    const parentOf = new Map<string, string | null>(controls.map((control) => [control.id, control.parent]));
    for (const control of controls) {
      const parentAt = control.parent === null ? undefined : position.get(control.parent);
      if (parentAt === undefined || parentAt < (position.get(control.id) as number)) continue;
      // A parent listed after its child is only allowed for the detached (smallest-id) member of a cycle.
      const cycle: string[] = [control.id];
      for (
        let next = parentOf.get(control.id);
        next !== null && next !== undefined && next !== control.id;
        next = parentOf.get(next)
      ) {
        cycle.push(next);
        check(
          cycle.length <= controls.length,
          `${label}: ${control.id} is listed before its parent but is not on a cycle`,
        );
      }
      check(parentOf.get(cycle.at(-1) as string) === control.id, `${label}: ${control.id} listed before its parent`);
      check(
        cycle.every((id) => id >= control.id),
        `${label}: cycle detached at ${control.id}, not at its smallest id`,
      );
    }
  }
  for (const character of view.list('characters')) {
    q.clipsOfCharacter(character.id);
    q.rigOfCharacter(character.id);
  }
  q.missingPartitions();
}
