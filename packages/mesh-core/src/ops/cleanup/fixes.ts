// The `mesh.cleanup` fixes (M6A-SPEC §5.25): explicit, undoable topology edits over the elements Mesh Check reports.
// Each fix composes the Euler operators (§5.1: valid topology or nothing) and keeps the §5.2 layer rules:
// - deleteLamina: kills every face of a lamina group but the one with the smallest index;
// - collapse: a zero-area face without a zero-length edge (a cap: its corners on one line) joins the face across its
//   longest edge, which takes its corners (nothing moves; the neighbour keeps its material and face layers); then the
//   endpoints of zero-length edges (and the shortest edge of a cap that could not join) merge into their centroid
//   (point layers averaged, each face keeps its own corners, merged edges OR their flags (H3)); faces left with fewer
//   than three distinct corners disappear (a needle's collapse removes it), then the edges and vertices they leave
//   unused (§5.1 orphan cleanup);
// - conform: reverses faces so every edge-connected component winds one way — outward (positive volume) for a closed
//   component, the majority's way otherwise (ties: the way of its smallest face);
// - triangulate: splits the flagged n-gons along the one triangulation's diagonals (H1 hardness from the split);
// - dissolve: joins the two edges of each stray vertex (H3);
// - deleteLoose: kills wire edges, then vertices without edges.
import { BitSet } from '../../bitset';
import { EkzaError } from '@ekza-animator/anim-core';
import { copyEdgeAttributes, mergePointAttributes } from '../../layers/propagate';
import { triangulate } from '../../triangulate/triangulate';
import type { EditMesh, HiddenSet } from '../../types';
import { CornerValues, FaceValues } from '../bevel/attributes';

function cornersOf(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return out;
}

const isEuler = (error: unknown): boolean => error instanceof EkzaError && error.code === 'mesh-euler';

/** Kills the faces (any order of input); returns how many. */
export function deleteFaces(m: EditMesh, faces: readonly number[]): number {
  const list = [...new Set(faces)].sort((a, b) => b - a);
  for (const f of list) m.killFace(f);
  return list.length;
}

