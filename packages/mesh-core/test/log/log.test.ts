// M6A-SPEC §4.3 write log and `MeshDelta` (B1; ADR 0014 §5): copy-on-write snapshots for giant edits, layer events
// inside one transaction, journals of deltas undone in reverse, deltas applied to a rebuilt mesh, the apply guards,
// retained bytes, the dirty set and the counts/position views.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  type EditMesh,
  editMeshFrom,
  type MeshData,
  type MeshDelta,
  morphLayer,
  primitive,
  readRevision,
  validateMesh,
  writeRevision,
} from '../../src';
import { diffStored, linkArray } from '../../src/testing';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

interface Writes {
  readonly segments: readonly { readonly slots: readonly unknown[]; readonly snaps: readonly unknown[] }[];
}
const writesOf = (delta: MeshDelta): Writes => delta.writes as Writes;

function exactUndoRedo(m: EditMesh, delta: MeshDelta, before: ReturnType<EditMesh['snapshot']>): void {
  const after = m.snapshot();
  const links = linkArray(m);
  m.apply(delta, 'backward');
  expect(diffStored(m, before)).toBeNull();
  expect(linkArray(m)).toEqual(linkArray(editMeshFrom(before)));
  m.apply(delta, 'forward');
  expect(diffStored(m, after)).toBeNull();
  expect(linkArray(m)).toEqual(links);
}

describe('copy-on-write snapshots (> a quarter of an array)', () => {
  it('a whole-mesh position edit switches to a snapshot and still undoes exactly', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 99, subdivisionsHeight: 99 })); // 10,000 points
    const before = m.snapshot();
    m.begin('lift');
    for (let v = 0; v < m.counts.points; v++) {
      const p = m.position;
      m.setPosition(v, p[3 * v] as number, (p[3 * v] as number) * 0.5, p[3 * v + 2] as number);
    }
    const delta = m.end();
    const segments = writesOf(delta).segments;
    expect(segments.reduce((n, s) => n + s.snaps.length, 0)).toBe(1);
    expect(delta.bytes).toBeGreaterThanOrEqual(2 * 12 * 10_000);
    expect(delta.bytes).toBeLessThan(4 * 12 * 10_000);
    expect((delta.dirty.points as Uint32Array).length).toBeGreaterThan(9000);
    exactUndoRedo(m, delta, before);
  });

  it('a small edit logs slots, not snapshots', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 99, subdivisionsHeight: 99 }));
    m.begin('nudge');
    m.setPosition(5, 1, 2, 3);
    const delta = m.end();
    expect(writesOf(delta).segments.every((s) => s.snaps.length === 0)).toBe(true);
    expect(delta.bytes).toBeLessThan(1024);
  });

  it('a giant topology edit (kill every other face) undoes exactly through snapshots', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 30, subdivisionsHeight: 30 }));
    const before = m.snapshot();
    m.begin('holes');
    for (let f = m.counts.faces - 1; f >= 0; f -= 2) m.killFace(f);
    const delta = m.end();
    expect(writesOf(delta).segments.some((s) => s.snaps.length > 0)).toBe(true);
    expect(validateMesh(m)).toEqual([]);
    exactUndoRedo(m, delta, before);
  });
});

describe('layer events inside one transaction', () => {
  it('add, write, remove and re-add a layer with another definition; abort and undo restore exactly', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const before = m.snapshot();
    const run = (): MeshDelta => {
      m.begin('layers');
      m.addLayer(morphLayer('X')).set(0, 0, 1);
      m.removeLayer('morph:X');
      m.addLayer({ ...BUILTIN_LAYERS.crease, name: 'morph:X', domain: 'edge' }).set(3, 0, 2);
      m.removeLayer('paint');
      m.layer('uv0')?.set(0, 0, 0.75);
      return m.end();
    };
    const delta = run();
    expect(m.layer('paint')).toBeUndefined();
    expect(m.layer('morph:X')?.def.domain).toBe('edge');
    expect(delta.dirty.layers).toEqual(['morph:X', 'paint', 'uv0']);
    expect(delta.dirty.points).toBe('all');
    expect(delta.dirty.edges).toBe('all');
    expect(delta.dirty.faces).toBe('all');
    expect(writesOf(delta).segments.length).toBe(5);
    exactUndoRedo(m, delta, before);
    m.apply(delta, 'backward');
    m.begin('again');
    m.addLayer(morphLayer('X')).set(0, 0, 1);
    m.removeLayer('paint');
    m.abort();
    expect(diffStored(m, before)).toBeNull();
    expect(m.layer('paint')?.def).toEqual(BUILTIN_LAYERS.paint);
  });

  it('a stale layer handle refuses writes after its layer is removed', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const paint = m.layer('paint');
    m.begin('drop');
    m.removeLayer('paint');
    expect(code(() => paint?.set(0, 0, 1))).toBe('invalid-layer');
    m.abort();
    expect(m.layer('paint')).not.toBe(paint);
    m.begin('write');
    m.layer('paint')?.set(0, 0, 1);
    m.end();
    expect(m.layer('paint')?.get(0)).toBe(1);
  });

  it('refuses reserved and malformed layer definitions', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('bad');
    expect(code(() => m.addLayer({ ...BUILTIN_LAYERS.crease, name: '$position' }))).toBe('invalid-layer');
    expect(code(() => m.addLayer({ ...BUILTIN_LAYERS.crease, name: 'x', comps: 5 as never }))).toBe('invalid-layer');
    expect(code(() => m.addLayer({ ...BUILTIN_LAYERS.crease, name: 'x', default: [] }))).toBe('invalid-layer');
    m.abort();
  });
});

