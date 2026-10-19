// Built-in export profiles (ADR 0010 §4): data with the same shape as the Ekza registry's
// GET /v1/profiles/{platform}/{profile}, shipped as static offline copies. `kind: '*'` marks a profile that applies
// to every export kind (local/generic).
import { profileRules } from '../lint/rules';
import type { ExportKind, ExportProfileDef } from '../types';
import { PROFILE_OMOBA_HANDHELD } from './handheld';

const MiB = 1_048_576;

/** Kind wildcard for profiles that apply to every exporter. */
export const ANY_EXPORT_KIND = '*';

export const BUILTIN_EXPORT_PROFILES: readonly ExportProfileDef[] = [
  {
    id: 'ekza/space-avatar-v1',
    label: 'Ekza Space avatar (VRM with clips)',
    platform: 'universal',
    profile: 'vrm-humanoid-v1',
    kind: 'bake-into-model',
    maxBytes: 50 * MiB,
    jsonMaxBytes: 8 * MiB,
    ekza: true,
    rules: profileRules(true),
  },
  {
    id: 'ekza/omoba-humanoid-v1',
    label: 'OMOBA humanoid (GLB with the five game clips)',
    platform: 'desktop',
    profile: 'humanoid-glb-v1',
    kind: 'bake-into-model',
    maxBytes: 50 * MiB,
    jsonMaxBytes: 4 * MiB,
    requiredClips: ['idle', 'walk', 'attack', 'cast', 'death'],
    ekza: true,
    rules: profileRules(true),
  },
  {
    id: 'ekza/vrma-humanoid-v1',
    label: 'Ekza humanoid clip (VRMA, proposed T1 profile)',
    platform: 'universal',
    profile: 'vrma-humanoid-v1',
    kind: 'vrma',
    maxBytes: 8 * MiB,
    jsonMaxBytes: 4 * MiB,
    ekza: true,
    rules: profileRules(true),
  },
  // M6a (M6A-SPEC §5.22): the static handheld-prop profile.
  PROFILE_OMOBA_HANDHELD,
  {
    id: 'local/generic',
    label: 'Local file (generic checks)',
    platform: 'local',
    profile: 'generic',
    kind: ANY_EXPORT_KIND,
    maxBytes: 256 * MiB,
    jsonMaxBytes: 4 * MiB,
    ekza: false,
    rules: profileRules(false),
  },
];

/** Profiles that apply to an export kind (exact kind or the `*` wildcard). */
export function profilesForKind(
  kind: ExportKind,
  profiles: readonly ExportProfileDef[] = BUILTIN_EXPORT_PROFILES,
): ExportProfileDef[] {
  return profiles.filter((profile) => profile.kind === kind || profile.kind === ANY_EXPORT_KIND);
}
