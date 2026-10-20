// The scripted twin of AS-LP-A "Character (static)" (M6A-SPEC §10.3; owner INT): the owner's Part A steps in order,
// through operators (and the reference-image dialog), every component index found from the mesh as it is at that
// step. Units are metres; the Humanoid guides stand on the ground at the origin (1.6 m).
//
// Plan (local coordinates of the body, placed at y = 0.95 and frozen at the end):
//   hips cube 0.32 × 0.3 × 0.18 (2 × 1 × 1, the seam at x = 0) → chest extruded up 0.3 and widened (an extrude
//   session) → support loops either side of the seam (one Insert Edge Loop on a crossing edge gives two), a depth loop
//   and a shoulder ring → a Multi-Cut hip diagonal → legs extruded down from the outer bottom faces (three tapered
//   segments and a sole: the soles land on y = 0) and box feet forward → a 2 × 2 patch deleted on the shoulder (an
//   8-edge hole, mirrored) → an 8-sided arm cylinder with one open end, combined and bridged onto the +X hole (one
//   side: `symmetry.unmatched-partner`) → the −X half deleted and the +X half mirrored (merge) → symmetry back on →
//   mitten hands → elbow and knee loops placed with Slide Edge → the arms hidden for the armpit loop → a Target Weld
//   → one diagonal flipped → a head box (bevel, soft-select shaping, Set Normal Angle) → paint → Freeze.
import { expect, type Page } from '@playwright/test';
import {
  counts,
  EPS,
  edgesWhere,
  facesWhere,
  type Kind,
  maxBy,
  type MeshView,
  near,
  select,
  type Vec3,
  view,
} from './m6a-humanoid-script';
import { createPrimitive, setMode } from './m6a-model';
import { importReferenceImage, placeObjects, selectObjects } from './m6a-model-content';
import { call, runOk } from './test-api';

export interface LadRun {
  readonly group: string;
  readonly body: string;
  readonly head: string;
  readonly steps: readonly string[];
  /** World windows (ends excluded) of the arm's middle segment (x), the leg's middle segment (y), the arm's first
   *  segment (x) and the bridge between the chest and the arm (x). */
  readonly landmarks: {
    readonly elbow: readonly [number, number];
    readonly knee: readonly [number, number];
    readonly shoulder: readonly [number, number];
    readonly armpit: readonly [number, number];
  };
}

const BODY_Y = 0.95;