describe('journals and apply', () => {
  it('a journal of deltas undoes in reverse order and redoes forward (exact, with topology)', () => {
    const m = editMeshFrom(primitive('cylinder', {}));
    const states = [m.snapshot()];
    const deltas: MeshDelta[] = [];
    const ops: ((mesh: EditMesh) => void)[] = [
      (x) => x.splitEdgeMakeVert(0, 0.3),
      (x) => x.killFace(2),
      (x) => x.makeFace([0, 5, 9]),
      (x) => x.setPosition(1, 0, 3, 0),
      (x) => x.reverseFace(0),
    ];
    for (const op of ops) {
      m.begin('journal');
      op(m);
      deltas.push(m.end());
      states.push(m.snapshot());
    }
    for (let i = deltas.length - 1; i >= 0; i--) {
      m.apply(deltas[i] as MeshDelta, 'backward');
      expect(diffStored(m, states[i] as ReturnType<EditMesh['snapshot']>)).toBeNull();
    }
    for (let i = 0; i < deltas.length; i++) {
      m.apply(deltas[i] as MeshDelta, 'forward');
      expect(diffStored(m, states[i + 1] as ReturnType<EditMesh['snapshot']>)).toBeNull();
    }
    expect(linkArray(m)).toEqual(linkArray(editMeshFrom(m.snapshot())));
  });

  it('a delta applies to another kernel mesh in the same state (a rebuilt runtime)', () => {
    const a = editMeshFrom(primitive('cube', {}));
    a.begin('split');
    a.splitEdgeMakeVert(3, 0.5);
    a.addLayer(morphLayer('Y')).set(8, 1, 0.25);
    const delta = a.end();
    const b = editMeshFrom(primitive('cube', {}));
    b.apply(delta, 'forward');
    expect(diffStored(b, a)).toBeNull();
    expect(linkArray(b)).toEqual(linkArray(a));
    const c = editMeshFrom(a.snapshot());
    c.apply(delta, 'backward');
    expect(diffStored(c, primitive('cube', {}))).toBeNull();
  });

  /** A runtime rebuilt from the stored state (what reopening component mode does, §5.5 rules 4 and 8). */
  function rebuilt(m: EditMesh): EditMesh {
    const revision = writeRevision(m);
    return editMeshFrom(readRevision(revision.manifest, (id) => revision.newChunks.get(id) as Uint8Array));
  }

  /** Undo on a rebuilt runtime, then redo on another one rebuilt from the before-state: both exact. */
  function crossRuntime(before: MeshData, after: EditMesh, delta: MeshDelta): void {
    const back = rebuilt(after);
    back.apply(delta, 'backward');
    expect(diffStored(back, before)).toBeNull();
    expect(validateMesh(back)).toEqual([]);
    expect(linkArray(back)).toEqual(linkArray(editMeshFrom(before)));
    const again = editMeshFrom(before);
    again.apply(delta, 'forward');
    expect(diffStored(again, after)).toBeNull();
    expect(linkArray(again)).toEqual(linkArray(after));
  }

  it('removals undo on a runtime rebuilt from the after-state (the vacated slots are in the delta)', () => {
    const cases: [string, (m: EditMesh) => void][] = [
      ['killFace 0', (m) => m.killFace(0)],
      ['killFace 5', (m) => m.killFace(5)],
      ['killVert 3', (m) => m.killVert(3)],
      ['killEdge 7', (m) => m.killEdge(7)],
      ['joinFace 0', (m) => m.joinFaceKillEdge(0)],
      [
        'split, then join',
        (m) => {
          const v = m.splitEdgeMakeVert(2, 0.25);
          m.joinEdgeKillVert(v);
        },
      ],
      [
        'kill every face, then every vertex',
        (m) => {
          for (let f = m.counts.faces - 1; f >= 0; f--) m.killFace(f);
          for (let v = m.counts.points - 1; v >= 0; v--) m.killVert(v);
        },
      ],
    ];
    for (const [label, op] of cases) {
      const m = editMeshFrom(primitive('cube', {}));
      m.begin('prep');
      m.addLayer(morphLayer('Z')).set(3, 1, 0.5);
      m.end();
      const before = m.snapshot();
      m.begin(label);
      op(m);
      const delta = m.end();
      expect({ label, problems: validateMesh(m) }).toEqual({ label, problems: [] });
      crossRuntime(before, m, delta);
    }
  });

  it('a slot emptied, refilled and emptied again across a layer event undoes and aborts exactly', () => {
    const run = (m: EditMesh): void => {
      m.killFace(5);
      m.addLayer(BUILTIN_LAYERS.color0);
      const f = m.makeFace([0, 2, 4]);
      m.killFace(f);
    };
    const m = editMeshFrom(primitive('cube', {}));
    const before = m.snapshot();
    const links = linkArray(m);
    m.begin('abort');
    run(m);
    m.abort();
    expect(diffStored(m, before)).toBeNull();
    expect(linkArray(m)).toEqual(links);
    expect(validateMesh(m)).toEqual([]);
    m.begin('undo');
    run(m);
    const delta = m.end();
    m.apply(delta, 'backward');
    expect(diffStored(m, before)).toBeNull();
    expect(linkArray(m)).toEqual(links);
    expect(validateMesh(m)).toEqual([]);
    m.apply(delta, 'forward');
    crossRuntime(before, m, delta);
    // The shrunk sequence the property found: killVert, addLayer, makeVert, killVert.
    const n = editMeshFrom(primitive('cube', {}));
    const start = n.snapshot();
    n.begin('shrunk');
    n.killVert(7);
    n.addLayer(BUILTIN_LAYERS.color0);
    n.killVert(n.makeVert(1, 2, 3));
    n.abort();
    expect(diffStored(n, start)).toBeNull();
    expect(validateMesh(n)).toEqual([]);
  });

  it('guards: inside a transaction, a foreign delta, a mesh in another state', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('one');
    m.makeVert(0, 0, 0);
    const delta = m.end();
    m.begin('open');
    expect(code(() => m.apply(delta, 'backward'))).toBe('mesh-transaction-open');
    m.abort();
    expect(code(() => m.apply({ ...delta, writes: { kind: 'other' } }, 'backward'))).toBe('invalid-delta');
    expect(code(() => m.apply(delta, 'forward'))).toBe('invalid-delta'); // counts are the after state already
    m.apply(delta, 'backward');
    expect(code(() => m.apply(delta, 'backward'))).toBe('invalid-delta');
  });

  it('a transaction whose writes cancel out has no slots and no dirty elements', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const [x, y, z] = Array.from(m.position.slice(0, 3)) as [number, number, number];
    m.begin('noop');
    const v = m.makeVert(1, 2, 3);
    m.killVert(v);
    m.setPosition(0, 5, 5, 5);
    m.setPosition(0, x, y, z);
    const delta = m.end();
    expect(writesOf(delta).segments.every((s) => s.slots.length === 0 && s.snaps.length === 0)).toBe(true);
    expect(delta.dirty.points).toEqual(new Uint32Array(0));
    expect(delta.dirty.topology).toBe(false);
    expect(delta.remap.point).toEqual({ forward: null, createdFrom: 8 });
  });

  it('a refused Euler operator writes nothing', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('refused');
    expect(code(() => m.joinEdgeKillVert(0))).toBe('mesh-euler');
    const delta = m.end();
    expect(writesOf(delta).segments.every((s) => s.slots.length === 0)).toBe(true);
  });
});

describe('views', () => {
  it('counts and position are stable objects until a count or the capacity changes', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const counts = m.counts;
    const position = m.position;
    expect(m.counts).toBe(counts);
    expect(m.position).toBe(position);
    expect(position.length).toBe(24);
    m.begin('grow');
    for (let i = 0; i < 40; i++) m.makeVert(i, 0, 0);
    m.end();
    expect(m.counts).not.toBe(counts);
    expect(m.counts.points).toBe(48);
    expect(m.position.length).toBe(144);
    expect(m.layer('uv0')?.data.length).toBe(48);
    expect(Object.isFrozen(m.counts)).toBe(true);
  });

  it('layer reads outside the live range answer NaN', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(m.layer('paint')?.get(6)).toBeNaN();
    expect(m.layer('paint')?.get(0, 1)).toBeNaN();
    expect(m.cornerVert(24)).toBe(-1);
    expect(m.edgeVert(-1, 0)).toBe(-1);
    expect(m.faceLen(6)).toBe(0);
  });
});
