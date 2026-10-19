// `extrudeGroupFrame` (M6A-SPEC §5.8 steps 4 and 7, §5.14; B12b): the frame `mesh.extrude` applies to the group that
// holds the lowest-index picked component, grouped as the kernel groups the symmetry-expanded selection — the own
// frame without symmetry, the source group's frame and the mirror S for a picked partner (the kernel moves it with
// S ∘ T ∘ S), the joint region's frame when the partner joins the picked region. Checked against the kernel's runs.
import { describe, expect, it } from 'vitest';
import { borderChainFrame, type EditMesh, editMeshFrom, extrudeGroupFrame, regionFrame } from '../../src';
import { edgeNear, planeData } from './fixtures';
import { ctxOf, cube, faceCentroid, faceToward, IDENTITY_XF, referenceSymmetryMap, runOk, sel } from './support';

const symmetryOf = (m: EditMesh) => ({ map: referenceSymmetryMap(m, 'x'), preserveSeam: true });
const X_MIRROR = { m: [-1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

const expectVec = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, 6));
};

describe('extrudeGroupFrame (B12b: the extrude session frame)', () => {
  it('without symmetry: the region frame of the region holding the lowest picked face (role own)', () => {
    const m = cube();
    const top = faceToward(m, [0, 1, 0]);
    expect(extrudeGroupFrame(m, 'face', [top])).toEqual({ frame: regionFrame(m, [top]), role: 'own', mirror: null });
    // Two separate faces (top and bottom): the region of the lower index; two adjacent faces: one region.
    const bottom = faceToward(m, [0, -1, 0]);
    expect(extrudeGroupFrame(m, 'face', [top, bottom])?.frame).toEqual(regionFrame(m, [Math.min(top, bottom)]));
    const side = faceToward(m, [1, 0, 0]);
    expect(extrudeGroupFrame(m, 'face', [side, top])?.frame).toEqual(
      regionFrame(
        m,
        [top, side].sort((a, b) => a - b),
      ),
    );
  });

  it("Object X, the cube's −X face picked: the partner, carrying the +X face's frame and S", () => {
    const m = cube();
    const minus = faceToward(m, [-1, 0, 0]);
    const plus = faceToward(m, [1, 0, 0]);
    const found = extrudeGroupFrame(m, 'face', [minus], { symmetry: symmetryOf(m), placement: IDENTITY_XF });
    expect(found?.role).toBe('partner');
    expect(found?.frame).toEqual(regionFrame(m, [plus]));
    expect(found?.mirror).toEqual(X_MIRROR);
    // The +X face is the source: its own frame, no mirror.
    expect(extrudeGroupFrame(m, 'face', [plus], { symmetry: symmetryOf(m) })).toEqual({
      frame: regionFrame(m, [plus]),
      role: 'source',
      mirror: null,
    });
  });

  it('the kernel moves the picked partner cap with S ∘ T ∘ S: identical args, the mirrored offset', () => {
    const m = cube();
    const minus = faceToward(m, [-1, 0, 0]);
    const found = extrudeGroupFrame(m, 'face', [minus], { symmetry: symmetryOf(m) });
    expect(found?.role).toBe('partner');
    const frame = found?.frame;
    if (frame === undefined) throw new Error('no frame');
    const args = { localTranslateX: 0.1, localTranslateY: 0.3, localTranslateZ: 0.2 };
    runOk(m, 'mesh.extrude', sel(m, 'face', [minus]), args, ctxOf({ symmetry: referenceSymmetryMap(m, 'x') }));
    // T moves the source pivot by A·t; the partner cap's centre is the mirror of that.
    const a = frame.axes;
    const moved = [0, 1, 2].map(
      (k) =>
        (frame.pivot[k] as number) + (a[0][k] as number) * 0.1 + (a[1][k] as number) * 0.3 + (a[2][k] as number) * 0.2,
    );
    expectVec(faceCentroid(m, minus), [-(moved[0] as number), moved[1] as number, moved[2] as number]);
  });

  it('a picked face whose partner joins its region: the joint region (role self, frame of both faces)', () => {
    // A 2 × 1 plane split at x = 0: its two faces share the seam edge.
    const m = editMeshFrom(planeData({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    expect(m.counts.faces).toBe(2);
    const both = [0, 1];
    const found = extrudeGroupFrame(m, 'face', [1], { symmetry: symmetryOf(m) });
    expect(found).toEqual({ frame: regionFrame(m, both), role: 'self', mirror: null });
    expectVec(found?.frame.pivot ?? [], [0, 0, 0]);
    // Keep Faces Together off: each face its own region, the picked one a partner or a source.
    const apart = extrudeGroupFrame(m, 'face', [0], { symmetry: symmetryOf(m), keepFacesTogether: false });
    expect(['source', 'partner']).toContain(apart?.role);
  });

  it('border edges: the −X edge of a 2 × 1 plane is the partner of the +X edge (its chain frame and S)', () => {
    const m = editMeshFrom(planeData({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    const minus = edgeNear(m, [-1, 0, -0.5], [-1, 0, 0.5]);
    const plus = edgeNear(m, [1, 0, -0.5], [1, 0, 0.5]);
    const found = extrudeGroupFrame(m, 'edge', [minus], { symmetry: symmetryOf(m) });
    expect(found?.role).toBe('partner');
    expect(found?.frame).toEqual(borderChainFrame(m, [plus]));
    expect(found?.mirror).toEqual(X_MIRROR);
    // Without symmetry it is borderChainFrame's own chain.
    expect(extrudeGroupFrame(m, 'edge', [minus])?.frame).toEqual(borderChainFrame(m, [minus]));
  });

  it('nothing to extrude: no frame (interior edges, out-of-range indices, an empty pick)', () => {
    const m = editMeshFrom(planeData({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    const seam = edgeNear(m, [0, 0, -0.5], [0, 0, 0.5]);
    expect(extrudeGroupFrame(m, 'edge', [seam])).toBeNull();
    expect(extrudeGroupFrame(m, 'face', [99, -1])).toBeNull();
    expect(extrudeGroupFrame(m, 'face', [])).toBeNull();
  });
});
