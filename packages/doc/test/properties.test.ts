// fast-check properties of the memory store (MVP-SPEC §6.3 doc gate): random operation sequences then undo-all
// equal the initial snapshot; indexed queries equal a brute-force projection; identical histories serialize to
// identical bytes.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ChannelId,
  compareStrings,
  type ControlRecord,
  type CurveRecord,
  createMemoryStore,
  type DocumentStore,
  type IdSource,
  type KeyRecord,
  makeCurve,
  makeKey,
  makeLayer,
  newId,
  type Partition,
  seededIdSource,
  serializeSnapshot,
} from '../src';
import { checkProjections, type Scene, seedScene } from '../src/testing';

type Op =
  | { readonly k: 'insertKey'; readonly curve: number; readonly t: number; readonly v: number }
  | { readonly k: 'editKey'; readonly key: number; readonly v: number }
  | { readonly k: 'retime'; readonly key: number; readonly t: number }
  | { readonly k: 'deleteKey'; readonly key: number }
  | { readonly k: 'newCurve'; readonly control: number; readonly channel: ChannelId }
  | { readonly k: 'toggleCurve'; readonly curve: number }
  | { readonly k: 'reparent'; readonly control: number; readonly parent: number | null }
  | { readonly k: 'reorder'; readonly control: number; readonly order: string }
  | { readonly k: 'rename'; readonly control: number; readonly name: string }
  | { readonly k: 'newLayer'; readonly order: string }
  | { readonly k: 'clip'; readonly loop: boolean; readonly sceneStart: number }
  | { readonly k: 'nudge'; readonly key: number; readonly v: number }
  | { readonly k: 'drag'; readonly key: number; readonly t: number; readonly commit: boolean }
  | { readonly k: 'undo' }
  | { readonly k: 'redo' }
  | { readonly k: 'close'; readonly which: number }
  | { readonly k: 'open'; readonly which: number };

const value = fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true });
const frame = fc.integer({ min: 0, max: 6 }).map((n) => n * 5);
const order = fc.constantFrom('Zz', 'a0', 'a0V', 'a1', 'a2', 'b00');

const editOps: fc.Arbitrary<Op>[] = [
  fc.record({ k: fc.constant('insertKey' as const), curve: fc.nat(), t: frame, v: value }),
  fc.record({ k: fc.constant('editKey' as const), key: fc.nat(), v: value }),
  fc.record({ k: fc.constant('retime' as const), key: fc.nat(), t: frame }),
  fc.record({ k: fc.constant('deleteKey' as const), key: fc.nat() }),
  fc.record({
    k: fc.constant('newCurve' as const),
    control: fc.nat(),
    channel: fc.constantFrom<ChannelId>('rx', 'rz', 'tx'),
  }),
  fc.record({ k: fc.constant('toggleCurve' as const), curve: fc.nat() }),
  fc.record({ k: fc.constant('reparent' as const), control: fc.nat(), parent: fc.option(fc.nat(), { nil: null }) }),
  fc.record({ k: fc.constant('reorder' as const), control: fc.nat(), order }),
  fc.record({ k: fc.constant('rename' as const), control: fc.nat(), name: fc.string({ maxLength: 8 }) }),
  fc.record({ k: fc.constant('newLayer' as const), order }),
  fc.record({ k: fc.constant('clip' as const), loop: fc.boolean(), sceneStart: fc.integer({ min: -5, max: 5 }) }),
  fc.record({ k: fc.constant('nudge' as const), key: fc.nat(), v: value }),
  fc.record({ k: fc.constant('drag' as const), key: fc.nat(), t: frame, commit: fc.boolean() }),
  fc.constant({ k: 'undo' as const }),
  fc.constant({ k: 'redo' as const }),
];
const partitionOps: fc.Arbitrary<Op>[] = [
  fc.record({ k: fc.constant('close' as const), which: fc.nat(2) }),
  fc.record({ k: fc.constant('open' as const), which: fc.nat(2) }),
];

