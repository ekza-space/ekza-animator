// Lint rule table (ADR 0010 §4): codes use the Ekza registry's issue codes where one exists, otherwise a namespaced
// code. `local` is the severity for local exports (no profile or a non-Ekza profile), `ekza` for Ekza profiles; null
// means the rule does not apply. Profiles may override severities per rule (`ExportProfileDef.rules`).
import type { ExportProfileDef, LintSeverity } from '../types';

export interface LintRuleDef {
  readonly id: string;
  readonly local: LintSeverity | null;
  readonly ekza: LintSeverity | null;
  readonly description: string;
}

export const LINT_RULES: readonly LintRuleDef[] = [
  {
    id: 'rendition_external_data',
    local: 'error',
    ekza: 'error',
    description: 'No `uri` key anywhere (any case); no external buffer or image',
  },
  {
    id: 'rendition_format',
    local: 'error',
    ekza: 'error',
    description: 'The original VRM / VRMC_vrm block is value-equal; never both VRM versions',
  },
  { id: 'source_too_large', local: 'warning', ekza: 'error', description: 'File size within the profile maxBytes' },
  { id: 'source_humanoid', local: 'error', ekza: 'error', description: 'Humanoid map with hips (VRM and VRMA)' },
  {
    id: 'rendition_animation',
    local: null,
    ekza: 'error',
    description: "The profile's required clips exist and every channel targets a node",
  },
  { id: 'rendition_skeleton', local: 'error', ekza: 'error', description: 'Skins with valid joints (bake into model)' },
  {
    id: 'ekza.chunk-alignment',
    local: 'error',
    ekza: 'error',
    description: 'One JSON chunk then at most one BIN chunk, 4-byte aligned, lengths consistent',
  },
  { id: 'ekza.single-buffer', local: 'warning', ekza: 'error', description: 'Exactly one embedded buffer' },
  {
    id: 'ekza.json-chunk-size',
    local: 'warning',
    ekza: 'error',
    description: 'JSON chunk within the profile jsonMaxBytes (4 MiB for OMOBA); above 8 MiB always an error',
  },
  {
    id: 'ekza.extensions-required',
    local: 'warning',
    ekza: 'error',
    description: 'extensionsRequired ⊆ {KHR_materials_unlit, KHR_texture_transform}',
  },
  {
    id: 'ekza.slot-name',
    local: 'warning',
    ekza: 'error',
    description: 'Exported clip names match [a-z][a-z0-9_]{0,31}; tpose is never exported',
  },
  // MVP-SPEC §4.11.13 (warning locally) wins over the ADR 0010 table (error/error): writers already refuse duplicate
  // names among the exported clips, so a local hit can only come from the model's own animations.
  {
    id: 'ekza.unique-names',
    local: 'warning',
    ekza: 'error',
    description: 'Clip names unique, case-insensitive',
  },
  {
    id: 'ekza.hips-only-translation',
    local: 'warning',
    ekza: 'error',
    description: 'Humanoid clips translate only hips',
  },
  {
    id: 'ekza.unit-quaternions',
    local: 'error',
    ekza: 'error',
    description: 'Rotation outputs have unit length (1e-6)',
  },
  {
    id: 'ekza.provenance-unknown',
    local: 'warning',
    ekza: 'warning',
    description: "A clip's redistributable is unknown",
  },
  { id: 'ekza.non-redistributable', local: 'warning', ekza: 'error', description: "A clip's redistributable is no" },
  {
    id: 'ekza.height-scale-range',
    local: 'warning',
    ekza: 'warning',
    description: 'extras.ekza.avatar.heightScale within 0.5..2',
  },
  { id: 'vrma.spec-version', local: 'error', ekza: 'error', description: 'VRMC_vrm_animation with specVersion "1.0"' },
  { id: 'vrma.animation-count', local: 'error', ekza: 'error', description: 'Exactly one animation' },
  { id: 'vrma.no-scale', local: 'error', ekza: 'error', description: 'No scale channels' },
  { id: 'vrma.non-hips-translation', local: 'error', ekza: 'error', description: 'Translation only on hips' },
  { id: 'vrma.eyes', local: 'error', ekza: 'error', description: 'leftEye / rightEye are not mapped' },
  {
    id: 'vrma.non-humanoid-channel',
    local: 'error',
    ekza: 'error',
    description: 'Channels only on humanoid (or expression / lookAt) nodes',
  },
  {
    id: 'vrma.skipped-track',
    local: 'warning',
    ekza: 'warning',
    description: 'A baked track cannot be represented in VRMA',
  },
  {
    id: 'surgeon.matrix-node',
    local: 'error',
    ekza: 'error',
    description: 'A driven node uses `matrix` (bake into model refused)',
  },
  {
    id: 'surgeon.no-rollback',
    local: 'warning',
    ekza: 'warning',
    description: 'The previous bake could not be rolled back; data was appended',
  },
  {
    id: 'surgeon.preexisting-missing-track',
    local: 'warning',
    ekza: 'warning',
    description: 'A pre-existing clip lacks a track the new clips add',
  },
  {
    id: 'bake.large-rotation-step',
    local: 'warning',
    ekza: 'warning',
    description: 'Consecutive samples more than 90° apart',
  },
];

const BY_ID = new Map(LINT_RULES.map((rule) => [rule.id, rule]));

/** Effective severity of a rule for a profile (null: the rule does not apply). */
export function ruleSeverity(id: string, profile: ExportProfileDef | null): LintSeverity | null {
  const override = profile?.rules.find((rule) => rule.id === id);
  if (override !== undefined) return override.severity;
  const def = BY_ID.get(id);
  if (def === undefined) return 'warning';
  return profile?.ekza === true ? def.ekza : def.local;
}

/** The rule list of a profile: every applicable rule with its severity for that kind of target. */
export function profileRules(ekza: boolean): ExportProfileDef['rules'] {
  return LINT_RULES.flatMap((rule) => {
    const severity = ekza ? rule.ekza : rule.local;
    return severity === null ? [] : [{ id: rule.id, severity }];
  });
}
