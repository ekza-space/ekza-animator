// Face-attribute identity for the B4 tests: `decorateFaces` gives every face its own `paint` slot (the face's identity),
// a material and distinct `uv0` values on every corner; `faceAttributes` records them and `attributeProblems` says how
// an op broke them. Classes of op:
// - 'identity' (normals, Reverse, Conform, Apply Transform, Average, Slide, Symmetrize, Flip on quads): the same faces,
//   so the multiset of (material, paint) is unchanged and each corner keeps its face's value at its vertex;
// - 'spin' (Spin Edge, Flip Triangle Edge): as 'identity', but a face's one new vertex takes the other face's value;
// - 'split' (Triangulate, Multi-Cut): every face is a piece of one original face, every original face keeps a piece,
//   and a corner on an original vertex keeps its face's value there;
// - 'join' (Quadrangulate): every face carries one original face's material and paint, every corner on an original
//   vertex a value some corner had there;
// - 'copy' (Mirror): every face carries an original face's material and paint.
// No Node APIs: shared by the Node and the Chromium runs.
import { BUILTIN_LAYERS, type EditMesh } from '../../src';
import { faceCorners } from '../../src/subset/support';

export type AttributeClass = 'identity' | 'spin' | 'split' | 'join' | 'copy';

/** Paint slot f + 1, material f mod 7 and uv0 = (corner + 1, face + 1) on every face (one logged transaction). */
export function decorateFaces(m: EditMesh): void {
  m.begin('decorate');
  const paint = m.layer('paint') ?? m.addLayer(BUILTIN_LAYERS.paint);
  const uv = m.layer('uv0') ?? m.addLayer(BUILTIN_LAYERS.uv0);
  for (let f = 0; f < m.counts.faces; f++) {
    paint.set(f, 0, f + 1);
    if (m.faceMaterial(f) !== f % 7) m.setFaceMaterial(f, f % 7);
    for (const c of faceCorners(m, f)) {
      uv.set(c, 0, c + 1);
      uv.set(c, 1, f + 1);
    }
  }
  m.end();
}

interface FaceAttributes {
  readonly material: number;
  /** Vertex → the uv0 keys of the face's corners on it. */
  readonly corners: ReadonlyMap<number, readonly string[]>;
}

export interface RecordedAttributes {
  /** Paint slot → the face's attributes (the first face, if two share a slot). */
  readonly faces: ReadonlyMap<number, FaceAttributes>;
  /** The sorted "material/paint" keys of every face. */
  readonly pairs: readonly string[];
  /** Vertex → every uv0 key on it. */
  readonly atVertex: ReadonlyMap<number, ReadonlySet<string>>;
  readonly points: number;
}

function uvKey(m: EditMesh, c: number): string {
  const uv = m.layer('uv0');
  return uv === undefined ? '' : `${uv.get(c, 0)},${uv.get(c, 1)}`;
}

function paintOf(m: EditMesh, f: number): number {
  return m.layer('paint')?.get(f, 0) ?? 0;
}

export function faceAttributes(m: EditMesh): RecordedAttributes {
  const faces = new Map<number, FaceAttributes>();
  const pairs: string[] = [];
  const atVertex = new Map<number, Set<string>>();
  for (let f = 0; f < m.counts.faces; f++) {
    const corners = new Map<number, string[]>();
    for (const c of faceCorners(m, f)) {
      const v = m.cornerVert(c);
      const key = uvKey(m, c);
      corners.set(v, [...(corners.get(v) ?? []), key]);
      atVertex.set(v, (atVertex.get(v) ?? new Set()).add(key));
    }
    const paint = paintOf(m, f);
    if (!faces.has(paint)) faces.set(paint, { material: m.faceMaterial(f), corners });
    pairs.push(`${m.faceMaterial(f)}/${paint}`);
  }
  return { faces, pairs: pairs.sort(), atVertex, points: m.counts.points };
}

/** What `m` (after one op of class `cls`) breaks of the attributes recorded before it; empty when nothing. */
export function attributeProblems(before: RecordedAttributes, m: EditMesh, cls: AttributeClass): string[] {
  const out: string[] = [];
  const after = faceAttributes(m);
  const beforeSet = new Set(before.pairs);
  const afterSet = new Set(after.pairs);
  if (cls === 'identity' || cls === 'spin') {
    if (after.pairs.join(' ') !== before.pairs.join(' ')) {
      out.push(`(material/paint) multiset ${before.pairs.join(' ')} → ${after.pairs.join(' ')}`);
    }
  } else {
    for (const pair of afterSet) if (!beforeSet.has(pair)) out.push(`new (material/paint) ${pair}`);
    if (cls === 'split') for (const pair of beforeSet) if (!afterSet.has(pair)) out.push(`lost ${pair}`);
  }
  if (cls === 'copy') return out;
  for (let f = 0; f < m.counts.faces; f++) {
    const own = before.faces.get(paintOf(m, f));
    if (own === undefined) continue; // reported above as a new pair
    for (const c of faceCorners(m, f)) {
      const v = m.cornerVert(c);
      if (v >= before.points) continue; // a new vertex interpolates
      const key = uvKey(m, c);
      const mine = own.corners.get(v);
      const fine =
        cls === 'join' || (cls === 'spin' && mine === undefined)
          ? before.atVertex.get(v)?.has(key) === true
          : mine?.includes(key) === true;
      if (!fine) out.push(`face ${f} (paint ${paintOf(m, f)}): corner ${c} at vertex ${v} has uv ${key}`);
    }
  }
  return out;
}
