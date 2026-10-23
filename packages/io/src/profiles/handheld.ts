// `ekza/omoba-handheld-v1` (M6A-SPEC §5.22; registry `desktop / handheld-glb-v1`, re-implemented from its documented
// contract): the static handheld-prop profile. Its `ekza.handheld.*` rules run in `lintExport` for 'static-glb'
// exports (`lint/static.ts`); `tex.size` is an error here (the registry's browser preflight bound for handhelds).
// Registered through BUILTIN_EXPORT_PROFILES (`profiles/builtin.ts`).
import { profileRules } from '../lint/severities';
import type { ExportProfileDef } from '../types';

export const PROFILE_OMOBA_HANDHELD: ExportProfileDef = Object.freeze({
  id: 'ekza/omoba-handheld-v1',
  label: 'OMOBA handheld prop (static GLB)',
  platform: 'desktop',
  profile: 'handheld-glb-v1',
  kind: 'static-glb',
  maxBytes: 8 * 1_048_576,
  jsonMaxBytes: 4 * 1_048_576,
  ekza: true,
  rules: profileRules(true).map((rule) =>
    rule.id === 'tex.size' ? { id: rule.id, severity: 'error' as const } : rule,
  ),
});