/** Union-find groups over the vertex pairs/sets (each a list), smallest index first; singletons dropped. */
export function vertexGroups(points: number, sets: readonly (readonly number[])[]): number[][] {
  const parent = new Int32Array(points);
  for (let i = 0; i < points; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while ((parent[r] as number) !== r) r = parent[r] as number;
    let y = x;
    while ((parent[y] as number) !== r) {
      const next = parent[y] as number;
      parent[y] = r;
      y = next;
    }
    return r;
  };
  for (const set of sets) {
    for (let i = 1; i < set.length; i++) {
      const a = find(set[0] as number);
      const b = find(set[i] as number);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (const set of sets) {
    for (const v of set) {
      const r = find(v);
      const group = groups.get(r) ?? [];
      if (!group.includes(v)) group.push(v);
      groups.set(r, group);
    }
  }
  return [...groups.values()]
    .map((group) => group.sort((a, b) => a - b))
    .filter((group) => group.length > 1)
    .sort((a, b) => (a[0] as number) - (b[0] as number));
}

/**
 * Merges each vertex group into its smallest vertex at the group's centroid (§5.2 merging row: point layers averaged,
 * each face keeps its own corners, merged edges OR their flags). Returns the surviving vertices (indices after the
 * merge) and whether a non-manifold edge appeared.
 */
export function mergeGroups(
  m: EditMesh,
  groups: readonly (readonly number[])[],
  track: readonly number[] = [],
): { survivors: number[]; tracked: number[]; nonManifold: boolean } {
  const P = m.counts.points;
  const rep = new Int32Array(P);
  for (let i = 0; i < P; i++) rep[i] = i;
  for (const group of groups) for (const v of group) rep[v] = group[0] as number;
  const nonManifoldBefore = countNonManifold(m);
  // Survivors: centroid position, averaged point layers.
  const p = m.position;
  for (const group of groups) {
    const s = group[0] as number;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const v of group) {
      x += (p[3 * v] as number) / group.length;
      y += (p[3 * v + 1] as number) / group.length;
      z += (p[3 * v + 2] as number) / group.length;
    }
    mergePointAttributes(m, group, s, 'average');
    m.setPosition(s, x, y, z);
  }
  // Edge sources by their merged vertex pair: OR of flags (H3), the first source's layers.
  const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const sources = new Map<string, { flags: number; first: number }>();
  const wire: [number, number][] = [];
  const affected = new Set<number>();
  for (let e = 0; e < m.counts.edges; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const ra = rep[a] as number;
    const rb = rep[b] as number;
    if (ra === a && rb === b) {
      // Untouched edge: still a source for a pair other edges merge into.
      const key = pairKey(a, b);
      if (!sources.has(key)) sources.set(key, { flags: m.edgeFlags(e), first: e });
      else (sources.get(key) as { flags: number }).flags |= m.edgeFlags(e);
      continue;
    }
    if (ra === rb) continue;
    const key = pairKey(ra, rb);
    const known = sources.get(key);
    if (known === undefined) sources.set(key, { flags: m.edgeFlags(e), first: e });
    else known.flags |= m.edgeFlags(e);
    if (m.edgeFaceCount(e) === 0) wire.push([ra, rb]);
  }
  for (let f = 0; f < m.counts.faces; f++) {
    for (const c of cornersOf(m, f)) {
      const v = m.cornerVert(c);
      if ((rep[v] as number) !== v) {
        affected.add(f);
        break;
      }
    }
  }
  // Edges and vertices in use before the merge (indices stay put until the kills below): the ones the merge leaves
  // unused go with it (§5.1 orphan cleanup); loose geometry that was already there stays for deleteLoose.
  const hadFaces = new BitSet(m.counts.edges);
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) > 0) hadFaces.add(e);
  const hadEdges = new BitSet(P);
  for (let v = 0; v < P; v++) if (m.vertEdge(v) !== -1) hadEdges.add(v);
  const cv = new CornerValues(m);
  const fv = new FaceValues(m);
  const rebuilt: { verts: number[]; records: Float64Array[]; face: Float64Array; material: number; flags: number }[] =
    [];
  const faces = [...affected].sort((a, b) => a - b);
  for (const f of faces) {
    const verts: number[] = [];
    const records: Float64Array[] = [];
    for (const c of cornersOf(m, f)) {
      const v = rep[m.cornerVert(c)] as number;
      if (verts.length > 0 && verts[verts.length - 1] === v) continue;
      verts.push(v);
      records.push(cv.capture(c));
    }
    while (verts.length > 1 && verts[0] === verts[verts.length - 1]) {
      verts.pop();
      records.pop();
    }
    if (new Set(verts).size < 3) continue;
    rebuilt.push({ verts, records, face: fv.capture(f), material: m.faceMaterial(f), flags: m.faceFlags(f) });
  }
  for (let i = faces.length - 1; i >= 0; i--) m.killFace(faces[i] as number);
  const edgesBefore = m.counts.edges;
  for (const face of rebuilt) {
    const f = m.makeFace(face.verts, { material: face.material });
    fv.write(f, face.face);
    if (face.flags !== 0) m.setFaceFlags(f, face.flags);
    let c = m.faceCorner(f);
    for (const record of face.records) {
      cv.write(c, record);
      c = m.cornerNext(c);
    }
  }
  for (const [a, b] of wire) m.makeEdge(a, b);
  for (const [key, source] of [...sources].sort((x, y) => x[1].first - y[1].first)) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    const e = m.findEdge(a, b);
    if (e === -1) continue;
    if (e >= edgesBefore) copyEdgeAttributes(m, source.first, e);
    if (m.edgeFlags(e) !== (source.flags & 0xff)) m.setEdgeFlags(e, source.flags & 0xff);
  }
  // Orphans: edges between survivors that had faces and have none now (a wire edge the merge re-made stays), then
  // survivors that had edges and keep none. The merged vertices go with their edges (killVert).
  const merged = (v: number): boolean => (rep[v] as number) !== v;
  const wirePairs = new Set(wire.map(([a, b]) => pairKey(a, b)));
  const orphanEdges: number[] = [];
  for (let e = 0; e < edgesBefore; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    if (!hadFaces.has(e) || m.edgeFaceCount(e) > 0 || merged(a) || merged(b) || wirePairs.has(pairKey(a, b))) continue;
    orphanEdges.push(e);
  }
  for (let i = orphanEdges.length - 1; i >= 0; i--) m.killEdge(orphanEdges[i] as number);
  const doomed: number[] = [];
  for (let v = 0; v < P; v++) {
    if (merged(v)) {
      doomed.push(v);
      continue;
    }
    if (!hadEdges.has(v)) continue;
    let used = false;
    const start = m.vertEdge(v);
    if (start !== -1) {
      let e = start;
      let guard = 0;
      do {
        if (!merged(m.edgeOther(e, v))) used = true;
        e = m.edgeDiskNext(e, v);
      } while (!used && e !== start && ++guard <= m.counts.edges);
    }
    if (!used) doomed.push(v);
  }
  for (let i = doomed.length - 1; i >= 0; i--) m.killVert(doomed[i] as number);
  // Survivor indices after the kills. No vertex was created in this transaction, so each removal (descending) moves
  // the last vertex into the hole (the kernel's removal rule, M6A-B1-2).
  const where = new Int32Array(P);
  const holder = new Int32Array(P);
  for (let v = 0; v < P; v++) {
    where[v] = v;
    holder[v] = v;
  }
  let count = P;
  for (let i = doomed.length - 1; i >= 0; i--) {
    const v = doomed[i] as number;
    const last = --count;
    if (last !== v) {
      const moved = holder[last] as number;
      holder[v] = moved;
      where[moved] = v;
    }
  }
  const gone = new Set(doomed);
  return {
    survivors: groups
      .map((group) => group[0] as number)
      .filter((v) => !gone.has(v))
      .map((v) => where[v] as number)
      .sort((a, b) => a - b),
    tracked: track
      .map((v) => rep[v] as number)
      .filter((v) => !gone.has(v))
      .map((v) => where[v] as number),
    nonManifold: countNonManifold(m) > nonManifoldBefore,
  };
}

