// The scripted low-poly humanoid of E2E-MOD-15 (M6A-SPEC §10.1; research 10 §7; owner INT): the base-tool sequence
// through operators only — a subdivided cube, symmetry Object X, legs and arms extruded and repeated with `G`
// (`edit.repeatLast`), a neck and a head box, loops at the knees, elbows and waist, bevelled shoulders and head box,
// Merge to Center at the hands (poles), a Spin Edge, the −X half deleted, Mirror and Conform. Every component index is
// found from the mesh as it is at that step (positions, faces and edges through the test API), so the same script
// gives the same mesh on every run.
import { expect, type Page } from '@playwright/test';
import { createPrimitive, setMode } from './m6a-model';
import { call, runOk } from './test-api';

type Vec3 = readonly [number, number, number];
type Kind = 'vertex' | 'edge' | 'face';

const EPS = 1e-4;

interface MeshView {
  readonly positions: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
  readonly edges: readonly (readonly [number, number])[];
}

async function view(page: Page, mesh: string): Promise<MeshView> {
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
  const faces = await call(page, 'meshFaces', mesh);
  const edges = (await call(page, 'meshEdges', mesh)).map((edge) => edge.v);
  return { positions, faces, edges };
}

function centroid(m: MeshView, face: number): Vec3 {
  const verts = m.faces[face] ?? [];
  const sum = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + ((m.positions[v] as Vec3)[k] ?? 0);
  return [(sum[0] ?? 0) / verts.length, (sum[1] ?? 0) / verts.length, (sum[2] ?? 0) / verts.length];
}

/** The unit Newell normal of a face. */
function normal(m: MeshView, face: number): Vec3 {
  const verts = m.faces[face] ?? [];
  const n = [0, 0, 0];
  verts.forEach((v, i) => {
    const a = m.positions[v] as Vec3;
    const b = m.positions[verts[(i + 1) % verts.length] as number] as Vec3;
    n[0] = (n[0] ?? 0) + (a[1] - b[1]) * (a[2] + b[2]);
    n[1] = (n[1] ?? 0) + (a[2] - b[2]) * (a[0] + b[0]);
    n[2] = (n[2] ?? 0) + (a[0] - b[0]) * (a[1] + b[1]);
  });
  const length = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) || 1;
  return [(n[0] ?? 0) / length, (n[1] ?? 0) / length, (n[2] ?? 0) / length];
}

/** The faces matching `test` (by centroid and normal), in index order. */
function facesWhere(m: MeshView, test: (c: Vec3, n: Vec3) => boolean): number[] {
  return m.faces.flatMap((_, f) => (test(centroid(m, f), normal(m, f)) ? [f] : []));
}

/** The edges matching `test` (by their end points), in index order. */
function edgesWhere(m: MeshView, test: (a: Vec3, b: Vec3) => boolean): number[] {
  return m.edges.flatMap(([a, b], e) => (test(m.positions[a] as Vec3, m.positions[b] as Vec3) ? [e] : []));
}

/** The one element of a non-empty list with the largest `key` (ties: the lower index). */
function maxBy(list: readonly number[], key: (index: number) => number): number {
  expect(list.length, 'a candidate exists').toBeGreaterThan(0);
  let best = list[0] as number;
  for (const index of list) if (key(index) > key(best) + EPS) best = index;
  return best;
}

async function select(page: Page, mesh: string, kind: Kind, indices: readonly number[]): Promise<void> {
  await setMode(page, kind);
  await runOk(page, 'select.components', { mesh, kind, indices, mode: 'replace' });
}

