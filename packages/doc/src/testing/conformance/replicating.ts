// Replicating half of the conformance suite (ADR 0002 §5, research 06 §4.2 and §7.4): convergence under delay, loss,
// reordering and network partitions; projection invariants; per-user undo isolation; golden regressions for the
// hazards H1–H5; per-field undo across replicas; partition-by-partition application; and the documented outcome of
// an fps change concurrent with a key edit.
import type { ClipId, CurveId, KeyId } from '../../ids';
import { newId } from '../../ids/generate';
import type { ChannelId, KeyRecord } from '../../records';
import { makeClip, makeCurve, makeKey, makeLayer } from '../../records/factories';
import type { ChangeBatch, ConformanceCaps, DocumentStore, ReplicaNetwork, ReplicatingStore } from '../../store';
import { compareStrings } from '../../store/diff';
import { mergeUnitOf } from '../../tables/registry';
import { checkSteps, type Rng } from '../random';
import {
  check,
  checkProjections,
  docText,
  equal,
  keyAt,
  newScene,
  read,
  readRaw,
  type Scene,
  type SuiteRunner,
  writeScene,
} from './harness';

interface Net {
  readonly net: ReplicaNetwork;
  readonly peers: readonly ReplicatingStore[];
  readonly scene: Scene;
}

async function seededNetwork(caps: ConformanceCaps, n: number, seed: number): Promise<Net> {
  const harness = caps.harness;
  check(harness !== undefined, 'replicating conformance needs caps.harness');
  const net = harness.create(n, { seed });
  const peers = net.peers;
  equal(peers.length, n, 'peer count');
  check(new Set(peers.map((p) => p.user)).size === n, 'every replica needs its own user (per-user undo)');
  check(new Set(peers.map((p) => p.replicaId)).size === n, 'replica ids are unique');
  const scene = newScene(seed);
  for (const peer of peers) for (const partition of scene.partitions) await peer.open(partition);
  (peers[0] as ReplicatingStore).transact({ label: 'Seed' }, (tx) => writeScene(tx, scene));
  net.settle();
  assertConverged(peers, 'after seeding');
  return { net, peers, scene };
}

function assertConverged(peers: readonly DocumentStore[], label: string): void {
  const reference = docText(peers[0] as DocumentStore);
  peers.forEach((peer, i) => {
    if (i > 0) equal(docText(peer), reference, `${label}: replica ${i} converged with replica 0`);
    checkProjections(peer, `${label}: replica ${i}`);
  });
}

function peerAt(net: Net, i: number): ReplicatingStore {
  const peer = net.peers[i];
  check(peer !== undefined, `peer ${i}`);
  return peer;
}