/** A zero-area face found before the collapse, by its vertices (stable while faces and edges are rebuilt). */
export interface Cap {
  /** The face's vertices, sorted. */
  readonly key: string;
  /** The endpoints of its longest edge (the one it joins across). */
  readonly long: readonly [number, number];
  /** The endpoints of its shortest edge (merged when the join is not possible). */
  readonly short: readonly [number, number];
  /** Its vertices off the longest edge (they end up on the neighbour's side). */
  readonly inner: readonly number[];
}

function lengthOf(m: EditMesh, a: number, b: number): number {
  const p = m.position;
  return Math.hypot(
    (p[3 * b] as number) - (p[3 * a] as number),
    (p[3 * b + 1] as number) - (p[3 * a + 1] as number),
    (p[3 * b + 2] as number) - (p[3 * a + 2] as number),
  );
}

/** The cap record of face f (its longest and shortest edges; ties to the earlier corner). */
export function capOf(m: EditMesh, f: number): Cap {
  const corners = cornersOf(m, f);
  const verts = corners.map((c) => m.cornerVert(c));
  let long = 0;
  let short = 0;
  let longest = -1;
  let shortest = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const length = lengthOf(m, verts[i] as number, verts[(i + 1) % verts.length] as number);
    if (length > longest) {
      longest = length;
      long = i;
    }
    if (length < shortest) {
      shortest = length;
      short = i;
    }
  }
  const a = verts[long] as number;
  const b = verts[(long + 1) % verts.length] as number;
  return {
    key: [...verts].sort((x, y) => x - y).join(','),
    long: [a, b],
    short: [verts[short] as number, verts[(short + 1) % verts.length] as number],
    inner: verts.filter((v) => v !== a && v !== b),
  };
}

/**
 * Joins each cap with the face across its longest edge (the neighbour's material, flags and face layers kept).
 * Returns the vertex pairs of the caps that could not join (their shortest edges) and how many joined.
 */
