// Built-in export profiles (ADR 0010 §4): data with the same shape as the Ekza registry's
// GET /v1/profiles/{platform}/{profile}, shipped as static offline copies. `kind: '*'` marks a profile that applies
// to every export kind (local/generic).
import { profileRules, VRM_RULE_IDS } from '../lint/severities';
import type { ExportKind, ExportProfileDef } from '../types';
import { PROFILE_OMOBA_HANDHELD } from './handheld';

const MiB = 1_048_576;

/** Kind wildcard for profiles that apply to every exporter. */
export const ANY_EXPORT_KIND = '*';

export const BUILTIN_EXPORT_PROFILES: readonly ExportProfileDef[] = [
  // M6b (M6B-SPEC §0.4.6; C10): the one VRM deliverable for Ekza Space and OMOBA — the asset bake of an imported VRM
  // and the VRM 1.0 writer of a model character (`profiles/character.ts`); OMOBA's runtime rules (`vrm.*`) are errors
  // and the JSON chunk limit is OMOBA's 4 MiB.
  {
    id: 'ekza/space-avatar-v1',
    label: 'Ekza avatar — Space and OMOBA (VRM 1.0)',
    platform: 'universal',
    profile: 'vrm-humanoid-v1',
    kind: 'bake-into-model',
    maxBytes: 50 * MiB,
    jsonMaxBytes: 4 * MiB,
    ekza: true,
    rules: [
      ...profileRules(true),
      ...VRM_RULE_IDS.map((id) => ({
        id,
        severity: id === 'vrm.thumbnail-square' ? ('warning' as const) : ('error' as const),
      })),
    ],
  },
  // CHARACTER-CONTRACT-SPEC P-5 (C-pre): the five clips mirror OMOBA's v1 passport (`humanoid-glb-v1`, the clips its
  // hosted builder appends), not what the game plays: every hero moves with Run, and skills pick their own library
  // motions. The profile stays for asset-sourced characters; a character made for an OMOBA hero binds a target (the
  // contract's slots, C1) and exports with `ekza/omoba-humanoid-v2` (C2).
  {
    id: 'ekza/omoba-humanoid-v1',
    label: 'OMOBA humanoid v1 (GLB with the five legacy passport clips)',
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
