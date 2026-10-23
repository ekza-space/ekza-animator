// Lint rule severities (ADR 0010 §4): the part of the rule table every export path and the built-in profiles need —
// the rule ids with their severity for local exports (`local`: no profile or a non-Ekza profile) and for Ekza profiles
// (`ekza`); null means the rule does not apply. The descriptions are `./rules.ts` (`LINT_RULES`), off the editor's and
// Auto-Rig's first visit (M-AI B5: the built-in profiles are eager, the descriptions are documentation only).
import type { ExportProfileDef, LintSeverity } from '../types';

/** The `vrm.*` codes (M6B-SPEC §0.4.6; C10): OMOBA's 16 runtime rules, then the 3 VRM 1.0 meta rows. */
export const VRM_RULE_IDS: readonly string[] =
  'spec-version container glb-size json-size node-count humanoid-bone-count bone-names required-bones parent-map node-tree trs-only unit-rotation translation-range uniform-scale extensions-required bones-skinned meta-required licence-unset thumbnail-square'
    .split(' ')
    .map((id) => `vrm.${id}`);

/** One rule's id and severities: [id, local, ekza]. */
export type LintSeverityRow = readonly [id: string, local: LintSeverity | null, ekza: LintSeverity | null];

/** Every rule in table order (`LINT_RULES` adds the descriptions in the same order). */
export const LINT_SEVERITIES: readonly LintSeverityRow[] = [
  ['rendition_external_data', 'error', 'error'],
  ['rendition_format', 'error', 'error'],
  ['source_too_large', 'warning', 'error'],
  ['source_humanoid', 'error', 'error'],
  ['rendition_animation', null, 'error'],
  ['rendition_skeleton', 'error', 'error'],
  ['ekza.chunk-alignment', 'error', 'error'],
  ['ekza.single-buffer', 'warning', 'error'],
  ['ekza.json-chunk-size', 'warning', 'error'],
  ['ekza.extensions-required', 'warning', 'error'],
  ['ekza.slot-name', 'warning', 'error'],
  ['ekza.unique-names', 'warning', 'error'],
  ['ekza.hips-only-translation', 'warning', 'error'],
  ['ekza.unit-quaternions', 'error', 'error'],
  ['ekza.provenance-unknown', 'warning', 'warning'],
  ['ekza.non-redistributable', 'warning', 'error'],
  ['ekza.height-scale-range', 'warning', 'warning'],
  ['vrma.spec-version', 'error', 'error'],
  ['vrma.animation-count', 'error', 'error'],
  ['vrma.no-scale', 'error', 'error'],
  ['vrma.non-hips-translation', 'error', 'error'],
  ['vrma.eyes', 'error', 'error'],
  ['vrma.non-humanoid-channel', 'error', 'error'],
  ['vrma.skipped-track', 'warning', 'warning'],
  ['surgeon.matrix-node', 'error', 'error'],
  ['surgeon.no-rollback', 'warning', 'warning'],
  ['surgeon.preexisting-missing-track', 'warning', 'warning'],
  ['bake.large-rotation-step', 'warning', 'warning'],
  // M1-stretch (ADR 0010 `bevy.*`): Bevy addresses animation targets by the name path from the scene root.
  ['bevy.unnamed-path-node', 'warning', 'warning'],
  ['bevy.duplicate-sibling-name', 'warning', 'warning'],
  // ---------- M6a (M6A-SPEC §4.5 lint table; B8) ----------
  ['mesh.budget.tris', 'info', 'warning'],
  ['mesh.budget.materials', 'info', 'warning'],
  ['mesh.budget.textures', 'info', 'warning'],
  ['mesh.budget.joints', 'info', 'warning'],
  ['mesh.non-manifold', 'warning', 'warning'],
  ['mesh.zero-area-face', 'warning', 'warning'],
  ['mesh.loose-geometry', 'warning', 'warning'],
  ['mesh.inconsistent-winding', 'warning', 'warning'],
  ['mesh.nonplanar-faceted', 'info', 'warning'],
  ['mesh.ngon-concave', 'info', 'warning'],
  ['mesh.influences', 'warning', 'error'],
  ['mesh.weights-unnormalized', 'error', 'error'],
  ['mesh.unweighted-vertex', 'error', 'error'],
  ['mesh.skinned-node-transform', 'warning', 'warning'],
  ['mesh.tangents-dropped', 'info', 'warning'],
  ['palette.missing-swatch', 'warning', 'warning'],
  ['ekza.positive-uniform-scale', 'error', 'error'],
  ['ekza.no-matrix-node', 'error', 'error'],
  ['tex.size', 'warning', 'warning'],
  ['ekza.handheld.static', null, 'error'],
  ['ekza.handheld.extensions', null, 'error'],
  ['ekza.handheld.grip', null, 'error'],
  ['ekza.handheld.limits', null, 'error'],
  ['bevy.max-joints', 'error', 'error'],
  ['ekza.provenance-ai-undisclosed', 'error', 'error'],
  ['ekza.provenance-attribution', 'warning', 'error'],
  ['ekza.provenance-territory', 'warning', 'error'],
  ['ekza.provenance-free-tier', 'warning', 'warning'],
  // ---------- M6b (M6B-SPEC §0.4.6; C10): OMOBA's runtime rules, warnings locally (errors through the Space profile's
  // overrides, absent for the other Ekza profiles), and the VRM 1.0 meta rows (the Space profile only). The checks and
  // the full descriptions (`VRM_LINT_RULES`) are ./vrm.ts, off the editor route. ----------
  ...VRM_RULE_IDS.map((id, i): LintSeverityRow => [id, i < 16 ? 'warning' : null, null]),
];

const BY_ID = new Map(LINT_SEVERITIES.map((row) => [row[0], row]));

/** Effective severity of a rule for a profile (null: the rule does not apply). */
export function ruleSeverity(id: string, profile: ExportProfileDef | null): LintSeverity | null {
  const override = profile?.rules.find((rule) => rule.id === id);
  if (override !== undefined) return override.severity;
  const row = BY_ID.get(id);
  if (row === undefined) return 'warning';
  return profile?.ekza === true ? row[2] : row[1];
}

/** The rule list of a profile: every applicable rule with its severity for that kind of target. */
export function profileRules(ekza: boolean): ExportProfileDef['rules'] {
  return LINT_SEVERITIES.flatMap(([id, local, ekzaSeverity]) => {
    const severity = ekza ? ekzaSeverity : local;
    return severity === null ? [] : [{ id, severity }];
  });
}