export function joinCaps(m: EditMesh, caps: readonly Cap[]): { failed: [number, number][]; joined: number } {
  const fv = new FaceValues(m);
  const failed: [number, number][] = [];
  let joined = 0;
  const keyOf = (f: number): string =>
    cornersOf(m, f)
      .map((c) => m.cornerVert(c))
      .sort((x, y) => x - y)
      .join(',');
  for (const cap of caps) {
    const e = m.findEdge(cap.long[0], cap.long[1]);
    const faces: number[] = [];
    if (e !== -1) {
      const start = m.edgeCorner(e);
      let c = start;
      do {
        faces.push(m.cornerFace(c));
        c = m.cornerRadialNext(c);
      } while (c !== start);
    }
    const self = faces.find((f) => keyOf(f) === cap.key);
    if (self === undefined) continue; // already merged into another face
    const other = faces.length === 2 ? faces.find((f) => f !== self) : undefined;
    if (other === undefined) {
      failed.push([cap.short[0], cap.short[1]]);
      continue;
    }
    const record = fv.capture(other);
    const material = m.faceMaterial(other);
    const flags = m.faceFlags(other);
    try {
      m.joinFaceKillEdge(e);
    } catch (error) {
      if (!isEuler(error)) throw error;
      failed.push([cap.short[0], cap.short[1]]);
      continue;
    }
    const survivor = Math.min(self, other);
    fv.write(survivor, record);
    if (m.faceMaterial(survivor) !== material) m.setFaceMaterial(survivor, material);
    if (m.faceFlags(survivor) !== flags) m.setFaceFlags(survivor, flags);
    joined++;
  }
  return { failed, joined };
}

function countNonManifold(m: EditMesh): number {
  let n = 0;
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) > 2) n++;
  return n;
}

/** Reverses faces so each component winds one way (see the header); returns the reversed faces. */
export function conformWinding(m: EditMesh, hidden: HiddenSet | null): number[] {
  const F = m.counts.faces;
  const visible = (f: number): boolean => hidden === null || !hidden.faces.has(f);
  const orientation = new Int8Array(F).fill(-1);
  const reversed: number[] = [];
  const p = m.position;
  for (let seed = 0; seed < F; seed++) {
    if (!visible(seed) || (orientation[seed] as number) !== -1) continue;
    const component: number[] = [seed];
    orientation[seed] = 0;
    let closed = true;
    for (let i = 0; i < component.length; i++) {
      const f = component[i] as number;
      for (const c of cornersOf(m, f)) {
        const e = m.cornerEdge(c);
        const n = m.edgeFaceCount(e);
        if (n !== 2) {
          closed = false;
          continue;
        }
        const r = m.cornerRadialNext(c);
        const g = m.cornerFace(r);
        if (g === f || !visible(g)) {
          closed = false;
          continue;
        }
        // Same direction on the shared edge: g winds the other way from f.
        const same = m.cornerVert(r) === m.cornerVert(c);
        const want = same ? 1 - (orientation[f] as number) : (orientation[f] as number);
        if ((orientation[g] as number) === -1) {
          orientation[g] = want;
          component.push(g);
        }
      }
    }
    component.sort((a, b) => a - b);
    let flipped = 0;
    for (const f of component) flipped += orientation[f] as number;
    let flipOnes: boolean;
    if (closed) {
      // Signed volume of the component as the seed winds (faces with orientation 1 counted reversed).
      let volume = 0;
      for (const f of component) {
        const corners = cornersOf(m, f);
        const sign = (orientation[f] as number) === 1 ? -1 : 1;
        const a = m.cornerVert(corners[0] as number);
        for (let i = 1; i + 1 < corners.length; i++) {
          const b = m.cornerVert(corners[i] as number);
          const d = m.cornerVert(corners[i + 1] as number);
          const ax = p[3 * a] as number;
          const ay = p[3 * a + 1] as number;
          const az = p[3 * a + 2] as number;
          const bx = p[3 * b] as number;
          const by = p[3 * b + 1] as number;
          const bz = p[3 * b + 2] as number;
          const dx = p[3 * d] as number;
          const dy = p[3 * d + 1] as number;
          const dz = p[3 * d + 2] as number;
          volume += (sign * (ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx))) / 6;
        }
      }
      flipOnes = volume > 0 ? true : volume < 0 ? false : flipped * 2 <= component.length;
    } else flipOnes = flipped * 2 <= component.length;
    for (const f of component) {
      const o = orientation[f] as number;
      if ((o === 1) === flipOnes) reversed.push(f);
    }
  }
  reversed.sort((a, b) => a - b);
  for (const f of reversed) m.reverseFace(f);
  return reversed;
}