export function registerReplicatingCases(r: SuiteRunner, caps: ConformanceCaps): void {
  r.describe('replication basics', () => {
    r.it('remote batches carry origin remote, reach readers and never enter the undo stack', async () => {
      const n = await seededNetwork(caps, 2, 101);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const batches: ChangeBatch[] = [];
      const dispose = b.subscribe((batch) => batches.push(batch));
      a.transact({ label: 'Loop' }, (tx) => tx.patch('clips', n.scene.clip, { loop: true }));
      n.net.settle();
      dispose();
      equal(read(b, 'clips', n.scene.clip)?.loop, true, 'B sees the change');
      check(batches.length > 0 && batches.every((batch) => batch.origin === 'remote'), 'remote origin');
      check(!b.undo.canUndo(), 'nothing on B’s undo stack');
      check(a.undo.peekUndo()?.label === 'Loop', 'A’s own stack has it');
    });

    r.it('concurrent disjoint edits converge to the union', async () => {
      const n = await seededNetwork(caps, 3, 102);
      const [a, b, c] = [peerAt(n, 0), peerAt(n, 1), peerAt(n, 2)];
      const { scene } = n;
      a.transact({ label: 'A' }, (tx) => {
        tx.patch('controls', scene.controls[1], { name: 'Left by A' });
        tx.put('keys', keyAt(scene, scene.curve, 5, 0.1));
      });
      b.transact({ label: 'B' }, (tx) => {
        tx.patch('controls', scene.controls[2], { name: 'Right by B' });
        tx.put('keys', keyAt(scene, scene.curve, 15, 0.2));
      });
      c.transact({ label: 'C' }, (tx) => tx.patch('controls', scene.controls[1], { order: 'a7' }));
      n.net.settle();
      assertConverged(n.peers, 'union');
      equal(read(c, 'controls', scene.controls[1])?.name, 'Left by A', 'A’s field');
      equal(read(c, 'controls', scene.controls[1])?.order, 'a7', 'C’s field of the same record');
      equal(read(a, 'controls', scene.controls[2])?.name, 'Right by B', 'B’s field');
      equal(
        a.query.keysOfCurve(scene.curve).map((k) => k.t),
        [0, 5, 10, 15, 20],
        'every key',
      );
    });

    r.it('a preview is local: peers see nothing until the commit, then only the committed result', async () => {
      const n = await seededNetwork(caps, 2, 103);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const before = docText(b);
      const batches: ChangeBatch[] = [];
      const dispose = b.subscribe((batch) => batches.push(batch));
      const preview = a.beginPreview('Drag');
      for (let i = 1; i <= 10; i++) {
        preview.update((tx) => tx.patch('keys', n.scene.keys[1], { v: i }));
        n.net.deliver();
      }
      equal(docText(b), before, 'peers never see previews');
      equal(batches.length, 0, 'no updates on the wire during the drag');
      preview.commit();
      n.net.settle();
      dispose();
      equal(read(b, 'keys', n.scene.keys[1])?.v, 10, 'the committed value arrives');
      equal(batches.length, 1, 'as one remote batch');
    });
  });

  r.describe('hazard goldens (research 06 §4.2)', () => {
    r.it(
      'H1: concurrent first keys on one channel create two curves; both keys survive in the projection',
      async () => {
        for (const sameTime of [false, true]) {
          const n = await seededNetwork(caps, 2, sameTime ? 111 : 110);
          const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
          const { scene } = n;
          const control = scene.controls[1];
          const curveA = makeCurve({
            id: newId('curve', scene.ids),
            clip: scene.clip,
            layer: scene.layer,
            control,
            channel: 'rx',
          });
          const curveB = makeCurve({
            id: newId('curve', scene.ids),
            clip: scene.clip,
            layer: scene.layer,
            control,
            channel: 'rx',
          });
          const keyA = keyAt(scene, curveA.id, 0, 1);
          const keyB = keyAt(scene, curveB.id, sameTime ? 0 : 10, 2);
          a.transact({ label: 'Key A' }, (tx) => {
            tx.put('curves', curveA);
            tx.put('keys', keyA);
          });
          b.transact({ label: 'Key B' }, (tx) => {
            tx.put('curves', curveB);
            tx.put('keys', keyB);
          });
          n.net.settle();
          assertConverged(n.peers, `H1 (same time: ${sameTime})`);
          const canonical = [curveA.id, curveB.id].sort(compareStrings)[0] as CurveId;
          for (const peer of n.peers) {
            equal(
              peer.query.curveFor(scene.clip, scene.layer, control, 'rx')?.id,
              canonical,
              'smallest CurveId is canonical',
            );
            equal(
              peer.query.curvesOfControl(scene.clip, control).map((c) => c.id),
              [canonical],
              'one canonical curve',
            );
            check(
              read(peer, 'keys', keyA.id) !== undefined && read(peer, 'keys', keyB.id) !== undefined,
              'no key lost',
            );
            const visible = peer.query.keysOfCurve(canonical).map((k) => k.id);
            if (sameTime) {
              const winner = [keyA.id, keyB.id].sort(compareStrings)[1] as KeyId;
              equal(visible, [winner], 'same time: the greatest KeyId is visible');
              equal(peer.query.hiddenKeys(canonical).length, 1, 'the other is hidden, not lost');
            } else {
              equal(visible, [keyA.id, keyB.id], 'both keys in the union');
            }
          }
        }
      },
    );

    r.it('H2: deleting a curve while a peer keys into it keeps the key; restoring the curve shows it', async () => {
      const n = await seededNetwork(caps, 2, 120);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const { scene } = n;
      const keyB = keyAt(scene, scene.curve, 25, 0.9);
      a.transact({ label: 'Delete curve' }, (tx) => tx.softDelete('curves', scene.curve));
      b.transact({ label: 'Key' }, (tx) => tx.put('keys', keyB));
      n.net.settle();
      assertConverged(n.peers, 'H2');
      for (const peer of n.peers) {
        equal(read(peer, 'curves', scene.curve), undefined, 'curve deleted');
        check(read(peer, 'keys', keyB.id) !== undefined, 'B’s key survives (soft delete, not container loss)');
      }
      a.undo.undo();
      n.net.settle();
      assertConverged(n.peers, 'H2 restored');
      check(
        b.query.keysOfCurve(scene.curve).some((k) => k.id === keyB.id),
        'the restored curve shows B’s key',
      );
    });

    r.it('H3: an edit concurrent with a hard delete wins — the key reappears (documented)', async () => {
      const n = await seededNetwork(caps, 2, 130);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const id = n.scene.keys[1];
      a.transact({ label: 'Delete key' }, (tx) => tx.remove('keys', id));
      b.transact({ label: 'Edit key' }, (tx) => tx.patch('keys', id, { v: 0.75 }));
      n.net.settle();
      assertConverged(n.peers, 'H3');
      for (const peer of n.peers) equal(read(peer, 'keys', id)?.v, 0.75, 'edit beats delete');
    });

    r.it(
      'H4: concurrent sets of one key, then undo by one writer: the key never vanishes or clobbers the winner',
      async () => {
        for (const seed of [140, 141, 142, 143]) {
          const n = await seededNetwork(caps, 2, seed);
          const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
          const id = n.scene.keys[1];
          const original = read(a, 'keys', id);
          a.transact({ label: 'Set A' }, (tx) => tx.patch('keys', id, { v: 1 }));
          b.transact({ label: 'Set B' }, (tx) => tx.patch('keys', id, { v: 2 }));
          n.net.settle();
          assertConverged(n.peers, 'H4 sets');
          const winner = read(a, 'keys', id)?.v;
          check(winner === 1 || winner === 2, 'LWW picks one of the concurrent values');
          const result = a.undo.undo();
          n.net.settle();
          assertConverged(n.peers, 'H4 undo');
          if (winner === 1) {
            equal(result?.skipped, [], 'A won: its undo applies');
            equal(read(b, 'keys', id), original, 'A’s undo restores the original key');
          } else {
            equal(
              result?.skipped.map((s) => s.reason),
              ['changed-by-other'],
              'B won: A’s undo is skipped and reported',
            );
            equal(read(b, 'keys', id)?.v, 2, 'B’s value is kept');
          }
        }
      },
    );

    r.it('H5: undo after a sequential overwrite by another user is skipped; their value is kept', async () => {
      const n = await seededNetwork(caps, 2, 150);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const id = n.scene.keys[1];
      a.transact({ label: 'Set A' }, (tx) => tx.patch('keys', id, { v: 1 }));
      n.net.settle();
      b.transact({ label: 'Set B' }, (tx) => tx.patch('keys', id, { v: 2 }));
      n.net.settle();
      const result = a.undo.undo();
      equal(result?.applied, 0, 'nothing applied');
      equal(
        result?.skipped.map((s) => [s.change.id, s.reason]),
        [[id, 'changed-by-other']],
        'skip report',
      );
      n.net.settle();
      assertConverged(n.peers, 'H5');
      equal(read(a, 'keys', id)?.v, 2, 'B’s value kept everywhere');
    });
  });

  r.describe('per-field undo across replicas', () => {
    r.it(
      'a concurrent edit of another field does not block undo; of the same field it is skipped and reported',
      async () => {
        const n = await seededNetwork(caps, 2, 160);
        const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
        const control = n.scene.controls[1];
        a.transact({ label: 'Rename' }, (tx) => tx.patch('controls', control, { name: 'By A' }));
        b.transact({ label: 'Reorder' }, (tx) => tx.patch('controls', control, { order: 'a9' }));
        n.net.settle();
        const first = a.undo.undo();
        equal(first?.skipped, [], 'other field: undo applies');
        n.net.settle();
        assertConverged(n.peers, 'other field');
        equal(read(b, 'controls', control)?.name, 'arm.L', 'A’s name reverted everywhere');
        equal(read(b, 'controls', control)?.order, 'a9', 'B’s order kept');
        a.undo.redo();
        n.net.settle();
        b.transact({ label: 'Rename B' }, (tx) => tx.patch('controls', control, { name: 'By B' }));
        n.net.settle();
        const second = a.undo.undo();
        equal(
          second?.skipped.map((s) => [s.fields, s.reason]),
          [[['name'], 'changed-by-other']],
          'same field: skipped',
        );
        n.net.settle();
        assertConverged(n.peers, 'same field');
        equal(read(a, 'controls', control)?.name, 'By B', 'B’s name kept');
      },
    );
  });

  r.describe('partitions across replicas', () => {
    r.it('a cross-partition batch applied partition by partition in any order keeps projections valid', async () => {
      for (const seed of [170, 171, 172, 173, 174, 175]) {
        const n = await seededNetwork(caps, 2, seed);
        const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
        const extra = newScene(seed + 1000);
        for (const partition of extra.partitions) await b.open(partition);
        let steps = 0;
        const dispose = b.subscribe(() => {
          steps++;
          checkProjections(b, `seed ${seed}, remote step ${steps}`);
        });
        n.net.setLink({ reorder: true });
        a.transact({ label: 'New character' }, (tx) => writeScene(tx, extra, { withProject: false }));
        while (n.net.deliver() > 0) {
          // one delivery round may apply several partitions in shuffled order
        }
        n.net.settle();
        dispose();
        check(steps >= 2, `the batch arrived in ≥ 2 partition updates (got ${steps})`);
        assertConverged(n.peers, `seed ${seed}`);
        equal(b.query.keysOfCurve(extra.curve).length, 3, 'complete');
      }
    });

    r.it('updates for a partition a replica has not opened arrive and appear when it opens', async () => {
      const n = await seededNetwork(caps, 2, 180);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const extra = newScene(1180);
      await b.open('scene');
      a.transact({ label: 'New character' }, (tx) => writeScene(tx, extra, { withProject: false }));
      n.net.settle();
      check(read(b, 'characters', extra.character) !== undefined, 'scene records visible');
      equal(read(b, 'rigs', extra.rig), undefined, 'char partition not open: hidden');
      equal(b.query.missingPartitions(), [`char:${extra.character}`], 'reported missing');
      await b.open(`char:${extra.character}`);
      await b.open(`clip:${extra.clip}`);
      equal(b.query.missingPartitions(), [], 'nothing missing');
      assertConverged(n.peers, 'after opening');
    });
  });

  r.describe('structural edits', () => {
    r.it(
      'golden: an fps change concurrent with a key edit (keep frames merges; keep seconds may lose one side)',
      async () => {
        // Keep frames: only clip.fps changes; the key edit is another record → both survive.
        {
          const n = await seededNetwork(caps, 2, 190);
          const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
          const { scene } = n;
          a.transact({ label: 'Clip fps (keep frames)' }, (tx) =>
            tx.patch('clips', scene.clip, { fps: { num: 24, den: 1 } }),
          );
          b.transact({ label: 'Edit key' }, (tx) => tx.patch('keys', scene.keys[1], { v: 0.3 }));
          n.net.settle();
          assertConverged(n.peers, 'keep frames');
          equal(read(b, 'clips', scene.clip)?.fps, { num: 24, den: 1 }, 'fps changed');
          equal(
            read(a, 'keys', scene.keys[1]),
            { ...(read(a, 'keys', scene.keys[1]) as KeyRecord), t: 10, v: 0.3 },
            'key edit kept',
          );
        }
        // Keep seconds: every key time is rescaled (30 → 24 fps: t·0.8) while B edits key 1. Keys merge as whole
        // records, so key 1 is either A's rescaled copy or B's edit at its old time — never both, never lost, never a
        // duplicate. This is why structural clip edits will require an exclusive claim (ADR 0002 §8).
        {
          const n = await seededNetwork(caps, 2, 191);
          const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
          const { scene } = n;
          a.transact({ label: 'Clip fps (keep seconds)' }, (tx) => {
            tx.patch('clips', scene.clip, { fps: { num: 24, den: 1 } });
            for (const id of scene.keys) {
              const key = tx.get('keys', id) as KeyRecord;
              tx.patch('keys', id, { t: key.t * 0.8 });
            }
          });
          b.transact({ label: 'Edit key' }, (tx) => tx.patch('keys', scene.keys[1], { v: 0.3 }));
          n.net.settle();
          assertConverged(n.peers, 'keep seconds');
          const keys = b.query.keysOfCurve(scene.curve);
          equal(keys.length, 3, 'no key lost or duplicated');
          equal([keys[0]?.t, keys[2]?.t], [0, 16], 'uncontested keys rescaled');
          const contested = read(b, 'keys', scene.keys[1]) as KeyRecord;
          const aWon = contested.t === 8 && contested.v === -0.5;
          const bWon = contested.t === 10 && contested.v === 0.3;
          check(
            aWon !== bWon,
            `the contested key is exactly one side’s version, got t=${contested.t} v=${contested.v}`,
          );
        }
      },
    );

    r.it('concurrent reparenting into a cycle converges and is broken at the smallest id everywhere', async () => {
      const n = await seededNetwork(caps, 2, 200);
      const [a, b] = [peerAt(n, 0), peerAt(n, 1)];
      const [, left, right] = n.scene.controls;
      a.transact({ label: 'Parent L under R' }, (tx) => tx.patch('controls', left, { parent: right }));
      b.transact({ label: 'Parent R under L' }, (tx) => tx.patch('controls', right, { parent: left }));
      n.net.settle();
      assertConverged(n.peers, 'cycle');
      const order = a.query.controlsOfRig(n.scene.rig).map((c) => c.id);
      equal(
        b.query.controlsOfRig(n.scene.rig).map((c) => c.id),
        order,
        'same order on every replica',
      );
    });
  });

  r.describe('fuzz', () => {
    r.it(
      'random edits under delay, loss, reordering and partitions converge; undo never touches another user’s write',
      async () => {
        await checkSteps<Step>(
          'replica fuzz',
          { seed: 0xc0ffee, runs: 150, maxShrinks: 200 },
          (rng) => Array.from({ length: rng.range(15, 60) }, () => randomStep(rng, 3)),
          (steps) => runFuzz(caps, steps),
          describeStep,
        );
      },
      120_000,
    );
  });
}

