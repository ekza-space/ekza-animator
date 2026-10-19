// M6A-SPEC §5.20, P8 (B1): incremental writes across topology edits — appended elements re-hash only the tail
// chunks, a removal re-hashes the chunks its moves touched, an added layer is written whole — and every incremental
// manifest equals the full write of the same content (canonical tails).
import { describe, expect, it } from 'vitest';
import { editMeshFrom, type MeshDelta, morphLayer, primitive, type RevisionManifest, writeRevision } from '../../src';

const layer = (manifest: RevisionManifest, name: string): RevisionManifest['layers'][number] =>
  manifest.layers.find((entry) => entry.name === name) as RevisionManifest['layers'][number];

describe('incremental revisions with topology edits', () => {
  // 5,041 points: three position chunks of 2,048.
  const base = (): ReturnType<typeof editMeshFrom> =>
    editMeshFrom(primitive('plane', { subdivisionsWidth: 70, subdivisionsHeight: 70 }));

  it('appending a face re-hashes only the tail chunks of each array', () => {
    const m = base();
    const first = writeRevision(m);
    m.begin('append');
    const a = m.makeVert(5, 0, 0);
    const b = m.makeVert(6, 0, 0);
    m.makeFace([0, a, b]);
    const delta = m.end();
    const incremental = writeRevision(m, { previous: first.manifest, dirty: delta.dirty });
    expect(incremental.manifestId).toBe(writeRevision(m).manifestId);
    const before = layer(first.manifest, '$position').chunks;
    const after = layer(incremental.manifest, '$position').chunks;
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).not.toBe(before[2]);
    // Only tail chunks (and none of the reused ones) are new.
    const reused = new Set(after.slice(0, 2));
    expect([...incremental.newChunks.keys()].some((id) => reused.has(id))).toBe(false);
  });

  it('removing an early face re-hashes the chunks the swap-remove touched and matches the full write', () => {
    const m = base();
    const first = writeRevision(m);
    m.begin('remove');
    m.killFace(3);
    const delta = m.end();
    expect(delta.remap.face.forward?.[m.counts.faces]).toBe(3); // the last face moved into the hole
    const incremental = writeRevision(m, { previous: first.manifest, dirty: delta.dirty });
    expect(incremental.manifestId).toBe(writeRevision(m).manifestId);
  });

  it('chains of incremental writes stay equal to full writes; a new layer is written whole', () => {
    const m = base();
    let previous = writeRevision(m);
    const edits: ((x: ReturnType<typeof base>) => void)[] = [
      (x) => x.splitEdgeMakeVert(10, 0.5),
      (x) => x.addLayer(morphLayer('Wave')).set(4000, 1, 0.5),
      (x) => {
        // An interior edge of the plane (two faces): join its faces.
        let e = 0;
        while (x.edgeFaceCount(e) !== 2) e++;
        x.joinFaceKillEdge(e);
      },
      (x) => x.setPosition(5000, 0, 1, 0),
      (x) => x.layer('morph:Wave')?.set(4000, 1, 0),
      (x) => x.removeLayer('uv0'),
    ];
    for (const edit of edits) {
      m.begin('chain');
      edit(m);
      const delta: MeshDelta = m.end();
      const incremental = writeRevision(m, { previous: previous.manifest, dirty: delta.dirty });
      const full = writeRevision(m);
      expect(incremental.manifestId).toBe(full.manifestId);
      previous = full;
    }
    expect(layer(previous.manifest, 'morph:Wave').chunks).toEqual([]); // the zeroed morph is trimmed again
  });

  it('a previous manifest with another layout is ignored (full write)', () => {
    const m = base();
    const first = writeRevision(m);
    const odd: RevisionManifest = {
      ...first.manifest,
      layers: first.manifest.layers.map((entry) =>
        entry.name === '$position' ? { ...entry, chunkElems: 1024 } : entry,
      ),
    };
    m.begin('nudge');
    m.setPosition(0, 1, 1, 1);
    const delta = m.end();
    expect(writeRevision(m, { previous: odd, dirty: delta.dirty }).manifestId).toBe(writeRevision(m).manifestId);
  });
});