/** Splits each face along the one triangulation's diagonals; returns the faces created and the split faces. */
export function triangulateFaces(m: EditMesh, faces: readonly number[]): number[] {
  const tri = triangulate(m);
  const out: number[] = [];
  for (const f of [...new Set(faces)].sort((a, b) => a - b)) {
    const corners = cornersOf(m, f);
    if (corners.length <= 3) continue;
    const verts = corners.map((c) => m.cornerVert(c));
    if (new Set(verts).size !== verts.length) continue; // a face through a vertex twice: left as it is
    const position = new Map<number, number>();
    corners.forEach((c, i) => position.set(c, i));
    const diagonals: [number, number][] = [];
    const n = corners.length;
    for (let t = tri.faceTriStart[f] as number; t < (tri.faceTriStart[f + 1] as number); t++) {
      for (let k = 0; k < 3; k++) {
        const i = position.get(tri.tris[3 * t + k] as number) as number;
        const j = position.get(tri.tris[3 * t + ((k + 1) % 3)] as number) as number;
        const gap = (j - i + n) % n;
        if (gap === 1 || gap === n - 1) continue;
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        if (!diagonals.some(([x, y]) => x === a && y === b)) diagonals.push([a, b]);
      }
    }
    const pieces = [f];
    for (const [i, j] of diagonals) {
      const va = verts[i] as number;
      const vb = verts[j] as number;
      for (const piece of pieces) {
        const list = cornersOf(m, piece);
        const ca = list.find((c) => m.cornerVert(c) === va);
        const cb = list.find((c) => m.cornerVert(c) === vb);
        if (ca === undefined || cb === undefined) continue;
        if (m.cornerNext(ca) === cb || m.cornerNext(cb) === ca) break;
        try {
          m.splitFaceMakeEdge(piece, ca, cb);
          pieces.push(m.counts.faces - 1);
        } catch (error) {
          if (!isEuler(error)) throw error;
        }
        break;
      }
    }
    out.push(...pieces);
  }
  return out.sort((a, b) => a - b);
}

/** Dissolves stray vertices (joins their two edges); returns how many. */
export function dissolveVertices(m: EditMesh, verts: readonly number[]): number {
  let n = 0;
  for (const v of [...new Set(verts)].sort((a, b) => b - a)) {
    if (m.vertValence(v) !== 2) continue;
    try {
      m.joinEdgeKillVert(v);
      n++;
    } catch (error) {
      if (!isEuler(error)) throw error;
    }
  }
  return n;
}

/** Kills wire edges, then vertices left without edges (loose); returns how many elements went. */
export function deleteLoose(
  m: EditMesh,
  verts: readonly number[],
  edges: readonly number[],
  hidden: HiddenSet | null,
): number {
  const ends = new BitSet(m.counts.points);
  for (const v of verts) ends.add(v);
  let n = 0;
  for (const e of [...new Set(edges)].sort((a, b) => b - a)) {
    ends.add(m.edgeVert(e, 0));
    ends.add(m.edgeVert(e, 1));
    m.killEdge(e);
    n++;
  }
  const doomed: number[] = [];
  ends.forEach((v) => {
    if (v < m.counts.points && m.vertEdge(v) === -1 && (hidden === null || !hidden.verts.has(v))) doomed.push(v);
  });
  for (let i = doomed.length - 1; i >= 0; i--) m.killVert(doomed[i] as number);
  return n + doomed.length;
}