// ---------- fuzz ----------

type EditOp =
  | { readonly op: 'keyValue'; readonly key: number }
  | { readonly op: 'keyTime'; readonly key: number; readonly t: number }
  | { readonly op: 'insertKey'; readonly curve: number; readonly t: number }
  | { readonly op: 'deleteKey'; readonly key: number }
  | { readonly op: 'rename'; readonly control: number }
  | { readonly op: 'reparent'; readonly control: number; readonly parent: number | null }
  | { readonly op: 'curveStatic'; readonly curve: number }
  | { readonly op: 'toggleCurve'; readonly curve: number }
  | { readonly op: 'newCurve'; readonly control: number; readonly channel: ChannelId }
  | { readonly op: 'drag'; readonly key: number; readonly commit: boolean }
  | { readonly op: 'moveKey'; readonly key: number };

type Step =
  | { readonly kind: 'edit'; readonly peer: number; readonly edit: EditOp }
  | { readonly kind: 'undo' | 'redo'; readonly peer: number }
  | { readonly kind: 'deliver' }
  | { readonly kind: 'cut'; readonly a: number; readonly b: number }
  | { readonly kind: 'heal' }
  | { readonly kind: 'link'; readonly delayTicks: number; readonly dropRate: number; readonly reorder: boolean };