const pick = <T>(items: readonly T[], index: number): T | undefined =>
  items.length === 0 ? undefined : items[index % items.length];

function apply(store: DocumentStore, scene: Scene, ids: IdSource, op: Op): void {
  const keys = store.list('keys');
  const curves = store.list('curves');
  const controls = store.list('controls');
  switch (op.k) {
    case 'insertKey': {
      const curve = pick(curves, op.curve);
      if (curve !== undefined) {
        store.transact({ label: 'Insert' }, (tx) =>
          tx.put('keys', makeKey({ id: newId('key', ids), clip: curve.clip, curve: curve.id, t: op.t, v: op.v })),
        );
      }
      return;
    }
    case 'editKey':
    case 'retime': {
      const key = pick(keys, op.key);
      if (key !== undefined)
        store.transact({ label: 'Key' }, (tx) =>
          tx.patch('keys', key.id, op.k === 'editKey' ? { v: op.v } : { t: op.t }),
        );
      return;
    }
    case 'deleteKey': {
      const key = pick(keys, op.key);
      if (key !== undefined) store.transact({ label: 'Delete' }, (tx) => tx.remove('keys', key.id));
      return;
    }
    case 'newCurve': {
      const control = pick(controls, op.control);
      if (control !== undefined && store.isOpen(`clip:${scene.clip}`)) {
        const curve = makeCurve({
          id: newId('curve', ids),
          clip: scene.clip,
          layer: scene.layer,
          control: control.id,
          channel: op.channel,
        });
        store.transact({ label: 'Curve' }, (tx) => tx.put('curves', curve));
      }
      return;
    }
    case 'toggleCurve': {
      const all = [scene.curve, ...curves.map((c) => c.id)];
      const id = pick(all, op.curve);
      const curve = id === undefined ? undefined : store.getIncludingDeleted('curves', id);
      if (curve !== undefined) {
        store.transact({ label: 'Toggle' }, (tx) =>
          curve.deleted === null ? tx.softDelete('curves', curve.id) : tx.restore('curves', curve.id),
        );
      }
      return;
    }
    case 'reparent': {
      const control = pick(controls, op.control);
      const parent = op.parent === null ? null : (pick(controls, op.parent)?.id ?? null);
      if (control !== undefined && parent !== control.id)
        store.transact({ label: 'Parent' }, (tx) => tx.patch('controls', control.id, { parent }));
      return;
    }
    case 'reorder':
    case 'rename': {
      const control = pick(controls, op.control);
      if (control !== undefined) {
        store.transact({ label: 'Control' }, (tx) =>
          tx.patch('controls', control.id, op.k === 'reorder' ? { order: op.order } : { name: op.name }),
        );
      }
      return;
    }
    case 'newLayer':
      if (store.isOpen(`clip:${scene.clip}`)) {
        store.transact({ label: 'Layer' }, (tx) =>
          tx.put('layers', makeLayer({ id: newId('layer', ids), clip: scene.clip, name: 'Upper', order: op.order })),
        );
      }
      return;
    case 'clip':
      if (store.get('clips', scene.clip) !== undefined) {
        store.transact({ label: 'Clip' }, (tx) =>
          tx.patch('clips', scene.clip, { loop: op.loop, sceneStart: op.sceneStart }),
        );
      }
      return;
    case 'nudge': {
      const key = pick(keys, op.key);
      if (key !== undefined) {
        store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 3_600_000 }, (tx) =>
          tx.patch('keys', key.id, { v: op.v }),
        );
      }
      return;
    }
    case 'drag': {
      const key = pick(keys, op.key);
      if (key === undefined) return;
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('keys', key.id, { t: op.t + 1 }));
      preview.update((tx) => tx.patch('keys', key.id, { t: op.t }));
      if (op.commit) preview.commit();
      else preview.cancel();
      return;
    }
    case 'undo':
      store.undo.undo();
      return;
    case 'redo':
      store.undo.redo();
      return;
    case 'close':
    case 'open': {
      const partition = scene.partitions[op.which] as Partition;
      if (op.k === 'close') store.close(partition);
      else void store.open(partition);
      return;
    }
  }
}

