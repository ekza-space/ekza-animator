// Provenance and grip blocks of authored GLBs (M6A-SPEC §4.5, §5.22; research 14 §9.5, ADR 0017 §7):
// `asset.extras.ekza_model_v1` (tool, version, derived-from entries, generator) and the handheld grip block
// `asset.extras.ekza_handheld_v1` of the registry's handheld-glb-v1 contract. Both are written with a fixed key order
// so the bytes are deterministic, and neither ever holds a key named `uri` (a self-contained GLB has none).
import type { DerivedFrom, HandheldGrip } from '@ekza-animator/doc';
import type { EkzaModelV1 } from '../types';

export const MODEL_META_KEY = 'ekza_model_v1';
export const HANDHELD_META_KEY = 'ekza_handheld_v1';

/** Bounds of the grip block (M6A-SPEC §4.2 `HandheldGrip`). */
export const HANDHELD_BOUNDS = { offset: 0.3, rotationDegrees: 360, scale: [0.25, 2] } as const;

/** The manual-authoring provenance of an Ekza Animator export. */
export function manualModelProvenance(opts: {
  readonly toolVersion: string;
  readonly projectSha256?: string | null;
  readonly derivedFrom?: readonly DerivedFrom[];
  readonly rig?: EkzaModelV1['rig'];
  readonly skeletonTemplate?: string | null;
}): EkzaModelV1 {
  return {
    schema: 1,
    rig: opts.rig ?? 'none',
    skeletonTemplate: opts.skeletonTemplate ?? null,
    provenance: {
      tool: 'ekza-animator',
      toolVersion: opts.toolVersion,
      projectSha256: opts.projectSha256 ?? null,
      derivedFrom: opts.derivedFrom ?? [],
      generator: { kind: 'manual' },
    },
  };
}

/** `ekza_model_v1` as written: fixed key order, derived-from entries deduplicated in first-seen order. */
export function modelBlock(model: EkzaModelV1): Record<string, unknown> {
  const seen = new Set<string>();
  const derivedFrom = model.provenance.derivedFrom
    .filter((entry) => {
      const key = JSON.stringify([entry.title, entry.author, entry.license, entry.sourceSha256]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      title: entry.title,
      author: entry.author,
      license: entry.license,
      sourceSha256: entry.sourceSha256,
    }));
  return {
    schema: 1,
    rig: model.rig,
    skeletonTemplate: model.skeletonTemplate,
    provenance: {
      tool: model.provenance.tool,
      toolVersion: model.provenance.toolVersion,
      projectSha256: model.provenance.projectSha256,
      derivedFrom,
      generator: { ...model.provenance.generator },
    },
  };
}

/** `ekza_handheld_v1` as written (registry field names). */
export function handheldBlock(grip: HandheldGrip): Record<string, unknown> {
  return {
    bone: grip.bone,
    offset: [grip.offset[0], grip.offset[1], grip.offset[2]],
    rotation_degrees: [grip.rotationDegrees[0], grip.rotationDegrees[1], grip.rotationDegrees[2]],
    scale: grip.scale,
  };
}

/** Why a written grip block is out of the registry's bounds (null when it is fine). */
export function handheldProblem(block: unknown): string | null {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return 'it is missing';
  const value = block as Record<string, unknown>;
  if (value['bone'] !== 'rightHand' && value['bone'] !== 'leftHand') return "bone must be 'rightHand' or 'leftHand'";
  const vec = (key: string, limit: number): string | null => {
    const list = value[key];
    if (!Array.isArray(list) || list.length !== 3 || !list.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      return `${key} must be three numbers`;
    }
    return (list as number[]).every((c) => Math.abs(c) <= limit) ? null : `${key} components must be within ±${limit}`;
  };
  const offset = vec('offset', HANDHELD_BOUNDS.offset);
  if (offset !== null) return offset;
  const rotation = vec('rotation_degrees', HANDHELD_BOUNDS.rotationDegrees);
  if (rotation !== null) return rotation;
  const scale = value['scale'];
  const [min, max] = HANDHELD_BOUNDS.scale;
  if (typeof scale !== 'number' || !(scale >= min && scale <= max)) return `scale must be within ${min}…${max}`;
  return null;
}