const TIMES = [0, 5, 10, 15, 20, 25];

function randomStep(rng: Rng, peers: number): Step {
  const roll = rng.int(100);
  const peer = rng.int(peers);
  if (roll < 45) return { kind: 'edit', peer, edit: randomEdit(rng) };
  if (roll < 55) return { kind: 'undo', peer };
  if (roll < 60) return { kind: 'redo', peer };
  if (roll < 85) return { kind: 'deliver' };
  if (roll < 90) return { kind: 'cut', a: rng.int(peers), b: rng.int(peers) };
  if (roll < 94) return { kind: 'heal' };
  return { kind: 'link', delayTicks: rng.int(3), dropRate: rng.pick([0, 0, 0.2, 0.4]), reorder: rng.bool() };
}

function randomEdit(rng: Rng): EditOp {
  const index = rng.int(64);
  switch (rng.int(11)) {
    case 0:
      return { op: 'keyValue', key: index };
    case 1:
      return { op: 'keyTime', key: index, t: rng.pick(TIMES) };
    case 2:
      return { op: 'insertKey', curve: index, t: rng.pick(TIMES) };
    case 3:
      return { op: 'deleteKey', key: index };
    case 4:
      return { op: 'rename', control: index };
    case 5:
      return { op: 'reparent', control: index, parent: rng.bool(0.2) ? null : rng.int(64) };
    case 6:
      return { op: 'curveStatic', curve: index };
    case 7:
      return { op: 'toggleCurve', curve: index };
    case 8:
      return { op: 'newCurve', control: index, channel: rng.pick(['rx', 'ry', 'rz'] as const) };
    case 9:
      return { op: 'moveKey', key: index };
    default:
      return { op: 'drag', key: index, commit: rng.bool(0.7) };
  }
}

