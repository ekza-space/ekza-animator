// P6 (M6A-SPEC §5.29): the values both runtimes must agree on — manifest ids of every primitive with both default
// sets, digests of their triangulation and normals, and the manifest after fixed Euler scripts (fast-check samples
// with fixed seeds are the same in every engine). Shared by the Node test (which keeps the golden file) and the
// Chromium test (which compares against it); no Node APIs here.
import { sha256Hex } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import {
  computeNormals,
  editMeshFrom,
  DCC_PRIMITIVE_DEFAULTS,
  type MeshData,
  primitive,
  triangulate,
  writeRevision,
} from '../../src';
import { arbEulerStep, resolveEulerStep, rounded } from '../../src/testing';

const KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;

const digest = (values: ArrayLike<number>): string =>
  sha256Hex(new TextEncoder().encode(JSON.stringify(Array.from(values))));

/** Runs a fixed Euler script (seeded sample) on `start`; refused steps are skipped. Returns the final revision id. */
function script(start: MeshData, seed: number, steps: number): string {
  const m = editMeshFrom(start);
  const [list] = fc.sample(fc.array(arbEulerStep(), { minLength: steps, maxLength: steps }), { numRuns: 1, seed });
  for (const step of list ?? []) {
    const resolved = resolveEulerStep(m, step);
    if (resolved === null) continue;
    m.begin(resolved.label);
    try {
      resolved.run();
      m.end();
    } catch {
      m.abort();
    }
  }
  return writeRevision(m).manifestId;
}

export function determinismValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kind of KINDS) {
    for (const [set, params] of [
      ['low-poly', {}],
      ['dcc', DCC_PRIMITIVE_DEFAULTS[kind] as Record<string, number>],
    ] as const) {
      const data = primitive(kind, params);
      const normals = computeNormals(data);
      out[`${kind}/${set}/manifest`] = writeRevision(data).manifestId;
      out[`${kind}/${set}/tris`] = digest(triangulate(data).tris);
      // Normals are floats: the digest covers their exact float32 bits.
      out[`${kind}/${set}/normals`] = digest(new Uint32Array(normals.corner.buffer));
      out[`${kind}/${set}/normals-rounded`] = digest(rounded(normals.face));
    }
  }
  out['script/cube/1'] = script(primitive('cube', { subdivisionsWidth: 2 }), 1, 300);
  out['script/cylinder/2'] = script(primitive('cylinder', { subdivisionsCaps: 2 }), 2, 300);
  out['script/torus/3'] = script(primitive('torus', {}), 3, 200);
  return out;
}