async function freshStore(seed: number): Promise<{ store: DocumentStore; scene: Scene; ids: IdSource }> {
  const store = createMemoryStore({ now: () => 0 });
  const scene = await seedScene(store, seed);
  store.undo.clear();
  return { store, scene, ids: seededIdSource(seed + 1) };
}

describe('memory store properties (fast-check)', () => {
  it('random operation sequences then undo-all restore the initial snapshot; redo-all then undo-all again', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(...editOps), { maxLength: 40 }), async (ops) => {
        const { store, scene, ids } = await freshStore(17);
        const initial = serializeSnapshot(store.snapshot());
        for (const op of ops) apply(store, scene, ids, op);
        const edited = serializeSnapshot(store.snapshot());
        while (store.undo.undo() !== null) {
          // undo everything
        }
        expect(serializeSnapshot(store.snapshot())).toBe(initial);
        while (store.undo.redo() !== null) {
          // redo everything
        }
        checkProjections(store, 'after redo-all');
        while (store.undo.undo() !== null) {
          // and back
        }
        expect(serializeSnapshot(store.snapshot())).toBe(initial);
        expect(edited.length).toBeGreaterThan(0);
      }),
      { numRuns: 150 },
    );
  });

  it('indexed queries equal a brute-force projection, including closed partitions and an open preview', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(...editOps, ...partitionOps), { maxLength: 40 }),
        fc.option(fc.nat()),
        async (ops, dragKey) => {
          const { store, scene, ids } = await freshStore(23);
          for (const op of ops) {
            apply(store, scene, ids, op);
            expectBruteForce(store, scene);
          }
          const keys = store.list('keys');
          const key = dragKey === null ? undefined : pick(keys, dragKey);
          if (key !== undefined) {
            const preview = store.beginPreview('Drag');
            preview.update((tx) => tx.patch('keys', key.id, { t: key.t + 2.5 }));
            expectBruteForce(store, scene);
            preview.cancel();
            expectBruteForce(store, scene);
          }
          expect(store.preview).toBeNull();
        },
      ),
      { numRuns: 150 },
    );
  });

  it('identical histories serialize to identical bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(...editOps), { maxLength: 30 }), async (ops) => {
        const texts: string[] = [];
        for (let run = 0; run < 2; run++) {
          const { store, scene, ids } = await freshStore(31);
          for (const op of ops) apply(store, scene, ids, op);
          texts.push(serializeSnapshot(store.snapshot()));
        }
        expect(texts[1]).toBe(texts[0]);
      }),
      { numRuns: 60 },
    );
  });
});

