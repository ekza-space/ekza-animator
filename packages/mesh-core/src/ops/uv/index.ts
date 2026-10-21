// Kernel ops of `ops/uv/` (M6A-SPEC §5.28, §6.1; owner B5): `mesh.uv.planar`, `mesh.uv.box`, `mesh.uv.cylindrical`.
// They write `uv0` on the corners of the selected faces (every visible face in object mode; the layer is added when
// missing), with the projections of ../../uv/project, and set the seams: an edge with two or more faces is EDGE_SEAM
// when its faces belong to different charts, when one of them is outside the run, or when the values differ across
// it (the cylinder's wrap); an edge whose faces are all in one chart with continuous values loses EDGE_SEAM. Border
// edges keep their flags. Positions and topology are untouched (`topology: false`).
//
// `camera` (planar from the camera; recorded as a 'data' arg) is `{ direction: [x, y, z], up: [x, y, z] }`, the pane
// camera's view direction and up in world space; the op maps it into mesh-local space through `ctx.placement`.
// Refusals: `uv.no-faces` (vertex/edge selections or nothing visible), `uv.no-camera` (axis camera without a usable
// camera). Under symmetry the run is the expanded face selection (`symmetry.unmatched-partner` for lonely faces).
import { coerceArgs, type ParamValues } from '@ekza-studio/anim-core';
import { EDGE_SEAM } from '../../constants';
import { BUILTIN_LAYERS } from '../../layers/builtin';
import { refuse } from '../../refusal';
import { selectionOf } from '../../selection';
import type {
  ComponentSelection,
  EditMesh,
  MeshOp,
  MeshOpDescriptor,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
} from '../../types';
import {
  cameraFrame,
  cornersOfFace,
  fitCharts,
  planarFrame,
  type Projection,
  projectBox,
  projectCylindrical,
  projectPlanar,
  type Vec3Like,
} from '../../uv/project';
import { expandForOp, isHidden, unmatchedWarning } from '../bevel/symmetry';
import { UV_BOX, UV_CYLINDRICAL, UV_PLANAR } from './descriptor';

/** The faces a projection writes: the visible selected faces, or every visible face without a selection. */
function runFaces(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): number[] | null {
  const out: number[] = [];
  if (sel === null) {
    for (let f = 0; f < m.counts.faces; f++) if (!isHidden(ctx.hidden, 'face', f)) out.push(f);
    return out;
  }
  if (sel.kind !== 'face') return null;
  sel.faces.forEach((f) => {
    if (f < m.counts.faces && !isHidden(ctx.hidden, 'face', f)) out.push(f);
  });
  return out;
}

function poll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  const faces = runFaces(m, sel, ctx);
  if (faces === null || faces.length === 0)
    return refuse('uv.no-faces', 'Select faces to map (or no selection for the whole mesh)');
  return true;
}

function cameraOf(value: unknown): { readonly direction: Vec3Like; readonly up: Vec3Like } | null {
  if (value === null || typeof value !== 'object') return null;
  const { direction, up } = value as { readonly direction?: unknown; readonly up?: unknown };
  const vec = (x: unknown): Vec3Like | null =>
    Array.isArray(x) && x.length === 3 && x.every((c) => typeof c === 'number' && Number.isFinite(c))
      ? (x as unknown as Vec3Like)
      : null;
  const d = vec(direction);
  const u = vec(up);
  return d === null || u === null ? null : { direction: d, up: u };
}

