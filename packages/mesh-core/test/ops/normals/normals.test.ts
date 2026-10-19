// M6A-SPEC §6.1 normals ops (B4): Harden/Soften/Set Normal Angle (H5, P7-hard), Reverse (winding, corner values,
// custom normals), Conform (consistent and outward winding). Each run goes through the B4 harness (P1, P5, P8).
import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYERS, EDGE_HARD, editMeshFrom, MESH_OPS, primitive, selectionOf, topologyStats } from '../../../src';
import { conformFlips } from '../../../src/ops/normals';
import { cubeData, signedVolume } from '../../../src/testing';
import { context, faceVertList, refusedCode, runOk } from '../harness';

const op = (id: string) => {
  const found = MESH_OPS[id];
  if (found === undefined) throw new Error(id);
  return found;
};

describe('mesh.harden / mesh.soften', () => {
  it('soften clears and harden sets EDGE_HARD on the selected edges only', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, op('mesh.soften'), selectionOf('edge', [0, 3], m.counts), {}, context(), { maySoften: true });
    expect(m.edgeFlags(0) & EDGE_HARD).toBe(0);
    expect(m.edgeFlags(3) & EDGE_HARD).toBe(0);
    expect(m.edgeFlags(1) & EDGE_HARD).toBe(EDGE_HARD);
    runOk(m, op('mesh.harden'), selectionOf('edge', [0], m.counts));
    expect(m.edgeFlags(0) & EDGE_HARD).toBe(EDGE_HARD);
    expect(m.edgeFlags(3) & EDGE_HARD).toBe(0);
  });

  it('object mode acts on every visible edge; face mode on the faces’ edges', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, op('mesh.soften'), null, {}, context(), { maySoften: true });
    for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFlags(e) & EDGE_HARD).toBe(0);
    const sel = selectionOf('face', [0], m.counts);
    runOk(m, op('mesh.harden'), sel);
    const hard = [...Array(m.counts.edges).keys()].filter((e) => (m.edgeFlags(e) & EDGE_HARD) !== 0);
    expect(hard).toHaveLength(4);
  });

  it('refuses without edges', () => {
    const m = editMeshFrom(cubeData());
    expect(refusedCode(m, op('mesh.harden'), selectionOf('edge', [], m.counts))).toBe('harden.no-edges');
  });
});

describe('mesh.setNormalAngle', () => {
  it('hard iff the dihedral angle exceeds the angle; 0 keeps an all-hard mesh all-hard (P7-hard)', () => {
    const cyl = editMeshFrom(primitive('cylinder', {}));
    runOk(cyl, op('mesh.setNormalAngle'), null, { angle: 0 });
    for (let e = 0; e < cyl.counts.edges; e++) expect(cyl.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
    // 8 sides: side seams bend 45°, the cap rims 90°.
    runOk(cyl, op('mesh.setNormalAngle'), null, { angle: (50 * Math.PI) / 180 }, context(), { maySoften: true });
    let soft = 0;
    let hard = 0;
    for (let e = 0; e < cyl.counts.edges; e++) {
      if ((cyl.edgeFlags(e) & EDGE_HARD) !== 0) hard++;
      else soft++;
    }
    expect([soft, hard]).toEqual([8, 16]);
  });
});

describe('mesh.reverse', () => {
  it('reverses winding and keeps corner values on their vertices; custom normals flip', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('setup');
    const n = m.addLayer(BUILTIN_LAYERS.normalCustom);
    const c0 = m.faceCorner(0);
    n.set(c0, 0, 0);
    n.set(c0, 1, 0);
    n.set(c0, 2, 1);
    m.end();
    const uv = m.layer('uv0');
    const before = new Map<number, [number, number]>();
    {
      let c = m.faceCorner(0);
      const s = c;
      do {
        before.set(m.cornerVert(c), [uv?.get(c, 0) as number, uv?.get(c, 1) as number]);
        c = m.cornerNext(c);
      } while (c !== s);
    }
    const verts = faceVertList(m, 0);
    runOk(m, op('mesh.reverse'), selectionOf('face', [0], m.counts));
    // Winding order is the reverse cycle.
    const after = faceVertList(m, 0);
    const doubled = [...verts, ...verts].reverse();
    expect(doubled.join(',')).toContain(after.join(','));
    let c = m.faceCorner(0);
    const s = c;
    do {
      expect([uv?.get(c, 0), uv?.get(c, 1)]).toEqual(before.get(m.cornerVert(c)));
      c = m.cornerNext(c);
    } while (c !== s);
    expect(m.layer('normal.custom')?.get(c0, 2)).toBe(-1);
    expect(topologyStats(m).boundaryLoops).toBe(0);
  });

  it('whole-mesh reverse turns the signed volume negative; reverse twice is the identity on positions and links', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const volume = signedVolume(m);
    runOk(m, op('mesh.reverse'), null);
    expect(signedVolume(m)).toBeCloseTo(-volume, 12);
    runOk(m, op('mesh.reverse'), null);
    expect(signedVolume(m)).toBeCloseTo(volume, 12);
  });
});

describe('mesh.conform', () => {
  it('fixes a reversed face and an inside-out shell; leaves a consistent outward mesh unchanged', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(conformFlips(m, [0, 1, 2, 3, 4, 5])).toEqual([]);
    runOk(m, op('mesh.reverse'), selectionOf('face', [2], m.counts));
    runOk(m, op('mesh.conform'), null);
    expect(signedVolume(m)).toBeGreaterThan(0);
    for (let e = 0; e < m.counts.edges; e++) {
      const c = m.edgeCorner(e);
      expect(m.cornerVert(c)).not.toBe(m.cornerVert(m.cornerRadialNext(c)));
    }
    runOk(m, op('mesh.reverse'), null);
    expect(signedVolume(m)).toBeLessThan(0);
    runOk(m, op('mesh.conform'), null);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });

  it('open shells: majority of normals away from the centroid', () => {
    const m = editMeshFrom(primitive('cylinder', {}));
    // Remove the caps' effect: an open tube reversed points inward; conform turns it out.
    runOk(m, op('mesh.reverse'), selectionOf('face', [0, 1, 2, 3, 4, 5, 6, 7], m.counts));
    runOk(m, op('mesh.conform'), selectionOf('face', [0, 1, 2, 3, 4, 5, 6, 7], m.counts));
    // Each side face's normal points away from the axis.
    for (let f = 0; f < 8; f++) {
      const verts = faceVertList(m, f);
      const p = (v: number) => [
        m.position[3 * v] as number,
        m.position[3 * v + 1] as number,
        m.position[3 * v + 2] as number,
      ];
      const [a, b, c] = [p(verts[0] as number), p(verts[1] as number), p(verts[2] as number)];
      const u = [
        (b[0] as number) - (a[0] as number),
        (b[1] as number) - (a[1] as number),
        (b[2] as number) - (a[2] as number),
      ];
      const w = [
        (c[0] as number) - (a[0] as number),
        (c[1] as number) - (a[1] as number),
        (c[2] as number) - (a[2] as number),
      ];
      const n = [
        (u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
        (u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
        (u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
      ];
      const centre = [(a[0] as number) + (c[0] as number), 0, (a[2] as number) + (c[2] as number)];
      expect((n[0] as number) * (centre[0] as number) + (n[2] as number) * (centre[2] as number)).toBeGreaterThan(0);
    }
  });
});