function describeStep(step: Step): string {
  return JSON.stringify(step);
}

const nth = <T>(items: readonly T[], index: number): T | undefined =>
  items.length === 0 ? undefined : items[index % items.length];

/** A second clip of the scene's character, so keys can move between clip partitions. */
interface OtherClip {
  readonly clip: ClipId;
  readonly curve: CurveId;
}

async function addOtherClip(n: Net): Promise<OtherClip> {
  const { scene } = n;
  const clip = newId('clip', scene.ids);
  const layer = newId('layer', scene.ids);
  const curve = newId('curve', scene.ids);
  peerAt(n, 0).transact({ label: 'Second clip' }, (tx) => {
    tx.put(
      'clips',
      makeClip({ id: clip, character: scene.character, name: 'other', fps: { num: 30, den: 1 }, order: 'a1' }),
    );
    tx.put('layers', makeLayer({ id: layer, clip }));
    tx.put('curves', makeCurve({ id: curve, clip, layer, control: scene.controls[0], channel: 'rx' }));
  });
  n.net.settle();
  for (const peer of n.peers) await peer.open(`clip:${clip}`);
  return { clip, curve };
}

async function runFuzz(caps: ConformanceCaps, steps: readonly Step[]): Promise<void> {
  const n = await seededNetwork(caps, 3, 7);
  const { scene } = n;
  const other = await addOtherClip(n);
  let uid = 0;
  const violations: string[] = [];
  const trackers = n.peers.map((peer, index) => new WriterTracker(peer, index === 0));
  const disposers = n.peers.map((peer, index) =>
    peer.subscribe((batch) => {
      const tracker = trackers[index] as WriterTracker;
      if (batch.origin === 'undo' || batch.origin === 'redo') {
        for (const problem of tracker.foreignOverwrites(batch))
          violations.push(`replica ${index} ${batch.origin}: ${problem}`);
      }
      tracker.record(batch);
    }),
  );

  for (const step of steps) {
    switch (step.kind) {
      case 'edit':
        applyEdit(peerAt(n, step.peer), scene, other, step.edit, () => ++uid);
        break;
      case 'undo':
        peerAt(n, step.peer).undo.undo();
        break;
      case 'redo':
        peerAt(n, step.peer).undo.redo();
        break;
      case 'deliver':
        n.net.deliver();
        break;
      case 'cut':
        n.net.partition(step.a, step.b);
        break;
      case 'heal':
        n.net.heal();
        break;
      case 'link':
        n.net.setLink({ delayTicks: step.delayTicks, dropRate: step.dropRate, reorder: step.reorder });
        break;
    }
    check(violations.length === 0, violations.join('\n'));
  }
  n.net.settle();
  for (const dispose of disposers) dispose();
  assertConverged(n.peers, 'fuzz');
}

