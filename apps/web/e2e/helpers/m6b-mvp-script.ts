// INT's helpers for E2E-MVP-01, the scripted twin of AS-MVP-1 "Cube Lad comes alive" (M6B-SPEC §0.7; M6B-SPEC §3
// rule 5: content helpers in `helpers/m6b-<package-slug>.ts`): the pixels per metre of an orthographic pane, the
// joints of a character by key, the truth joints with the AS-MVP-1 drags applied, the bind checks of step 6, the
// document marks a preview must leave alone, the Validation rows that gate (errors and warnings; info never gates)
// and the validators of the exported file (glTF-Validator, vrm-validator).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setGltfValidator, validateGltf } from '@ekza-studio/io';
import { expect, type Page } from '@playwright/test';
import * as gltfValidator from 'gltf-validator';
import * as vrmValidator from 'vrm-validator';
import { boxPoints } from './m6b-skin-ui';
import { call } from './test-api';

export type Vec3 = readonly [number, number, number];
type Joint = NonNullable<Awaited<ReturnType<typeof jointsOf>>>[number];

/** The joints of a character (the test API's rows). */
export async function jointsOf(page: Page, character: string) {
  return (await call(page, 'skeleton', character))?.joints ?? [];
}

/** Joint rows by template key (`rightLowerArm`, `root`, …). */
export async function jointsByKey(page: Page, character: string): Promise<Map<string, Joint>> {
  return new Map((await jointsOf(page, character)).map((joint) => [joint.key, joint]));
}

/**
 * Screen pixels per metre of an orthographic pane, from two markers on the centre line (head top and pelvis: both
 * drawn in the front and the side pane, far apart in y). Ortho panes scale x, y and z alike.
 */
export async function pxPerMetre(page: Page, paneId: string): Promise<number> {
  const state = await call(page, 'quickRig');
  const top = state?.markers['headTop'];
  const pelvis = state?.markers['pelvis'];
  const a = await call(page, 'screenOfMarker', 'headTop', 'R', paneId);
  const b = await call(page, 'screenOfMarker', 'pelvis', 'R', paneId);
  if (top === undefined || pelvis === undefined || a === null || b === null) {
    throw new Error(`no head-top or pelvis marker in ${paneId}`);
  }
  const scale = Math.abs(a.y - b.y) / Math.abs((top[1] as number) - (pelvis[1] as number));
  expect(scale, `${paneId}: pixels per metre`).toBeGreaterThan(50);
  return scale;
}

/** Euclidean distance. */
export function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** The left mirror image of a right-side point. */
export const mirrorX = (p: readonly number[]): number[] => [-(p[0] ?? 0), p[1] ?? 0, p[2] ?? 0];

/**
 * The truth joints with the AS-MVP-1 marker drags applied (step 4: "every humanoid joint within 0.03 H of the truth,
 * with the three drags applied"): the elbow and knee joints move by their marker's delta, mirrored on the left.
 */
export function truthWithDrags(
  truth: Readonly<Record<string, { readonly position: readonly number[] }>>,
  deltas: { readonly elbow: readonly number[]; readonly knee: readonly number[] },
): Map<string, number[]> {
  const out = new Map(Object.entries(truth).map(([key, joint]) => [key, [...joint.position]]));
  const shift = (key: string, d: readonly number[], mirror: boolean) => {
    const p = out.get(key);
    if (p === undefined) return;
    out.set(key, [
      (p[0] as number) + (mirror ? -(d[0] as number) : (d[0] as number)),
      (p[1] as number) + (d[1] as number),
      (p[2] as number) + (d[2] as number),
    ]);
  };
  shift('rightLowerArm', deltas.elbow, false);
  shift('leftLowerArm', deltas.elbow, true);
  shift('rightLowerLeg', deltas.knee, false);
  shift('leftLowerLeg', deltas.knee, true);
  return out;
}

/**
 * AS-MVP-1 step 6: every point weighted, ≤ 4 influences, sums within 1e-6, no weight on `root`, and each forearm box
 * dominated by its lower arm on ≥ 95 % of its points.
 */
export async function expectBindChecks(page: Page, mesh: string): Promise<void> {
  const weights = await call(page, 'weights', mesh);
  const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
  expect(weights.length).toBe(positions.length);
  const bad = weights
    .map((row, v) => {
      const sum = row.weights.reduce((a, b) => a + b, 0);
      if (row.joints.length === 0) return `${v}: unweighted`;
      if (row.joints.length > 4) return `${v}: ${row.joints.length} influences`;
      if (Math.abs(sum - 1) > 1e-6) return `${v}: sum ${sum}`;
      if (row.joints.some((key) => key.endsWith(':root'))) return `${v}: weight on root`;
      return null;
    })
    .filter((problem) => problem !== null);
  expect(bad).toEqual([]);
  for (const [box, bone] of [
    ['forearm.L', 'leftLowerArm'],
    ['forearm.R', 'rightLowerArm'],
  ] as const) {
    const points = boxPoints(positions, box);
    expect(points.length, box).toBe(8);
    const dominated = points.filter((v) => (weights[v]?.joints[0] ?? '').endsWith(`:${bone}`)).length;
    expect(dominated / points.length, `${box} on ${bone}`).toBeGreaterThanOrEqual(0.95);
  }
}

/** The document-side marks a preview must leave unchanged: history, keys hash, record counts, dirty flag. */
export async function documentMarks(page: Page) {
  return {
    history: await call(page, 'history'),
    keys: await call(page, 'keysHash'),
    counts: await call(page, 'counts'),
    dirty: (await call(page, 'state')).dirty,
  };
}

/** Validation rows that gate (errors and warnings) for a profile; info rows never gate (INT, §0.4.5). */
export async function gatingRows(page: Page, profile?: string): Promise<string[]> {
  const rows = profile === undefined ? await call(page, 'validation') : await call(page, 'validation', profile);
  return rows.filter((row) => row.severity === 'error' || row.severity === 'warning').map((row) => row.code);
}

/** glTF-Validator (Node, the e2e policy of g4-export) and vrm-validator errors of a GLB/VRM. */
export async function validatorErrors(bytes: Uint8Array): Promise<{ gltf: string[]; vrm: string[] }> {
  setGltfValidator(gltfValidator);
  const gltf = await validateGltf(bytes);
  const vrm = await vrmValidator.validateBytes(bytes, { format: 'glb', maxIssues: 0, writeTimestamp: false });
  return {
    gltf: gltf.issues.filter((issue) => issue.severity === 0).map((issue) => `${issue.code} ${issue.message}`),
    vrm: vrm.issues.messages
      .filter((message) => message.severity === 0)
      .map((message) => `${message.code} ${message.pointer ?? ''} ${message.message}`),
  };
}

/** Writes bytes to a path relative to the web app (the e2e working directory), creating its directory. */
export function writeArtifact(path: string, bytes: Uint8Array): string {
  const url = new URL(`../../${path}`, import.meta.url);
  mkdirSync(dirname(url.pathname), { recursive: true });
  writeFileSync(url, bytes);
  return url.pathname;
}
