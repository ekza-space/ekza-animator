// `ekza/omoba-handheld-v1` (M6A-SPEC §5.22; registry `desktop / handheld-glb-v1`): the static handheld-prop profile as
// data. B0a lands the definition; B8 adds its `ekza.handheld.*` rules and registers it in BUILTIN_EXPORT_PROFILES (it
// is not registered before B8, so no export dialog offers it yet).
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
  rules: [],
});