/**
 * Per replica: who last wrote each merge unit as this replica sees it (`self` for its local/undo/redo batches, `other`
 * for remote ones) and the values this replica wrote into the unit or acted upon (the `before` of its own edits).
 * Record-merge tables are one unit per record ('*'); field-merge tables one unit per top-level field.
 * Compare-before-restore is value-based (§4.11.0 rule 4: undo expects the entry's `after`, redo its `before`), so an
 * undo or redo may overwrite a unit another user wrote last only when that user wrote back exactly such a value
 * (A→B→A); overwriting any other value of another user is a violation.
 */
class WriterTracker {
  private readonly writers = new Map<string, 'self' | 'other'>();
  /** Values this replica wrote into a unit or saw there when it edited it. */
  private readonly ownValues = new Map<string, Set<string>>();

  constructor(store: DocumentStore, wroteSeed: boolean) {
    const tables = store.snapshot().tables as unknown as Readonly<
      Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
    >;
    for (const [table, rows] of Object.entries(tables)) {
      for (const record of Object.values(rows)) {
        this.mark(
          table,
          String(record['id']),
          unitsOf(table, record, undefined, undefined),
          record,
          wroteSeed ? 'self' : 'other',
        );
      }
    }
  }

  /** Units an undo/redo batch overwrote although another user wrote a value this replica never wrote. */
  foreignOverwrites(batch: ChangeBatch): string[] {
    const problems: string[] = [];
    for (const change of batch.changes) {
      const before = change.before as Readonly<Record<string, unknown>> | undefined;
      if (before === undefined) continue; // a re-insert overwrites nothing
      const after = change.after as Readonly<Record<string, unknown>> | undefined;
      for (const unit of unitsOf(change.table, before, after, change.fields)) {
        const key = `${change.table}/${String(change.id)}/${unit}`;
        if (this.writers.get(key) === 'self') continue;
        if (this.ownValues.get(key)?.has(stableText(unitValue(before, unit))) === true) continue;
        problems.push(`${change.table}/${String(change.id)} unit '${unit}' holds another user's value`);
      }
    }
    return problems;
  }

