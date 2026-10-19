// `editMeshFrom` / `emptyMesh` (M6A-SPEC §4.3): the edit form of a stored mesh. Copies the stored arrays and layers
// into a `KernelMesh` and derives the canonical edit links in O(V + E + C): disk cycles in ascending edge order,
// radial cycles in ascending corner order, `cornerFace`/`cornerPrev` from the face cycles and `cornerEdge` by walking
// the disk cycle of the corner's vertex (no hashing). Data that breaks the stored-form invariants (§5.1 1–4) throws
// `EkzaError('invalid-mesh')`; float problems (invariant 7) are `validateMesh`'s to report.
import { kernelError } from '../kernel';
import { allocLayer, checkLayerDef, domainCount } from '../layers/arrays';
import type { EditMesh, MeshData } from '../types';
import { KernelMesh } from './mesh';

function invalid(message: string): never {
  throw kernelError('invalid-mesh', `editMeshFrom: ${message}`);
}

/** Builds edit links (disk, radial, loop cycles). ≤ 40 ms at 50k triangles incl. caches (budget §5.27). */
export function editMeshFrom(data: MeshData): EditMesh {
  return kernelMeshFrom(data);
}

export function emptyMesh(): EditMesh {
  return new KernelMesh([0, 0, 0, 0]);
}

export function kernelMeshFrom(data: MeshData): KernelMesh {
  if (typeof data !== 'object' || data === null || typeof data.counts !== 'object' || data.counts === null) {
    invalid('expected a MeshData');
  }
  const { points: P, edges: E, faces: F, corners: C } = data.counts;
  if (![P, E, F, C].every((n) => Number.isSafeInteger(n) && n >= 0)) invalid('counts must be non-negative integers');
  const expect = (name: string, actual: number, wanted: number): void => {
    if (actual !== wanted) invalid(`${name} has ${actual} values, expected ${wanted}`);
  };
  expect('position', data.position.length, 3 * P);
  expect('edgeVerts', data.edgeVerts.length, 2 * E);
  expect('edgeFlags', data.edgeFlags.length, E);
  expect('cornerVert', data.cornerVert.length, C);
  expect('cornerNext', data.cornerNext.length, C);
  expect('faceCorner', data.faceCorner.length, F);
  expect('faceMaterial', data.faceMaterial.length, F);
  expect('faceFlags', data.faceFlags.length, F);
  for (const [name, layer] of data.layers) {
    if (name !== layer.def.name) invalid(`layer key ${name} names layer ${layer.def.name}`);
    expect(`layer ${name}`, layer.data.length, domainCount(data.counts, layer.def.domain) * layer.def.comps);
  }

  const m = new KernelMesh([P, E, F, C]);
  m.cnt.set([P, E, F, C]);
  m.pos.set(data.position);
  m.ev.set(data.edgeVerts);
  m.ef.set(data.edgeFlags);
  m.cv.set(data.cornerVert);
  m.cn.set(data.cornerNext);
  m.fc.set(data.faceCorner);
  m.fm.set(data.faceMaterial);
  m.ff.set(data.faceFlags);
  let at = 0;
  for (const layer of data.layers.values()) {
    try {
      checkLayerDef(layer.def);
    } catch (error) {
      invalid((error as Error).message);
    }
    const copy = allocLayer(layer.def.type, layer.data.length);
    copy.set(layer.data);
    m.attachLayer(layer.def, at++, copy);
  }

  const { ev, cv, cn, fc, ve, dn, ec, cp, ce, cf, cr } = m;
  // Disk cycles, ascending edge order.
  const lastDisk = new Int32Array(P).fill(-1);
  for (let e = 0; e < E; e++) {
    const a = ev[2 * e] as number;
    const b = ev[2 * e + 1] as number;
    if (a >= P || b >= P) invalid(`edge ${e} has an endpoint out of range`);
    if (a === b) invalid(`edge ${e} is a loop`);
    for (let end = 0; end < 2; end++) {
      const v = ev[2 * e + end] as number;
      const last = lastDisk[v] as number;
      if (last === -1) ve[v] = e;
      else dn[2 * last + ((ev[2 * last] as number) === v ? 0 : 1)] = e;
      lastDisk[v] = e;
    }
  }
  for (let v = 0; v < P; v++) {
    const last = lastDisk[v] as number;
    if (last !== -1) dn[2 * last + ((ev[2 * last] as number) === v ? 0 : 1)] = ve[v] as number;
  }
  // At most one edge per vertex pair (a stamp per neighbour).
  const stamp = new Int32Array(P).fill(-1);
  for (let v = 0; v < P; v++) {
    const start = ve[v] as number;
    if (start === -1) continue;
    let e = start;
    do {
      const end = (ev[2 * e] as number) === v ? 0 : 1;
      const other = ev[2 * e + 1 - end] as number;
      if ((stamp[other] as number) === v) invalid(`two edges join vertices ${v} and ${other}`);
      stamp[other] = v;
      e = dn[2 * e + end] as number;
    } while (e !== start);
  }
  // Face cycles.
  for (let f = 0; f < F; f++) {
    const start = fc[f] as number;
    if (start >= C) invalid(`face ${f} starts at corner ${start} ≥ ${C}`);
    let c = start;
    let steps = 0;
    do {
      if ((cf[c] as number) !== -1) invalid(`corner ${c} is in two faces`);
      if ((cv[c] as number) >= P) invalid(`corner ${c} vertex out of range`);
      cf[c] = f;
      const next = cn[c] as number;
      if (next >= C) invalid(`corner ${c} next out of range`);
      cp[next] = c;
      c = next;
      if (++steps > C) invalid(`face ${f} does not close`);
    } while (c !== start);
    if (steps < 3) invalid(`face ${f} has ${steps} corners`);
  }
  for (let c = 0; c < C; c++) if ((cf[c] as number) === -1) invalid(`corner ${c} is in no face`);
  // Corner edges and radial cycles (ascending corner order).
  const lastRadial = new Int32Array(E).fill(-1);
  for (let c = 0; c < C; c++) {
    const a = cv[c] as number;
    const b = cv[cn[c] as number] as number;
    if (a === b) invalid(`corner ${c} and its next share vertex ${a}`);
    let e = ve[a] as number;
    let found = -1;
    if (e !== -1) {
      const start = e;
      do {
        const end = (ev[2 * e] as number) === a ? 0 : 1;
        if ((ev[2 * e + 1 - end] as number) === b) {
          found = e;
          break;
        }
        e = dn[2 * e + end] as number;
      } while (e !== start);
    }
    if (found === -1) invalid(`no edge between corner ${c} and its next`);
    ce[c] = found;
    const last = lastRadial[found] as number;
    if (last === -1) ec[found] = c;
    else cr[last] = c;
    lastRadial[found] = c;
  }
  for (let e = 0; e < E; e++) {
    const last = lastRadial[e] as number;
    if (last !== -1) cr[last] = ec[e] as number;
  }
  return m;
}
