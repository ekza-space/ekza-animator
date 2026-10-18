// Export helpers for the export scenarios (MVP-SPEC E2E-16…E2E-18, §6.1): run `file.export` through the test API and
// capture the download together with `lastExport()`, validate the bytes in Node with gltf-validator (§4.11.13 policy
// through io's `validateGltf` / `compareValidation`), read GLB chunks, and the small quaternion kit the pose checks use.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { HumanBoneName } from '@ekza-animator/doc';
import { compareValidation, setGltfValidator, type ValidationReport, validateGltf } from '@ekza-animator/io';
import { expect, type Page } from '@playwright/test';
import { fixmeIfBlocked, lastExport, type RunResult } from './test-api';

export type Quat = readonly [number, number, number, number];

/** A bundled sample's bytes (copied from fixtures/ by `scripts/copy-assets.mjs`, which the e2e web server runs). */
export function sampleBytes(file: 'seed-san.vrm' | 'polybot.vrm' | 'quaternius-ual.glb'): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../public/samples/${file}`, import.meta.url)));
}

// ---------- file.export through the test API ----------

export interface ExportRequestArgs {
  readonly kind: 'bake-into-model' | 'vrma' | 'animation-glb';
  readonly character: string;
  readonly clips: readonly string[];
  readonly fileNamePattern?: string;
  readonly closeLoop?: boolean;
  readonly includeConstantTracks?: boolean;
  readonly acknowledgeLicense?: boolean;
  readonly profile?: string | null;
}

/** An `ExportArtifact` as the operator returned it, without its bytes (those come from the download). */
export interface ArtifactSummary {
  readonly kind: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly lints: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
  readonly readBack: unknown;
}

export interface ExportedFile {
  readonly artifact: ArtifactSummary;
  /** The downloaded file's suggested name and bytes. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Runs `file.export` with the §4.4 `ExportRequest` defaults filled in, waits for its one download and checks that
 * the download, the operator's artifact and `lastExport()` are the same file (§6.1: downloads are captured with
 * `page.waitForEvent('download')` and `lastExport()`).
 */
export async function exportOne(page: Page, request: ExportRequestArgs): Promise<ExportedFile> {
  const args = {
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
    ...request,
  };
  const download = page.waitForEvent('download', { timeout: 60_000 });
  // The artifacts' bytes stay in the page (a 10 MB bake would be serialized as a number array): only summaries return.
  const result: RunResult = await page.evaluate(async (exportArgs): Promise<RunResult> => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) return { status: 'failed', error: { code: 'internal', message: 'no test API' } };
    const ran = await api.run('file.export', exportArgs);
    const artifacts = Array.isArray(ran.value)
      ? (
          ran.value as {
            kind: string;
            fileName: string;
            sha256: string;
            bytes: Uint8Array;
            lints: unknown[];
            readBack: unknown;
          }[]
        ).map((a) => ({
          kind: a.kind,
          fileName: a.fileName,
          sha256: a.sha256,
          byteLength: a.bytes.byteLength,
          lints: a.lints,
          readBack: a.readBack,
        }))
      : ran.value;
    return { ...ran, value: artifacts };
  }, args);
  fixmeIfBlocked('file.export', result);
  expect(result.status, `file.export: ${result.reason ?? result.error?.message ?? ''}`).toBe('finished');
  const artifacts = result.value as ArtifactSummary[];
  expect(artifacts).toHaveLength(1);
  const artifact = artifacts[0] as ArtifactSummary;
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  expect(file.suggestedFilename()).toBe(artifact.fileName);
  expect(bytes.byteLength).toBe(artifact.byteLength);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  const last = await lastExport(page);
  expect(last?.fileName).toBe(artifact.fileName);
  expect(last?.sha256).toBe(artifact.sha256);
  return { artifact, name: file.suggestedFilename(), bytes };
}

// ---------- validation (§4.11.13) ----------

let validatorInstalled = false;

/** glTF-Validator report of a GLB (io's `validateGltf`: unlimited issues, VRM extensions not reported). */
export async function validationReport(bytes: Uint8Array): Promise<ValidationReport> {
  if (!validatorInstalled) {
    setGltfValidator(await import('gltf-validator'));
    validatorInstalled = true;
  }
  return validateGltf(bytes);
}

const describeIssue = (issue: { readonly code: string; readonly pointer?: string; readonly message: string }) =>
  `${issue.code} ${issue.pointer ?? ''}: ${issue.message}`;

/** Every error-severity issue of a fresh file (writers must produce none). */
export async function validatorErrors(bytes: Uint8Array): Promise<string[]> {
  return (await validationReport(bytes)).issues.filter((issue) => issue.severity === 0).map(describeIssue);
}

/** Error-severity issues of `output` whose (code, pointer) the source's report does not have (surgeon outputs). */
export async function newValidatorErrors(source: Uint8Array, output: Uint8Array): Promise<string[]> {
  return compareValidation(await validationReport(source), await validationReport(output)).map(describeIssue);
}

// ---------- GLB chunks ----------

export interface GlbChunks {
  readonly json: Record<string, unknown> & {
    readonly nodes?: readonly { readonly name?: string; readonly children?: readonly number[] }[];
    readonly meshes?: readonly unknown[];
    readonly skins?: readonly unknown[];
    readonly animations?: readonly { readonly name?: string }[];
    readonly buffers?: readonly { readonly byteLength: number; readonly uri?: string }[];
    readonly extensions?: Record<string, unknown>;
    readonly extensionsUsed?: readonly string[];
  };
  readonly bin: Uint8Array;
}

/** Splits a GLB into its parsed JSON chunk and its BIN chunk (padding included), checking the container lengths. */
export function readGlb(bytes: Uint8Array): GlbChunks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a); // 'JSON'
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GlbChunks['json'];
  const binAt = 20 + jsonLength;
  if (binAt >= bytes.byteLength) return { json, bin: new Uint8Array(0) };
  const binLength = view.getUint32(binAt, true);
  expect(view.getUint32(binAt + 4, true)).toBe(0x004e4942); // 'BIN\0'
  expect(binAt + 8 + binLength).toBe(bytes.byteLength);
  return { json, bin: bytes.subarray(binAt + 8, binAt + 8 + binLength) };
}

/** Parent node index per node (−1 for scene roots). */
export function parentsOf(json: GlbChunks['json']): number[] {
  const parents = (json.nodes ?? []).map(() => -1);
  (json.nodes ?? []).forEach((node, index) => {
    for (const child of node.children ?? []) parents[child] = index;
  });
  return parents;
}

// ---------- quaternions ([x, y, z, w]) ----------

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Inverse of a unit quaternion. */
export function qinv(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotation angle between two unit quaternions (rad, sign-insensitive), accurate near 0. */
export function qangle(a: Quat, b: Quat): number {
  const d = qmul(qinv(a), b);
  return 2 * Math.atan2(Math.hypot(d[0], d[1], d[2]), Math.abs(d[3]));
}

/** three-vrm's normalized rotation for VRM 0.x models (§4.11.9): `(−x, y, −z, w)`. */
export function flipYaw(q: Quat): Quat {
  return [-q[0], q[1], -q[2], q[3]];
}

/** Spherical interpolation of unit quaternions (shortest path). */
export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);
  if (dot > 0.9999995) {
    const q: Quat = [
      a[0] + (s * b[0] - a[0]) * t,
      a[1] + (s * b[1] - a[1]) * t,
      a[2] + (s * b[2] - a[2]) * t,
      a[3] + (s * b[3] - a[3]) * t,
    ];
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }
  const theta = Math.acos(dot);
  const wa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const wb = (s * Math.sin(t * theta)) / Math.sin(theta);
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
}

/** A glTF rotation sampler (LINEAR or STEP, 4 floats per key) evaluated at `time` seconds, clamped to its range. */
export function sampleRotation(interpolation: string, times: Float32Array, values: Float32Array, time: number): Quat {
  const key = (k: number): Quat => [
    values[k * 4] ?? 0,
    values[k * 4 + 1] ?? 0,
    values[k * 4 + 2] ?? 0,
    values[k * 4 + 3] ?? 1,
  ];
  const last = times.length - 1;
  if (time <= (times[0] ?? 0)) return key(0);
  if (time >= (times[last] ?? 0)) return key(last);
  let k = 0;
  while (k < last && (times[k + 1] ?? 0) <= time) k++;
  const t0 = times[k] ?? 0;
  const t1 = times[k + 1] ?? t0;
  if (interpolation === 'STEP' || t1 === t0) return key(k);
  return qslerp(key(k), key(k + 1), (time - t0) / (t1 - t0));
}

// ---------- VRM humanoid (VRM 1.0 specification parents, three-vrm `VRMHumanBoneParentMap`) ----------

export const HUMAN_BONE_PARENT: Readonly<Record<HumanBoneName, HumanBoneName | null>> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftEye: 'head',
  rightEye: 'head',
  jaw: 'head',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftThumbMetacarpal: 'leftHand',
  leftThumbProximal: 'leftThumbMetacarpal',
  leftThumbDistal: 'leftThumbProximal',
  leftIndexProximal: 'leftHand',
  leftIndexIntermediate: 'leftIndexProximal',
  leftIndexDistal: 'leftIndexIntermediate',
  leftMiddleProximal: 'leftHand',
  leftMiddleIntermediate: 'leftMiddleProximal',
  leftMiddleDistal: 'leftMiddleIntermediate',
  leftRingProximal: 'leftHand',
  leftRingIntermediate: 'leftRingProximal',
  leftRingDistal: 'leftRingIntermediate',
  leftLittleProximal: 'leftHand',
  leftLittleIntermediate: 'leftLittleProximal',
  leftLittleDistal: 'leftLittleIntermediate',
  rightThumbMetacarpal: 'rightHand',
  rightThumbProximal: 'rightThumbMetacarpal',
  rightThumbDistal: 'rightThumbProximal',
  rightIndexProximal: 'rightHand',
  rightIndexIntermediate: 'rightIndexProximal',
  rightIndexDistal: 'rightIndexIntermediate',
  rightMiddleProximal: 'rightHand',
  rightMiddleIntermediate: 'rightMiddleProximal',
  rightMiddleDistal: 'rightMiddleIntermediate',
  rightRingProximal: 'rightHand',
  rightRingIntermediate: 'rightRingProximal',
  rightRingDistal: 'rightRingIntermediate',
  rightLittleProximal: 'rightHand',
  rightLittleIntermediate: 'rightLittleProximal',
  rightLittleDistal: 'rightLittleIntermediate',
};

/** The nearest humanoid ancestor of `bone` among `present` (null for hips). */
export function presentHumanParent(bone: HumanBoneName, present: ReadonlySet<string>): HumanBoneName | null {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent];
  return parent;
}

/**
 * Normalized humanoid rotations from bone worlds (§4.11.9): `D_b = q(W_b)·q(W⁰_b)⁻¹`, `N_b = D_hp(b)⁻¹·D_b` with `hp`
 * the nearest present humanoid ancestor, `N_hips = D_hips`.
 */
export function humanLocalFromWorlds(
  world: Readonly<Record<string, Quat>>,
  rest: Readonly<Record<string, Quat>>,
): Record<string, Quat> {
  const present = new Set(Object.keys(world));
  const delta = (bone: string): Quat => qmul(world[bone] as Quat, qinv(rest[bone] as Quat));
  const out: Record<string, Quat> = {};
  for (const bone of present) {
    const parent = presentHumanParent(bone as HumanBoneName, present);
    out[bone] = parent === null ? delta(bone) : qmul(qinv(delta(parent)), delta(bone));
  }
  return out;
}

/** World rotations of several bones/nodes of one character at several clip frames, read in one page round trip. */
export async function boneWorldRotations(
  page: Page,
  character: string,
  names: readonly string[],
  frames: readonly number[],
): Promise<Record<string, Quat>[]> {
  return page.evaluate(
    ([id, boneNames, clipFrames]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      return clipFrames.map((frame) =>
        Object.fromEntries(boneNames.map((name) => [name, api.boneWorld(id, name, frame).q] as const)),
      );
    },
    [character, names, frames] as const,
  );
}