  record(batch: ChangeBatch): void {
    if (batch.origin === 'preview' || batch.origin === 'load') return;
    const writer = batch.origin === 'remote' ? 'other' : 'self';
    for (const change of batch.changes) {
      const before = change.before as Readonly<Record<string, unknown>> | undefined;
      const after = change.after as Readonly<Record<string, unknown>> | undefined;
      const units = unitsOf(change.table, before, after, change.fields);
      this.mark(change.table, String(change.id), units, after, writer);
      if (batch.origin === 'local' && before !== undefined)
        this.remember(change.table, String(change.id), units, before);
    }
  }

  private remember(
    table: string,
    id: string,
    units: readonly string[],
    record: Readonly<Record<string, unknown>>,
  ): void {
    for (const unit of units) {
      const key = `${table}/${id}/${unit}`;
      let values = this.ownValues.get(key);
      if (values === undefined) {
        values = new Set();
        this.ownValues.set(key, values);
      }
      values.add(stableText(unitValue(record, unit)));
    }
  }

  private mark(
    table: string,
    id: string,
    units: readonly string[],
    record: Readonly<Record<string, unknown>> | undefined,
    writer: 'self' | 'other',
  ): void {
    for (const unit of units) {
      const key = `${table}/${id}/${unit}`;
      this.writers.set(key, writer);
    }
    if (writer === 'self' && record !== undefined) this.remember(table, id, units, record);
  }
}

function unitValue(record: Readonly<Record<string, unknown>>, unit: string): unknown {
  return unit === '*' ? record : record[unit];
}

/** JSON with sorted object keys (materialized records may list fields in any order). */
function stableText(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${stableText(record[key])}`)
    .join(',')}}`;
}