/** Builds Lowpoly Lad in a fresh Model scene; returns the group, the body and head meshes and the operator log. */
export async function buildLowpolyLad(page: Page): Promise<LadRun> {
  const steps: string[] = [];
  let tracked: string[] = [];
  const step = async (label: string, op: string, args?: unknown): Promise<unknown> => {
    const value = await runOk(page, op, args);
    const report = await Promise.all(tracked.map(async (id) => `${id.slice(-4)} ${await counts(page, id)}`));
    steps.push(`${label}: ${op} → ${report.join('; ')}`);
    if (process.env['EKZA_LAD_DEBUG'] === '1') console.warn(steps.at(-1));
    return value;
  };
  const sel = (mesh: string, kind: Kind, indices: readonly number[]): Promise<void> =>
    select(page, mesh, kind, indices);

  // ---------- guides, reference images, the cube inside the group ----------
  const { root: group } = (await step('guides', 'mesh.create.template', { template: 'humanoid' })) as { root: string };
  await importReferenceImage(page, 'front', 'reference-front.png');
  await importReferenceImage(page, 'side', 'reference-side.png');
  await selectObjects(page, [group]);
  const body = await createPrimitive(page, 'cube', {
    width: 0.32,
    height: 0.3,
    depth: 0.18,
    subdivisionsWidth: 2,
    subdivisionsHeight: 1,
    subdivisionsDepth: 1,
  });
  tracked = [body];
  expect((await call(page, 'meshes')).find((row) => row.id === body)?.parent, 'the cube is in the group').toBe(group);
  expect((await call(page, 'symmetry', body))?.mode, 'the cube takes the group symmetry').toBe('object-x');
  await placeObjects(page, { [body]: [0, BODY_Y, 0] });

  // ---------- torso block-out: an extrude session on the top, loops ----------
  let m = await view(page, body);
  await sel(
    body,
    'face',
    facesWhere(m, (c, n) => near(n[1], 1) && c[0] > EPS),
  );
  await step('chest', 'mesh.extrude', { meshes: [body], kind: 'face', localTranslateZ: 0.3, localScaleY: 1.15 });
  await setMode(page, 'object');
  m = await view(page, body);
  // Support loops: an X-direction edge on the top (it crosses no seam; its ring runs round the torso) at weight 0.3:
  // under Object X the loop and its mirror are both inserted (§5.14).
  const top = Math.max(...m.positions.map((p) => p[1]));
  const support = edgesWhere(
    m,
    (a, b) => near(a[1], top) && near(b[1], top) && near(a[2], b[2]) && Math.min(a[0], b[0]) > -EPS,
  );
  await sel(body, 'edge', [maxBy(support, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[2])]);
  await step('support loops', 'mesh.insertLoop', {
    meshes: [body],
    kind: 'edge',
    seedEdge: maxBy(support, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[2]),
    weight: 0.3,
  });
  // A depth loop (z = 0): a Z-direction edge on the top at the outer side; its ring crosses the seam (one loop).
  m = await view(page, body);
  const outer = Math.max(...m.positions.map((p) => p[0]));
  const depth = edgesWhere(m, (a, b) => near(a[1], top) && near(b[1], top) && near(a[0], outer) && near(b[0], outer));
  await sel(body, 'edge', [depth[0] as number]);
  await step('depth loop', 'mesh.insertLoop', { meshes: [body], kind: 'edge', seedEdge: depth[0], weight: 0.5 });
  // A chest loop: a vertical chest edge (local y 0.15 → 0.45) at weight 0.6, round the chest (one loop).
  m = await view(page, body);
  const chestEdge = edgesWhere(
    m,
    (a, b) =>
      near(a[0], b[0]) && near(a[2], b[2]) && near(Math.min(a[1], b[1]), 0.15) && near(Math.max(a[1], b[1]), top),
  );
  const ring = maxBy(chestEdge, (e) => (m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[0]);
  await sel(body, 'edge', [ring]);
  await step('chest loop', 'mesh.insertLoop', { meshes: [body], kind: 'edge', seedEdge: ring, weight: 0.6 });

  // ---------- Multi-Cut: a hip diagonal on the front outer hip face ----------
  m = await view(page, body);
  const front = Math.max(...m.positions.map((p) => p[2]));
  const hipFace = facesWhere(m, (c, n) => near(n[2], 1) && c[0] > 0.06 && c[1] < 0.1);
  expect(hipFace, 'one front outer hip face').toHaveLength(1);
  const hipVerts = m.faces[hipFace[0] as number] ?? [];
  const hipEdges = edgesWhere(m, (a, b) => near(a[2], front) && near(b[2], front));
  const onHip = hipEdges.filter((e) => {
    const [a, b] = m.edges[e] as [number, number];
    return hipVerts.includes(a) && hipVerts.includes(b);
  });
  const vertical = onHip.filter((e) => {
    const [a, b] = m.edges[e] as [number, number];
    return near((m.positions[a] as Vec3)[0], (m.positions[b] as Vec3)[0]);
  });
  const inner =
    vertical.length === 0
      ? undefined
      : maxBy(vertical, (e) => -(m.positions[(m.edges[e] as [number, number])[0]] as Vec3)[0]);
  const bottomEdge = onHip.find((e) => {
    const [a, b] = m.edges[e] as [number, number];
    return near((m.positions[a] as Vec3)[1], -0.15) && near((m.positions[b] as Vec3)[1], -0.15);
  });
  expect(
    [inner, bottomEdge].every((e) => e !== undefined),
    'the hip face edges',
  ).toBe(true);
  await sel(body, 'face', hipFace);
  await step('hip diagonal (Multi-Cut)', 'mesh.cut', {
    meshes: [body],
    kind: 'face',
    points: [
      { kind: 'edge', edge: inner, t: 0.5 },
      { kind: 'edge', edge: bottomEdge, t: 0.5 },
    ],
  });

  // ---------- legs: the outer bottom faces, three tapered segments and a sole (the soles land on y = 0) ----------
  m = await view(page, body);
  await sel(
    body,
    'face',
    facesWhere(m, (c, n) => near(n[1], -1) && c[0] > 0.06),
  );
  await step('legs', 'mesh.extrude', {
    meshes: [body],
    kind: 'face',
    localTranslateZ: 0.24,
    localScaleX: 0.92,
    localScaleY: 0.92,
  });
  await step('legs G', 'edit.repeatLast');
  await step('legs G', 'edit.repeatLast');
  await step('soles', 'mesh.extrude', { meshes: [body], kind: 'face', localTranslateZ: 0.08 });
  // Box feet: the sole segment's front wall pulled forward.
  m = await view(page, body);
  const low = Math.min(...m.positions.map((p) => p[1]));
  await sel(
    body,
    'face',
    facesWhere(m, (c, n) => near(n[2], 1) && c[0] > EPS && c[1] < low + 0.08),
  );
  await step('box feet', 'mesh.extrude', { meshes: [body], kind: 'face', localTranslateZ: 0.12 });

  // ---------- the shoulder patch: 2 × 2 faces on the chest's outer side (an 8-edge hole; its mirror too) ----------
  m = await view(page, body);
  const side = Math.max(...m.positions.filter((p) => p[1] > 0.15 + EPS).map((p) => p[0]));
  const patch = facesWhere(m, (c, n) => n[0] > 0.9 && c[0] > 0.15 && c[1] > 0.15);
  expect(patch, 'a 2 × 2 shoulder patch').toHaveLength(4);
  await sel(body, 'face', patch);
  await step('shoulder hole', 'mesh.delete', { meshes: [body], kind: 'face' });
  expect((await call(page, 'meshInfo', body))?.stats.boundaryLoops, 'two 8-edge holes').toBe(2);

  // ---------- the arm: an 8-sided cylinder with one open end, combined and bridged onto the +X hole ----------
  await setMode(page, 'object');
  await runOk(page, 'select.objects', { ids: [], mode: 'replace' });
  const arm = await createPrimitive(page, 'cylinder', {
    radius: 0.07,
    height: 0.5,
    subdivisionsAxis: 8,
    subdivisionsHeight: 3,
  });
  tracked = [body, arm];
  const cylinder = await view(page, arm);
  await sel(
    arm,
    'face',
    facesWhere(cylinder, (_c, n) => near(n[1], -1)),
  );
  await step('arm open end', 'mesh.delete', { meshes: [arm], kind: 'face' });
  await setMode(page, 'object');
  // Lying along +X (−90° about Z takes +Y to +X: the open end faces the body), 0.1 m off the hole.
  const s = Math.SQRT1_2;
  await runOk(page, 'scene.object.transform', {
    ids: [arm],
    placements: [{ t: [side + 0.1 + 0.25, BODY_Y + 0.3, 0], q: [0, 0, -s, s], s: [1, 1, 1] }],
  });
  await runOk(page, 'select.objects', { ids: [body, arm], mode: 'replace' });
  await step('combine', 'mesh.combine', { pivot: 'first' });
  tracked = [body];
  // Bridge: the +X hole's 8 border edges and the arm's open end (8), Divisions 1. The arm has no mirror partner, so
  // the bridge runs on this side only and warns (§5.14).
  m = await view(page, body);
  const border = (await call(page, 'meshEdges', body)).flatMap((edge, e) => (edge.faces === 1 ? [e] : []));
  const rightBorder = border.filter((e) => {
    const [a, b] = m.edges[e] as [number, number];
    return (m.positions[a] as Vec3)[0] > 0.1 && (m.positions[b] as Vec3)[0] > 0.1;
  });
  expect(rightBorder, 'the +X hole and the open arm end').toHaveLength(16);
  await sel(body, 'edge', rightBorder);
  await step('arm bridge', 'mesh.bridge', { meshes: [body], kind: 'edge', divisions: 1 });
  const bridged = await call(page, 'lastOp');
  steps.push(`bridge warnings: ${JSON.stringify(bridged?.warnings ?? [])}`);

  // ---------- delete the −X half, Mirror (merge): both sides match again ----------
  await step('symmetry off', 'model.symmetry.set', { meshes: [body], mode: 'off' });
  m = await view(page, body);
  await sel(
    body,
    'face',
    facesWhere(m, (c) => c[0] < -EPS),
  );
  await step('delete half', 'mesh.delete', { meshes: [body], kind: 'face' });
  await setMode(page, 'object');
  await runOk(page, 'select.objects', { ids: [body], mode: 'replace' });
  await step('mirror', 'mesh.mirror', { meshes: [body], axis: 'x', keep: 'positive', mergeMode: 'merge' });
  await step('symmetry on', 'model.symmetry.set', { meshes: [body], mode: 'object-x' });
  expect((await call(page, 'symmetry', body))?.unmatched, 'mirrored: every vertex partnered').toBe(0);

  // ---------- mitten hands: the arm's end cap pulled out and flattened ----------
  m = await view(page, body);
  const reach = Math.max(...m.positions.map((p) => p[0]));
  await sel(
    body,
    'face',
    facesWhere(m, (c, n) => near(n[0], 1) && near(c[0], reach)),
  );
  await step('mitten hands', 'mesh.extrude', {
    meshes: [body],
    kind: 'face',
    localTranslateZ: 0.1,
    localScaleX: 1.2,
    localScaleY: 1.2,
  });
  await step('mitten flatten', 'mesh.transformComponents', { meshes: [body], kind: 'face', scaleZ: 0.5 });

  // ---------- elbow and knee loops (two each), one of them placed with Slide Edge ----------
  const armStart = side + 0.1; // the open end's x
  const segment = 0.5 / 3;
  const elbow = await loopsAlong(page, body, 0, armStart + segment, armStart + 2 * segment, step, sel);
  const hip = -0.15;
  const knee = await loopsAlong(page, body, 1, hip - 0.48, hip - 0.24, step, sel);
  // A shoulder ring on the arm's first segment.
  m = await view(page, body);
  const shoulderSeed = axisEdge(m, 0, armStart, armStart + segment);
  await sel(body, 'edge', [shoulderSeed]);
  await step('shoulder ring', 'mesh.insertLoop', { meshes: [body], kind: 'edge', seedEdge: shoulderSeed, weight: 0.5 });

  // ---------- the armpit loop with the arms hidden (round the bridge, where the arm meets the chest) ----------
  m = await view(page, body);
  await sel(
    body,
    'face',
    facesWhere(m, (c) => Math.abs(c[0]) > armStart + EPS),
  );
  await step('hide arms', 'view.hide', { target: 'selected' });
  m = await view(page, body);
  const armpitSeed = axisEdge(m, 0, side - 0.03, armStart);
  await sel(body, 'edge', [armpitSeed]);
  await step('armpit loop', 'mesh.insertLoop', { meshes: [body], kind: 'edge', seedEdge: armpitSeed, weight: 0.5 });
  await step('show arms', 'view.showAll');

  // ---------- Target Weld: the hip diagonal's new front vertex onto the hip corner below it ----------
  m = await view(page, body);
  const corner = m.positions.findIndex((p) => near(p[2], front) && near(p[1], hip) && p[0] > 0.1 && p[0] < 0.17);
  const cutPoint = m.positions.findIndex((p) => near(p[2], front) && near(p[1], hip) && p[0] > 0.06 && p[0] < 0.11);
  expect(
    [corner, cutPoint].every((v) => v >= 0),
    'the hip corner and the cut point',
  ).toBe(true);
  await sel(body, 'vertex', [cutPoint]);
  await step('target weld', 'mesh.targetWeld', { meshes: [body], kind: 'vertex', pairs: [[cutPoint, corner]] });

  // ---------- flip one diagonal: a back chest quad triangulated, its diagonal flipped ----------
  m = await view(page, body);
  const back = facesWhere(m, (c, n) => near(n[2], -1) && c[0] > 0.06 && c[1] > 0.15 && c[1] < 0.3);
  expect(back.length, 'a back chest face').toBeGreaterThan(0);
  const quad = back[0] as number;
  const quadVerts = new Set(m.faces[quad] ?? []);
  const known = new Set(m.edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  await sel(body, 'face', [quad]);
  await step('triangulate', 'mesh.triangulate', { meshes: [body], kind: 'face' });
  m = await view(page, body);
  // The new edge between two of the quad's corners (vertex indices stay: triangulate adds none).
  const diagonal = m.edges.findIndex(
    ([a, b]) => quadVerts.has(a) && quadVerts.has(b) && !known.has(`${Math.min(a, b)}:${Math.max(a, b)}`),
  );
  expect(diagonal, 'the new diagonal').toBeGreaterThanOrEqual(0);
  await sel(body, 'edge', [diagonal]);
  await step('flip diagonal', 'mesh.flipTriangleEdge', { meshes: [body], kind: 'edge' });

  // ---------- the head box: inside the group (Object X), bevelled, shaped with soft select, Set Normal Angle ----------
  await setMode(page, 'object');
  await selectObjects(page, [group]);
  const head = await createPrimitive(page, 'cube', {
    width: 0.2,
    height: 0.22,
    depth: 0.2,
    subdivisionsWidth: 2,
    subdivisionsHeight: 2,
    subdivisionsDepth: 2,
  });
  tracked = [body, head];
  await placeObjects(page, { [head]: [0, BODY_Y + 0.45 + 0.02 + 0.11, 0] });
  let h = await view(page, head);
  const crown = Math.max(...h.positions.map((p) => p[1]));
  const brow = edgesWhere(
    h,
    (a, b) =>
      near(a[1], crown) &&
      near(b[1], crown) &&
      (Math.abs(a[0]) > 0.09 || Math.abs(a[2]) > 0.09) &&
      (near(a[0], b[0]) ? Math.abs(a[0]) > 0.09 : Math.abs(a[2]) > 0.09),
  );
  await sel(head, 'edge', brow);
  await step('head bevel', 'mesh.bevel', { meshes: [head], kind: 'edge', fraction: 0.3, segments: 1 });
  h = await view(page, head);
  const crownCentre = h.positions.findIndex((p) => near(p[0], 0) && near(p[2], 0) && p[1] > 0.1);
  expect(crownCentre, 'the crown centre').toBeGreaterThanOrEqual(0);
  await step('soft select on', 'model.softSelect.set', { on: true, radius: 0.12 });
  await sel(head, 'vertex', [crownCentre]);
  await step('shape the head (soft)', 'mesh.transformComponents', { meshes: [head], kind: 'vertex', translateY: 0.03 });
  await step('soft select off', 'model.softSelect.set', { on: false });
  h = await view(page, head);
  await sel(
    head,
    'edge',
    h.edges.map((_, e) => e),
  );
  await step('head normal angle', 'mesh.setNormalAngle', { meshes: [head], kind: 'edge', angle: Math.PI / 6 });

  // ---------- paint (9 swatches) ----------
  m = await view(page, body);
  const region = (test: (c: Vec3) => boolean): number[] => facesWhere(m, (c) => test(c));
  const armStartX = armStart;
  const paints: [string, number, number[]][] = [
    ['hips', 5, region((c) => Math.abs(c[0]) < side && c[1] < 0.15 && c[1] > -0.15)],
    ['chest', 3, region((c) => Math.abs(c[0]) < side && c[1] >= 0.15)],
    ['legs', 8, region((c) => c[1] < -0.15 && c[1] > -0.87)],
    ['feet', 2, region((c) => c[1] <= -0.87)],
    ['shoulders', 6, region((c) => Math.abs(c[0]) >= side && Math.abs(c[0]) <= armStartX)],
    ['arms', 9, region((c) => Math.abs(c[0]) > armStartX && Math.abs(c[0]) < armStartX + 0.5)],
    ['hands', 12, region((c) => Math.abs(c[0]) >= armStartX + 0.5)],
  ];
  for (const [label, slot, faces] of paints) {
    expect(faces.length, label).toBeGreaterThan(0);
    await sel(body, 'face', faces);
    await step(`paint ${label}`, 'mesh.paint', { meshes: [body], kind: 'face', slot });
  }
  h = await view(page, head);
  await sel(
    head,
    'face',
    facesWhere(h, (c) => c[1] < 0.06),
  );
  await step('paint face', 'mesh.paint', { meshes: [head], kind: 'face', slot: 10 });
  await sel(
    head,
    'face',
    facesWhere(h, (c) => c[1] >= 0.06),
  );
  await step('paint hair', 'mesh.paint', { meshes: [head], kind: 'face', slot: 1 });

  // ---------- Freeze Transformations ----------
  await setMode(page, 'object');
  await runOk(page, 'select.objects', { ids: [body, head], mode: 'replace' });
  await step('freeze', 'mesh.freezeTransforms', { ids: [body, head], translate: true, rotate: true, scale: true });
  return {
    group,
    body,
    head,
    steps,
    landmarks: {
      elbow,
      knee: [BODY_Y + knee[0], BODY_Y + knee[1]],
      shoulder: [armStart, armStart + segment],
      armpit: [side, armStart],
    },
  };
}

/** An edge along `axis` (0 = x, 1 = y) lying between `from` and `to` on that axis, on the +X side, the most forward. */
function axisEdge(m: MeshView, axis: 0 | 1, from: number, to: number): number {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const candidates = edgesWhere(m, (a, b) => {
    const other = axis === 0 ? 1 : 0;
    const along = Math.abs(a[axis] - b[axis]);
    const across = Math.abs(a[other] - b[other]) + Math.abs(a[2] - b[2]);
    return (
      a[0] > EPS &&
      b[0] > EPS &&
      along > across &&
      along > 0.02 &&
      Math.min(a[axis], b[axis]) > lo - EPS &&
      Math.max(a[axis], b[axis]) < hi + EPS
    );
  });
  expect(candidates.length, `an edge along ${'xy'[axis]} from ${lo} to ${hi}`).toBeGreaterThan(0);
  return maxBy(candidates, (e) => {
    const [a, b] = m.edges[e] as [number, number];
    return ((m.positions[a] as Vec3)[2] + (m.positions[b] as Vec3)[2]) / 2;
  });
}

type Step = (label: string, op: string, args?: unknown) => Promise<unknown>;
type Sel = (mesh: string, kind: Kind, indices: readonly number[]) => Promise<void>;

/**
 * Two loops across the segment from `from` to `to` along `axis` (Insert Edge Loop, Multiple, 2), then the first new
 * loop moved with Slide Edge (20 %). Returns the segment's ends.
 */
async function loopsAlong(
  page: Page,
  body: string,
  axis: 0 | 1,
  from: number,
  to: number,
  step: Step,
  sel: Sel,
): Promise<readonly [number, number]> {
  let m = await view(page, body);
  const seed = axisEdge(m, axis, from, to);
  const before = m.positions.length;
  await sel(body, 'edge', [seed]);
  await step(`${axis === 0 ? 'elbow' : 'knee'} loops`, 'mesh.insertLoop', {
    meshes: [body],
    kind: 'edge',
    seedEdge: seed,
    mode: 'multiple',
    divisions: 2,
  });
  m = await view(page, body);
  // The new loop nearest `from` on the +X side: its vertices share one coordinate on the axis.
  const fresh = m.positions.flatMap((p, v) => (v >= before && p[0] > EPS ? [v] : []));
  const nearest = Math.min(...fresh.map((v) => Math.abs((m.positions[v] as Vec3)[axis] - from)));
  const loop = new Set(fresh.filter((v) => near(Math.abs((m.positions[v] as Vec3)[axis] - from), nearest)));
  const loopEdges = m.edges.flatMap(([a, b], e) => (loop.has(a) && loop.has(b) ? [e] : []));
  await sel(body, 'edge', loopEdges);
  await step(`${axis === 0 ? 'elbow' : 'knee'} slide`, 'mesh.slide', { meshes: [body], kind: 'edge', percent: 0.2 });
  return [from, to];
}
