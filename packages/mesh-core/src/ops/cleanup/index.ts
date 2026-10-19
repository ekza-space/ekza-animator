// Kernel op of `ops/cleanup/` (M6A-SPEC §5.25, §6.1; owner B5): `mesh.cleanup {fix, selectOnly}` over the whole mesh.
// It runs Mesh Check on the visible elements and either selects what a fix would touch (`fix: 'select'` — every
// problem — or `selectOnly`, the default) or applies the fix (./fixes.ts) as one undoable op:
//
// | fix | codes | the edit | selection′ |
// |---|---|---|---|
// | select | every code | none | every problem element |
// | deleteLamina | lamina | kills the duplicate faces | none |
// | collapse | zero-length-edge, zero-area-face | joins caps across their longest edge, merges the rest into centroids | the merged vertices and the caps' inner vertices |
// | conform | inconsistent-winding | reverses the minority (or inward) faces of each component | the reversed faces |
// | triangulate | nonplanar-ngon, concave-ngon | splits the n-gons along the one triangulation | the triangles |
// | dissolve | stray-vertex | joins the two edges of each stray vertex | none |
// | deleteLoose | loose-geometry | kills wire edges and vertices without edges | none |
//
// Warnings: `cleanup.found` (selecting, with the element count), `cleanup.fixed` (with the count), `cleanup.clean`
// (nothing to do), `cleanup.non-manifold` (a collapse made an edge with more than two faces).
import { coerceArgs, type ParamValues } from '@ekza-animator/anim-core';
import { BitSet } from '../../bitset';
import { checkMesh } from '../../check';
import type {
  CheckCode,
  ComponentKind,
  ComponentSelection,
  EditMesh,
  MeshOp,
  MeshProblem,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
} from '../../types';
import { CLEANUP } from './descriptor';
import {
  type Cap,
  capOf,
  conformWinding,
  deleteFaces,
  joinCaps,
  deleteLoose,
  dissolveVertices,
  mergeGroups,
  triangulateFaces,
  vertexGroups,
} from './fixes';

export type CleanupFix =
  | 'select'
  | 'deleteLamina'
  | 'collapse'
  | 'conform'
  | 'triangulate'
  | 'dissolve'
  | 'deleteLoose';

/** The Mesh Check codes each fix handles (§5.25). */
export const FIX_CODES: Readonly<Record<CleanupFix, readonly CheckCode[] | 'all'>> = {
  select: 'all',
  deleteLamina: ['lamina'],
  collapse: ['zero-length-edge', 'zero-area-face'],
  conform: ['inconsistent-winding'],
  triangulate: ['nonplanar-ngon', 'concave-ngon'],
  dissolve: ['stray-vertex'],
  deleteLoose: ['loose-geometry'],
};

const KIND_OF: Readonly<Record<string, ComponentKind>> = { point: 'vertex', edge: 'edge', face: 'face' };

/** A selection of the problems' elements (every kind filled; `kind` = the first problem's domain, else face). */
export function selectionOfProblems(m: EditMesh, problems: readonly MeshProblem[]): ComponentSelection {
  const verts = new BitSet(m.counts.points);
  const edges = new BitSet(m.counts.edges);
  const faces = new BitSet(m.counts.faces);
  let kind: ComponentKind | null = null;
  for (const problem of problems) {
    const target = problem.domain === 'point' ? verts : problem.domain === 'edge' ? edges : faces;
    for (const i of problem.elements ?? []) if (i < target.size) target.add(i);
    kind ??= KIND_OF[problem.domain ?? 'face'] ?? null;
  }
  return { kind: kind ?? 'face', verts, edges, faces, order: null, active: -1 };
}

function emptySelection(m: EditMesh, kind: ComponentKind): ComponentSelection {
  const { points, edges, faces } = m.counts;
  return {
    kind,
    verts: new BitSet(points),
    edges: new BitSet(edges),
    faces: new BitSet(faces),
    order: null,
    active: -1,
  };
}

function elementsOf(problems: readonly MeshProblem[], code: CheckCode, domain?: string): number[] {
  const out: number[] = [];
  for (const problem of problems) {
    if (problem.code !== code || (domain !== undefined && problem.domain !== domain)) continue;
    out.push(...(problem.elements ?? []));
  }
  return out;
}

function count(problems: readonly MeshProblem[]): number {
  let n = 0;
  for (const problem of problems) n += problem.elements?.length ?? 0;
  return n;
}