/** Merge units a change touches: '*' for record-merge tables, else the changed fields (all fields for insert/delete). */
function unitsOf(
  table: string,
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined,
  fields: readonly string[] | undefined,
): string[] {
  if (mergeUnitOf(table) === 'record') return ['*'];
  if (before !== undefined && after !== undefined && fields !== undefined) return [...fields];
  return Object.keys(after ?? before ?? {}).filter((field) => field !== 'id');
}

function applyEdit(store: ReplicatingStore, scene: Scene, other: OtherClip, edit: EditOp, nextUid: () => number): void {
  const keys = store.list('keys');
  const curves = store.list('curves');
  const controls = store.list('controls');
  switch (edit.op) {
    case 'keyValue':
    case 'keyTime':
    case 'drag': {
      const key = nth(keys, edit.key);
      if (key === undefined) return;
      const v = 1000 + nextUid();
      const fields = edit.op === 'keyTime' ? { t: edit.t, v } : { v };
      if (edit.op === 'drag') {
        const preview = store.beginPreview('Drag');
        preview.update((tx) => tx.patch('keys', key.id, { v: -v }));
        preview.update((tx) => tx.patch('keys', key.id, fields));
        if (edit.commit) preview.commit();
        else preview.cancel();
        return;
      }
      store.transact({ label: 'Key' }, (tx) => tx.patch('keys', key.id, fields));
      return;
    }
    case 'insertKey': {
      const curve = nth(curves, edit.curve);
      if (curve === undefined) return;
      const v = 1000 + nextUid();
      store.transact({ label: 'Insert key' }, (tx) =>
        tx.put('keys', makeKey({ id: newId('key', scene.ids), clip: curve.clip, curve: curve.id, t: edit.t, v })),
      );
      return;
    }
    case 'moveKey': {
      // Changes the key's clip: the record moves from one clip partition to the other.
      const key = nth(keys, edit.key);
      if (key === undefined) return;
      const target = key.clip === scene.clip ? other : { clip: scene.clip, curve: scene.curve };
      const v = 1000 + nextUid();
      store.transact({ label: 'Move key' }, (tx) =>
        tx.patch('keys', key.id, { clip: target.clip, curve: target.curve, v }),
      );
      return;
    }
    case 'deleteKey': {
      const key = nth(keys, edit.key);
      if (key !== undefined) store.transact({ label: 'Delete key' }, (tx) => tx.remove('keys', key.id));
      return;
    }
    case 'rename': {
      const control = nth(controls, edit.control);
      if (control === undefined) return;
      const name = `n${nextUid()}`;
      store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', control.id, { name }));
      return;
    }
    case 'reparent': {
      const control = nth(controls, edit.control);
      if (control === undefined) return;
      const parent = edit.parent === null ? null : (nth(controls, edit.parent)?.id ?? null);
      if (parent === control.id) return;
      store.transact({ label: 'Reparent' }, (tx) => tx.patch('controls', control.id, { parent }));
      return;
    }
    case 'curveStatic': {
      const curve = nth(curves, edit.curve);
      if (curve === undefined) return;
      const staticValue = nextUid();
      store.transact({ label: 'Static value' }, (tx) => tx.patch('curves', curve.id, { staticValue }));
      return;
    }
    case 'toggleCurve': {
      const all = store.list('curves');
      const curve = nth(all, edit.curve);
      if (curve !== undefined) {
        store.transact({ label: 'Delete curve' }, (tx) => tx.softDelete('curves', curve.id));
      } else {
        const deleted = readRaw(store, 'curves', scene.curve);
        if (deleted !== undefined && deleted.deleted !== null) {
          store.transact({ label: 'Restore curve' }, (tx) => tx.restore('curves', deleted.id));
        }
      }
      return;
    }
    case 'newCurve': {
      const control = nth(controls, edit.control);
      if (control === undefined) return;
      const curve = makeCurve({
        id: newId('curve', scene.ids),
        clip: scene.clip,
        layer: scene.layer,
        control: control.id,
        channel: edit.channel,
      });
      store.transact({ label: 'New curve' }, (tx) => tx.put('curves', curve));
      return;
    }
  }
}