async function counts(page: Page, mesh: string): Promise<string> {
  const info = await call(page, 'meshInfo', mesh);
  return info === null
    ? 'none'
    : `${info.counts.v}/${info.counts.e}/${info.counts.f}, ${info.stats.boundaryLoops} border loops, ${info.stats.nonManifoldEdges + info.stats.nonManifoldVerts} non-manifold`;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

/** The record of the script's steps (the operators it ran), for the scenario's report. */
export interface HumanoidRun {
  readonly mesh: string;
  readonly steps: readonly string[];
}

/** Builds the humanoid in the open Model scene and returns its mesh id. */
export async function buildHumanoid(page: Page): Promise<HumanoidRun> {
  const steps: string[] = [];
  const step = async (label: string, op: string, args?: unknown): Promise<void> => {
    await runOk(page, op, args);
    steps.push(`${label}: ${op} → ${await counts(page, mesh)}`);
  };

  // 1. The torso: a cube 0.6 × 0.75 × 0.3 m with 2 × 3 × 1 subdivisions (the seam at x = 0 is an edge loop).
  const mesh = await createPrimitive(page, 'cube', {
    width: 0.6,
    height: 0.75,
    depth: 0.3,
    subdivisionsWidth: 2,
    subdivisionsHeight: 3,
    subdivisionsDepth: 1,
  });
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await step('symmetry', 'model.symmetry.set', { meshes: [mesh], mode: 'object-x' });

  // 2. Legs: the bottom face at x > 0 (its mirror joins it), extruded down individually and tapered, then `G` twice.
  //    The taper keeps each leg's inner wall off the plane x = 0: untapered, both legs' inner walls would lie in the
  //    plane (coincident faces) and the −X leg's wall would survive the delete-half step.
  let m = await view(page, mesh);
  await select(
    page,
    mesh,
    'face',
    facesWhere(m, (c, n) => near(n[1], -1) && c[0] > EPS),
  );
  await step('legs', 'mesh.extrude', {
    meshes: [mesh],
    kind: 'face',
    localTranslateZ: 0.25,
    localScaleX: 0.85,
    localScaleY: 0.85,
    keepFacesTogether: false,
  });
  await step('legs G', 'edit.repeatLast');
  await step('legs G', 'edit.repeatLast');

  // 3. Arms: the upper side face at x = +0.3 (and its mirror), extruded out, then `G` twice.
  m = await view(page, mesh);
  await select(
    page,
    mesh,
    'face',
    facesWhere(m, (c, n) => near(n[0], 1) && near(c[0], 0.3) && c[1] > 0.12),
  );
  await step('arms', 'mesh.extrude', { meshes: [mesh], kind: 'face', localTranslateZ: 0.2 });
  await step('arms G', 'edit.repeatLast');
  await step('arms G', 'edit.repeatLast');

  // 4. Neck and head box: the two top faces together, a short narrow neck, then a wide head box.
  m = await view(page, mesh);
  const top = Math.max(...m.positions.map((p) => p[1]));
  await select(
    page,
    mesh,
    'face',
    // The torso's top only (the arms' top walls lie in the same plane).
    facesWhere(m, (c, n) => near(n[1], 1) && near(c[1], top) && c[0] > EPS && c[0] < 0.3),
  );
  await step('neck', 'mesh.extrude', {
    meshes: [mesh],
    kind: 'face',
    localTranslateZ: 0.08,
    localScaleX: 0.4,
    localScaleY: 0.6,
  });
  await step('head', 'mesh.extrude', {
    meshes: [mesh],
    kind: 'face',
    localTranslateZ: 0.28,
    localScaleX: 2,
    localScaleY: 1.4,
  });

  // 5. Loops: three at each knee (a vertical edge of the leg's middle segment, its mirror too), three at each elbow
  //    (an edge along X of the arm's middle segment), one round the waist (a vertical edge of the torso's lowest row:
  //    its ring crosses the seam, so the loop is inserted once).
  m = await view(page, mesh);
  const bottom = Math.min(...m.positions.map((p) => p[1]));
  const kneeY = (-0.375 + bottom) / 2;
  const knee = edgesWhere(
    m,
    // A leg's lengthwise edges (tapered: mostly along Y).
    (a, b) =>
      Math.abs(a[1] - b[1]) > Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]) &&
      a[0] > EPS &&
      b[0] > EPS &&
      Math.min(a[1], b[1]) < kneeY &&
      Math.max(a[1], b[1]) > kneeY,
  );
  await select(page, mesh, 'edge', [maxBy(knee, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[0])]);
  await step('knees', 'mesh.insertLoop', {
    meshes: [mesh],
    kind: 'edge',
    seedEdge: maxBy(knee, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[0]),
    mode: 'multiple',
    divisions: 3,
  });
  m = await view(page, mesh);
  const elbowX = 0.3 + 0.3;
  const elbow = edgesWhere(
    m,
    (a, b) => near(a[1], b[1]) && near(a[2], b[2]) && Math.min(a[0], b[0]) < elbowX && Math.max(a[0], b[0]) > elbowX,
  );
  const elbowSeed = maxBy(elbow, (e) => {
    const [a, b] = m.edges[e] as [number, number];
    return (m.positions[a] as Vec3)[1] + (m.positions[b] as Vec3)[1] + (m.positions[a] as Vec3)[2];
  });
  await select(page, mesh, 'edge', [elbowSeed]);
  await step('elbows', 'mesh.insertLoop', {
    meshes: [mesh],
    kind: 'edge',
    seedEdge: elbowSeed,
    mode: 'multiple',
    divisions: 3,
  });
  m = await view(page, mesh);
  const waist = edgesWhere(
    m,
    (a, b) =>
      near(a[0], 0.3) &&
      near(b[0], 0.3) &&
      near(a[2], b[2]) &&
      Math.min(a[1], b[1]) < -0.2 &&
      Math.max(a[1], b[1]) > -0.2,
  );
  const waistSeed = maxBy(waist, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[2]);
  await select(page, mesh, 'edge', [waistSeed]);
  await step('waist', 'mesh.insertLoop', { meshes: [mesh], kind: 'edge', seedEdge: waistSeed, weight: 0.5 });

  // 6. Bevel the shoulders (the torso's top outer edges along Z at x = +0.3, mirrored) and the head box's top side
  //    edges (fraction 0.3, one segment).
  m = await view(page, mesh);
  const shoulder = edgesWhere(
    m,
    (a, b) => near(a[0], 0.3) && near(b[0], 0.3) && near(a[1], 0.375) && near(b[1], 0.375) && !near(a[2], b[2]),
  );
  await select(page, mesh, 'edge', shoulder);
  await step('shoulders', 'mesh.bevel', { meshes: [mesh], kind: 'edge', fraction: 0.3, segments: 1 });
  // The head box's top side edge at +X (along Z; the mirror takes the one at −X): the top's front and back edges meet
  // the seam, and bevelling those would leave faces across the plane for the delete-half step.
  m = await view(page, mesh);
  const crown = Math.max(...m.positions.map((p) => p[1]));
  const temple = Math.max(...m.positions.filter((p) => near(p[1], crown)).map((p) => p[0]));
  const brow = edgesWhere(
    m,
    (a, b) => near(a[1], crown) && near(b[1], crown) && near(a[0], temple) && near(b[0], temple) && !near(a[2], b[2]),
  );
  await select(page, mesh, 'edge', brow);
  await step('head bevel', 'mesh.bevel', { meshes: [mesh], kind: 'edge', fraction: 0.3, segments: 1 });

  // 7. Merge to Center at the hands: the arm's end cap (x max, its mirror too) becomes a pole.
  m = await view(page, mesh);
  const reach = Math.max(...m.positions.map((p) => p[0]));
  const hand = facesWhere(m, (c, n) => near(n[0], 1) && near(c[0], reach));
  await select(page, mesh, 'face', hand);
  await step('hands', 'mesh.mergeToCenter', { meshes: [mesh], kind: 'face' });

  // 8. Spin Edge: a horizontal edge of the torso's back between the middle and lower rows, right of the seam.
  m = await view(page, mesh);
  const back = Math.min(...m.positions.filter((p) => Math.abs(p[1]) < 0.3 && Math.abs(p[0]) < 0.3).map((p) => p[2]));
  const spin = edgesWhere(
    m,
    (a, b) =>
      near(a[2], back) &&
      near(b[2], back) &&
      near(a[1], -0.125) &&
      near(b[1], -0.125) &&
      Math.min(a[0], b[0]) > -EPS &&
      Math.max(a[0], b[0]) > EPS,
  );
  await select(page, mesh, 'edge', [maxBy(spin, (e) => -e)]);
  await step('spin', 'mesh.spinEdge', { meshes: [mesh], kind: 'edge' });

  // 9. Symmetry off (a symmetric delete would take the mirror half too), delete the −X half, Mirror (cut, merge the
  //    border), Conform.
  await step('symmetry off', 'model.symmetry.set', { meshes: [mesh], mode: 'off' });
  m = await view(page, mesh);
  await select(
    page,
    mesh,
    'face',
    facesWhere(m, (c) => c[0] < -EPS),
  );
  await step('delete half', 'mesh.delete', { meshes: [mesh], kind: 'face' });
  await setMode(page, 'object');
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await step('mirror', 'mesh.mirror', { meshes: [mesh], axis: 'x', keep: 'positive', mergeMode: 'merge' });
  await step('conform', 'mesh.conform', { meshes: [mesh] });
  return { mesh, steps };
}