export function runCleanup(
  m: EditMesh,
  _sel: ComponentSelection | null,
  raw: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const { args } = coerceArgs(CLEANUP.params, raw);
  const fix = args['fix'] as CleanupFix;
  const selectOnly = args['selectOnly'] as boolean;
  const codes = FIX_CODES[fix];
  const problems = checkMesh(m, { hidden: ctx.hidden }).filter(
    (problem) => codes === 'all' || codes.includes(problem.code as CheckCode),
  );
  const resolvedArgs = Object.freeze({ ...args });
  const warnings: OpWarning[] = [];
  const total = count(problems);
  if (total === 0) {
    warnings.push({ code: 'cleanup.clean', message: 'Nothing to clean up' });
    return { selection: emptySelection(m, 'face'), warnings, resolvedArgs };
  }
  if (fix === 'select' || selectOnly) {
    warnings.push({ code: 'cleanup.found', message: `${total} element${total === 1 ? '' : 's'} found`, count: total });
    return { selection: selectionOfProblems(m, problems), warnings, resolvedArgs };
  }
  let selection: ComponentSelection;
  let fixed: number;
  switch (fix) {
    case 'deleteLamina':
      fixed = deleteFaces(m, elementsOf(problems, 'lamina'));
      selection = emptySelection(m, 'face');
      break;
    case 'collapse': {
      // Caps (zero-area faces without a zero-length edge) join across their longest edge first; needles and the
      // zero-length edges then merge (vertex indices do not change until the merge).
      const short = new Set(elementsOf(problems, 'zero-length-edge'));
      const pairs: [number, number][] = [...short].map((e) => [m.edgeVert(e, 0), m.edgeVert(e, 1)]);
      const caps: Cap[] = [];
      for (const f of elementsOf(problems, 'zero-area-face')) {
        let needle = false;
        const start = m.faceCorner(f);
        let c = start;
        do {
          if (short.has(m.cornerEdge(c))) needle = true;
          c = m.cornerNext(c);
        } while (c !== start);
        if (!needle) caps.push(capOf(m, f));
      }
      const { failed, joined } = joinCaps(m, caps);
      pairs.push(...failed);
      const groups = vertexGroups(m.counts.points, pairs);
      const inner = caps.flatMap((cap) => cap.inner);
      const { survivors, tracked, nonManifold } = mergeGroups(m, groups, inner);
      if (nonManifold) {
        warnings.push({ code: 'cleanup.non-manifold', message: 'Collapsing made an edge with more than two faces' });
      }
      fixed = joined + groups.reduce((n, group) => n + group.length - 1, 0);
      const verts = new BitSet(m.counts.points);
      for (const v of [...survivors, ...tracked]) verts.add(v);
      selection = { ...emptySelection(m, 'vertex'), verts };
      break;
    }
    case 'conform': {
      const reversed = conformWinding(m, ctx.hidden);
      fixed = reversed.length;
      const faces = new BitSet(m.counts.faces);
      for (const f of reversed) faces.add(f);
      selection = { ...emptySelection(m, 'face'), faces };
      break;
    }
    case 'triangulate': {
      const targets = [...elementsOf(problems, 'nonplanar-ngon'), ...elementsOf(problems, 'concave-ngon')];
      const pieces = triangulateFaces(m, targets);
      fixed = new Set(targets).size;
      const faces = new BitSet(m.counts.faces);
      for (const f of pieces) faces.add(f);
      selection = { ...emptySelection(m, 'face'), faces };
      break;
    }
    case 'dissolve':
      fixed = dissolveVertices(m, elementsOf(problems, 'stray-vertex'));
      selection = emptySelection(m, 'vertex');
      break;
    case 'deleteLoose':
      fixed = deleteLoose(
        m,
        elementsOf(problems, 'loose-geometry', 'point'),
        elementsOf(problems, 'loose-geometry', 'edge'),
        ctx.hidden,
      );
      selection = emptySelection(m, 'vertex');
      break;
    default:
      fixed = 0;
      selection = emptySelection(m, 'face');
  }
  warnings.push({
    code: fixed > 0 ? 'cleanup.fixed' : 'cleanup.clean',
    message: fixed > 0 ? `${fixed} element${fixed === 1 ? '' : 's'} fixed` : 'Nothing to clean up',
    count: fixed,
  });
  return { selection, warnings, resolvedArgs };
}

export const cleanup: MeshOp = Object.freeze({
  ...CLEANUP,
  poll: () => true as const,
  run: runCleanup,
});