/** Recomputes every query from `list()`/`get()` with naive algorithms and compares. */
function expectBruteForce(store: DocumentStore, scene: Scene): void {
  const q = store.query;
  const curves = store.list('curves');
  const groupOf = (c: CurveRecord): string => `${c.clip}/${c.layer}/${c.control}/${c.channel}`;
  const groups = new Map<string, CurveRecord[]>();
  for (const curve of curves) groups.set(groupOf(curve), [...(groups.get(groupOf(curve)) ?? []), curve]);
  const canonical = new Map<string, CurveRecord>();
  for (const [group, members] of groups)
    canonical.set(group, [...members].sort((a, b) => compareStrings(a.id, b.id))[0] as CurveRecord);

  for (const curve of curves) {
    const isCanonical = canonical.get(groupOf(curve))?.id === curve.id;
    const memberIds = new Set((groups.get(groupOf(curve)) ?? []).map((c) => c.id));
    const keys = store
      .list('keys')
      .filter((k) => memberIds.has(k.curve))
      .sort((a, b) => a.t - b.t || compareStrings(b.id, a.id));
    const visible = keys.filter((k, i) => i === 0 || (keys[i - 1] as KeyRecord).t !== k.t);
    const hidden = keys.filter((k) => !visible.includes(k));
    expect(q.keysOfCurve(curve.id).map((k) => k.id)).toEqual(isCanonical ? visible.map((k) => k.id) : []);
    expect(
      q
        .hiddenKeys(curve.id)
        .map((k) => k.id)
        .sort(compareStrings),
    ).toEqual(isCanonical ? hidden.map((k) => k.id).sort(compareStrings) : []);
    expect(q.curveFor(curve.clip, curve.layer, curve.control, curve.channel)?.id).toBe(
      canonical.get(groupOf(curve))?.id,
    );
  }
  const canonicalIds = [...canonical.values()].map((c) => c.id);
  expect(q.curvesOfClip(scene.clip).map((c) => c.id)).toEqual(
    canonicalIds.filter((id) => store.get('curves', id)?.clip === scene.clip).sort(compareStrings),
  );
  for (const control of scene.controls) {
    expect(q.curvesOfControl(scene.clip, control).map((c) => c.id)).toEqual(
      [...canonical.values()]
        .filter((c) => c.clip === scene.clip && c.control === control)
        .map((c) => c.id)
        .sort(compareStrings),
    );
  }
  const byOrder = <T extends { id: string; order: string }>(items: T[]): T[] =>
    items.sort((a, b) => compareStrings(a.order, b.order) || compareStrings(a.id, b.id));
  const layers = byOrder(store.list('layers').filter((l) => l.clip === scene.clip));
  expect(q.layersOfClip(scene.clip)).toEqual(layers);
  expect(q.baseLayer(scene.clip)).toEqual(layers[0]);
  expect(q.clipsOfCharacter(scene.character)).toEqual(
    byOrder(store.list('clips').filter((c) => c.character === scene.character)),
  );
  expect(q.rigOfCharacter(scene.character)?.id).toBe(
    store.list('rigs').find((r) => r.character === scene.character)?.id,
  );
  expect(q.controlByKey(scene.rig, 'arm.L')?.id).toBe(store.get('controls', scene.controls[1])?.id);
  expect(q.controlsOfRig(scene.rig).map((c) => c.id)).toEqual(
    naiveHierarchy(store.list('controls').filter((c) => c.rig === scene.rig)),
  );
  const missing: string[] = [];
  for (const character of store.list('characters'))
    if (!store.isOpen(`char:${character.id}`)) missing.push(`char:${character.id}`);
  for (const clip of store.list('clips')) if (!store.isOpen(`clip:${clip.id}`)) missing.push(`clip:${clip.id}`);
  expect(q.missingPartitions()).toEqual(missing.sort(compareStrings));
}

/** Pre-order DFS with cycles broken at their smallest id, written without the store's helper. */
function naiveHierarchy(controls: readonly ControlRecord[]): string[] {
  const byId = new Map(controls.map((c) => [c.id as string, c]));
  const parentOf = (id: string): string | null => {
    const parent = byId.get(id)?.parent ?? null;
    return parent !== null && parent !== id && byId.has(parent) ? parent : null;
  };
  const onCycle = (id: string): string[] | null => {
    const path: string[] = [id];
    for (let next = parentOf(id); next !== null; next = parentOf(next)) {
      if (next === id) return path;
      if (path.length > byId.size) return null;
      path.push(next);
    }
    return null;
  };
  const detached = new Set<string>();
  for (const id of byId.keys()) {
    const cycle = onCycle(id);
    if (cycle !== null) detached.add([...cycle].sort(compareStrings)[0] as string);
  }
  const effectiveParent = (id: string): string | null => (detached.has(id) ? null : parentOf(id));
  const children = (parent: string | null): ControlRecord[] =>
    controls
      .filter((c) => effectiveParent(c.id) === parent)
      .sort((a, b) => compareStrings(a.order, b.order) || compareStrings(a.id, b.id));
  const out: string[] = [];
  const visit = (control: ControlRecord): void => {
    out.push(control.id);
    for (const child of children(control.id)) visit(child);
  };
  for (const root of children(null)) visit(root);
  return out;
}
