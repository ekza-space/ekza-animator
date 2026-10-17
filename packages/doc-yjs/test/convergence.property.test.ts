// fast-check convergence of Yjs replicas (MVP-SPEC §7 WP-2, research 06 §7.4): random edits, undo/redo and network
// faults on three replicas, then heal and settle → identical documents and valid projections everywhere.
import {
  type ChannelId,
  makeCurve,
  makeKey,
  newId,
  type ReplicatingStore,
  seededIdSource,
  serializeSnapshot,
} from '@ekza-animator/doc';
import { checkProjections, newScene, writeScene } from '@ekza-animator/doc/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { yjsHarness } from '../src';

type Op =
  | { readonly k: 'key'; readonly peer: number; readonly key: number; readonly t: number; readonly v: number }
  | { readonly k: 'insert'; readonly peer: number; readonly curve: number; readonly t: number; readonly v: number }
  | { readonly k: 'delete'; readonly peer: number; readonly key: number }
  | {
      readonly k: 'control';
      readonly peer: number;
      readonly control: number;
      readonly name: string;
      readonly parent: number | null;
    }
  | { readonly k: 'curve'; readonly peer: number; readonly control: number; readonly channel: ChannelId }
  | { readonly k: 'toggle'; readonly peer: number; readonly curve: number }
  | { readonly k: 'undo' | 'redo'; readonly peer: number }
  | { readonly k: 'deliver' }
  | { readonly k: 'cut'; readonly a: number; readonly b: number }
  | { readonly k: 'heal' }
  | { readonly k: 'link'; readonly delayTicks: number; readonly dropRate: number; readonly reorder: boolean };

const peer = fc.nat(2);
const t = fc.integer({ min: 0, max: 5 }).map((n) => n * 5);
const v = fc.integer({ min: -1000, max: 1000 }).map((n) => n / 100);
const op: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.record({ k: fc.constant('key' as const), peer, key: fc.nat(), t, v }), weight: 4 },
  { arbitrary: fc.record({ k: fc.constant('insert' as const), peer, curve: fc.nat(), t, v }), weight: 3 },
  { arbitrary: fc.record({ k: fc.constant('delete' as const), peer, key: fc.nat() }), weight: 2 },
  {
    arbitrary: fc.record({
      k: fc.constant('control' as const),
      peer,
      control: fc.nat(),
      name: fc.constantFrom('a', 'b', 'c'),
      parent: fc.option(fc.nat(), { nil: null }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      k: fc.constant('curve' as const),
      peer,
      control: fc.nat(),
      channel: fc.constantFrom<ChannelId>('rx', 'ry'),
    }),
    weight: 1,
  },
  { arbitrary: fc.record({ k: fc.constant('toggle' as const), peer, curve: fc.nat() }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constantFrom('undo' as const, 'redo' as const), peer }), weight: 3 },
  { arbitrary: fc.constant({ k: 'deliver' as const }), weight: 5 },
  { arbitrary: fc.record({ k: fc.constant('cut' as const), a: peer, b: peer }), weight: 1 },
  { arbitrary: fc.constant({ k: 'heal' as const }), weight: 1 },
  {
    arbitrary: fc.record({
      k: fc.constant('link' as const),
      delayTicks: fc.nat(2),
      dropRate: fc.constantFrom(0, 0.3),
      reorder: fc.boolean(),
    }),
    weight: 1,
  },
);

const nth = <T>(items: readonly T[], i: number): T | undefined =>
  items.length === 0 ? undefined : items[i % items.length];

describe('Yjs replicas (fast-check)', () => {
  it('converge after any interleaving of edits, undo/redo, delay, loss, reordering and partitions', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 50 }), fc.nat(), async (ops, seed) => {
        const net = yjsHarness().create(3, { seed });
        const peers = net.peers as readonly ReplicatingStore[];
        const scene = newScene(5);
        for (const store of peers) for (const partition of scene.partitions) await store.open(partition);
        (peers[0] as ReplicatingStore).transact({ label: 'Seed' }, (tx) => writeScene(tx, scene));
        net.settle();
        const ids = seededIdSource(seed + 1);
        for (const step of ops) {
          if (step.k === 'deliver') net.deliver();
          else if (step.k === 'cut') net.partition(step.a, step.b);
          else if (step.k === 'heal') net.heal();
          else if (step.k === 'link') net.setLink(step);
          else apply(peers[step.peer] as ReplicatingStore, step, ids, scene);
        }
        net.settle();
        const texts = peers.map((store) => serializeSnapshot(store.snapshot()));
        expect(texts[1]).toBe(texts[0]);
        expect(texts[2]).toBe(texts[0]);
        for (const store of peers) checkProjections(store, store.replicaId);
      }),
      { numRuns: 120 },
    );
  });
});

function apply(
  store: ReplicatingStore,
  step: Op,
  ids: ReturnType<typeof seededIdSource>,
  scene: ReturnType<typeof newScene>,
): void {
  const keys = store.list('keys');
  const curves = store.list('curves');
  const controls = store.list('controls');
  switch (step.k) {
    case 'key': {
      const key = nth(keys, step.key);
      if (key !== undefined)
        store.transact({ label: 'Key' }, (tx) => tx.patch('keys', key.id, { t: step.t, v: step.v }));
      return;
    }
    case 'insert': {
      const curve = nth(curves, step.curve);
      if (curve !== undefined) {
        store.transact({ label: 'Insert' }, (tx) =>
          tx.put('keys', makeKey({ id: newId('key', ids), clip: curve.clip, curve: curve.id, t: step.t, v: step.v })),
        );
      }
      return;
    }
    case 'delete': {
      const key = nth(keys, step.key);
      if (key !== undefined) store.transact({ label: 'Delete' }, (tx) => tx.remove('keys', key.id));
      return;
    }
    case 'control': {
      const control = nth(controls, step.control);
      if (control === undefined) return;
      const parent = step.parent === null ? null : (nth(controls, step.parent)?.id ?? null);
      store.transact({ label: 'Control' }, (tx) =>
        tx.patch('controls', control.id, parent === control.id ? { name: step.name } : { name: step.name, parent }),
      );
      return;
    }
    case 'curve': {
      const control = nth(controls, step.control);
      if (control !== undefined && store.get('layers', scene.layer) !== undefined) {
        store.transact({ label: 'Curve' }, (tx) =>
          tx.put(
            'curves',
            makeCurve({
              id: newId('curve', ids),
              clip: scene.clip,
              layer: scene.layer,
              control: control.id,
              channel: step.channel,
            }),
          ),
        );
      }
      return;
    }
    case 'toggle': {
      const curve = nth(curves, step.curve);
      if (curve !== undefined) store.transact({ label: 'Delete curve' }, (tx) => tx.softDelete('curves', curve.id));
      return;
    }
    case 'undo':
      store.undo.undo();
      return;
    case 'redo':
      store.undo.redo();
      return;
    default:
      return;
  }
}