/** Writes `uv0` for the run's corners and the seams around and inside its charts. */
function write(m: EditMesh, faces: readonly number[], projection: Projection): void {
  const uv0 = m.layer(BUILTIN_LAYERS.uv0.name) ?? m.addLayer(BUILTIN_LAYERS.uv0);
  const corners: number[] = [];
  const inRun = new Uint8Array(m.counts.faces);
  for (const f of faces) {
    inRun[f] = 1;
    for (const c of cornersOfFace(m, f, corners)) {
      uv0.set(c, 0, projection.uv[2 * c] as number);
      uv0.set(c, 1, projection.uv[2 * c + 1] as number);
    }
  }
  // Seams over every edge of the run (ascending, each once).
  const edges = new Set<number>();
  for (const f of faces) for (const c of cornersOfFace(m, f, corners)) edges.add(m.cornerEdge(c));
  for (const e of [...edges].sort((a, b) => a - b)) {
    if (m.edgeFaceCount(e) < 2) continue;
    const radial: number[] = [];
    const start = m.edgeCorner(e);
    let c = start;
    do {
      radial.push(c);
      c = m.cornerRadialNext(c);
    } while (c !== start);
    let seam = false;
    const first = radial[0] as number;
    const chart = projection.chart[first] as number;
    for (const r of radial) {
      if (inRun[m.cornerFace(r)] !== 1 || (projection.chart[r] as number) !== chart) seam = true;
    }
    if (!seam) {
      // Values at both ends must agree between every pair of faces on the edge.
      const valueAt = (r: number, vertex: number): readonly [number, number] => {
        const corner = m.cornerVert(r) === vertex ? r : m.cornerNext(r);
        return [uv0.get(corner, 0), uv0.get(corner, 1)];
      };
      for (const vertex of [m.edgeVert(e, 0), m.edgeVert(e, 1)]) {
        const [u, v] = valueAt(first, vertex);
        for (const r of radial) {
          const [x, y] = valueAt(r, vertex);
          if (!Object.is(x, u) || !Object.is(y, v)) seam = true;
        }
      }
    }
    const flags = m.edgeFlags(e);
    const next = seam ? flags | EDGE_SEAM : flags & ~EDGE_SEAM;
    if (next !== flags) m.setEdgeFlags(e, next);
  }
}

type Project = (m: EditMesh, faces: readonly number[], args: ParamValues, ctx: OpContext) => Projection | Refusal;

function uvOp(descriptor: MeshOpDescriptor, project: Project): MeshOp {
  const run = (m: EditMesh, input: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal => {
    const verdict = poll(m, input, ctx);
    if (verdict !== true) return verdict;
    const { args } = coerceArgs(descriptor.params, raw);
    const warnings: OpWarning[] = [];
    let sel = input;
    if (sel !== null && ctx.symmetry !== null) {
      sel = expandForOp(sel, ctx.symmetry.map);
      const lonely = unmatchedWarning(sel, 'face', ctx.symmetry.map);
      if (lonely !== null) warnings.push(lonely);
    }
    const faces = (runFaces(m, sel, ctx) as number[]).sort((a, b) => a - b);
    const projection = project(m, faces, args, ctx);
    if ('refused' in projection) return projection;
    if (args['fit'] === true) fitCharts(projection);
    write(m, faces, projection);
    return {
      selection: sel === null ? selectionOf('face', [], m.counts) : selectionOf('face', faces, m.counts),
      warnings,
      resolvedArgs: Object.freeze({ ...args }),
    };
  };
  return Object.freeze({ ...descriptor, poll, run });
}

export const uvPlanar: MeshOp = uvOp(UV_PLANAR, (m, faces, args, ctx) => {
  const axis = args['axis'] as 'x' | 'y' | 'z' | 'camera';
  if (axis !== 'camera') return projectPlanar(m, faces, planarFrame(axis));
  const camera = cameraOf(args['camera']);
  const frame = camera === null ? null : cameraFrame(camera, ctx.placement);
  if (frame === null) {
    return refuse('uv.no-camera', 'Planar mapping from the camera needs the pane camera (direction and up)');
  }
  return projectPlanar(m, faces, frame);
});

export const uvBox: MeshOp = uvOp(UV_BOX, (m, faces) => projectBox(m, faces));

export const uvCylindrical: MeshOp = uvOp(UV_CYLINDRICAL, (m, faces, args) =>
  projectCylindrical(m, faces, args['axis'] as 'x' | 'y' | 'z'),
);
