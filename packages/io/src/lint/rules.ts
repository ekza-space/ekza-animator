// Lint rule table (ADR 0010 §4): codes use the Ekza registry's issue codes where one exists, otherwise a namespaced
// code. `local` is the severity for local exports (no profile or a non-Ekza profile), `ekza` for Ekza profiles; null
// means the rule does not apply. Profiles may override severities per rule (`ExportProfileDef.rules`).
//
// M-AI B5: the ids and severities are `./severities.ts` (the export paths and the built-in profiles read them); this
// module adds the descriptions, which nothing on the editor's or Auto-Rig's first visit reads.
// MVP-SPEC §4.11.13 (warning locally) wins over the ADR 0010 table (error/error) for `ekza.unique-names`: writers
// already refuse duplicate names among the exported clips, so a local hit can only come from the model's own animations.
import type { LintSeverity } from '../types';
import { LINT_SEVERITIES } from './severities';

export { profileRules, ruleSeverity, VRM_RULE_IDS } from './severities';

export interface LintRuleDef {
  readonly id: string;
  readonly local: LintSeverity | null;
  readonly ekza: LintSeverity | null;
  readonly description: string;
}

/** The description of every rule but the `vrm.*` ones (theirs are `VRM_LINT_RULES`, ./vrm.ts). */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  rendition_external_data: 'No `uri` key anywhere (any case); no external buffer or image',
  rendition_format: 'The original VRM / VRMC_vrm block is value-equal; never both VRM versions',
  source_too_large: 'File size within the profile maxBytes',
  source_humanoid: 'Humanoid map with hips (VRM and VRMA)',
  rendition_animation: "The profile's required clips exist and every channel targets a node",
  rendition_skeleton: 'Skins with valid joints (bake into model)',
  'ekza.chunk-alignment': 'One JSON chunk then at most one BIN chunk, 4-byte aligned, lengths consistent',
  'ekza.single-buffer': 'Exactly one embedded buffer',
  'ekza.json-chunk-size': 'JSON chunk within the profile jsonMaxBytes (4 MiB for OMOBA); above 8 MiB always an error',
  'ekza.extensions-required': 'extensionsRequired ⊆ {KHR_materials_unlit, KHR_texture_transform}',
  'ekza.slot-name': 'Exported clip names match [a-z][a-z0-9_]{0,31}; tpose is never exported',
  'ekza.unique-names': 'Clip names unique, case-insensitive',
  'ekza.hips-only-translation': 'Humanoid clips translate only hips',
  'ekza.unit-quaternions': 'Rotation outputs have unit length (1e-6)',
  'ekza.provenance-unknown': "A clip's redistributable is unknown",
  'ekza.non-redistributable': "A clip's redistributable is no",
  'ekza.height-scale-range': 'extras.ekza.avatar.heightScale within 0.5..2',
  'vrma.spec-version': 'VRMC_vrm_animation with specVersion "1.0"',
  'vrma.animation-count': 'Exactly one animation',
  'vrma.no-scale': 'No scale channels',
  'vrma.non-hips-translation': 'Translation only on hips',
  'vrma.eyes': 'leftEye / rightEye are not mapped',
  'vrma.non-humanoid-channel': 'Channels only on humanoid (or expression / lookAt) nodes',
  'vrma.skipped-track': 'A baked track cannot be represented in VRMA',
  'surgeon.matrix-node': 'A driven node uses `matrix` (bake into model refused)',
  'surgeon.no-rollback': 'The previous bake could not be rolled back; data was appended',
  'surgeon.preexisting-missing-track': 'A pre-existing clip lacks a track the new clips add',
  'bake.large-rotation-step': 'Consecutive samples more than 90° apart',
  'bevy.unnamed-path-node': 'Animated nodes and their ancestors are named',
  'bevy.duplicate-sibling-name': 'No node on an animated path shares its name with a sibling',
  'mesh.budget.tris': 'Triangles over budget (§5.24)',
  'mesh.budget.materials': 'Materials over budget',
  'mesh.budget.textures': 'Texture size over budget',
  'mesh.budget.joints': 'Joints over budget',
  'mesh.non-manifold': 'Non-manifold edges or vertices',
  'mesh.zero-area-face': 'Zero-area faces',
  'mesh.loose-geometry': 'Loose vertices or edges',
  'mesh.inconsistent-winding': 'Inconsistent winding',
  'mesh.nonplanar-faceted': 'Non-planar n-gon in a faceted region',
  'mesh.ngon-concave': 'Concave n-gon',
  'mesh.influences': 'More than four skin influences',
  'mesh.weights-unnormalized': 'Skin weights do not sum to 1',
  'mesh.unweighted-vertex': 'Skinned vertex without weight',
  'mesh.skinned-node-transform': 'Skinned mesh node not at identity',
  'mesh.tangents-dropped': 'Tangents dropped from an edited primitive',
  'palette.missing-swatch': 'Face paints a slot without a live swatch',
  'ekza.positive-uniform-scale': 'Node scales positive and uniform',
  'ekza.no-matrix-node': 'TRS nodes only',
  'tex.size': 'Images ≤ 4096² each, ≤ 32 MP total',
  'ekza.handheld.static': 'Handheld: static, one scene',
  'ekza.handheld.extensions': 'Handheld: allowed extensions only',
  'ekza.handheld.grip': 'Handheld: grip block in bounds',
  'ekza.handheld.limits': 'Handheld: size and count limits',
  'bevy.max-joints': 'At most 256 joints in a skin',
  'ekza.provenance-ai-undisclosed': 'AI geometry disclosed in ekza_model_v1',
  'ekza.provenance-attribution': 'Derived-from entries name author and licence',
  'ekza.provenance-territory': 'Provider territory clause recorded',
  'ekza.provenance-free-tier': 'Generation not attested as paid tier',
};

export const LINT_RULES: readonly LintRuleDef[] = LINT_SEVERITIES.map(([id, local, ekza]) => ({
  id,
  local,
  ekza,
  description: DESCRIPTIONS[id] ?? 'See lint/vrm.ts',
}));
