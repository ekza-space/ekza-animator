// Export profiles of model-sourced characters (M6B-SPEC §0.4.6, §5.22; C10). Data and pure functions, eager-safe.
//
// - `ekza/space-avatar-v1` ("Ekza avatar — Space and OMOBA (VRM 1.0)", the default): the one VRM 1.0 deliverable,
//   written by `writeCharacter({format: 'vrm'})` and checked with OMOBA's runtime rules (`vrm.*`, errors).
// - `local/generic`: a VRM 1.0 (the `vrm.*` rows as warnings) or a plain GLB (`format: 'glb'`, no `VRMC_vrm`, the
//   plain GLB's only route).
// - `ekza/omoba-humanoid-v1` (the shipped five-clip GLB bake) is not offered for model characters: OMOBA plays its
//   own motion library on the VRM. Asset-sourced characters keep the shipped bake path and its profiles.
import type { ExportProfileDef } from '../types';

export const SPACE_PROFILE_ID = 'ekza/space-avatar-v1';
export const LOCAL_PROFILE_ID = 'local/generic';
export const OMOBA_GLB_PROFILE_ID = 'ekza/omoba-humanoid-v1';

/** The profiles a model-sourced character can be exported with, in the Export dialog's order. */
export const MODEL_CHARACTER_PROFILE_IDS: readonly string[] = [SPACE_PROFILE_ID, LOCAL_PROFILE_ID];

/** The interop banner of the Export dialog's Character section (§0.4.6, replaces §5.22's). */
export const CHARACTER_EXPORT_BANNER = 'OMOBA plays its own motion library on your VRM; your clips play in Space.';

export type CharacterFormat = 'vrm' | 'glb';

/** The model-character profiles among `profiles` (registry order is ignored: Space first). */
export function characterProfiles(profiles: readonly ExportProfileDef[]): ExportProfileDef[] {
  return MODEL_CHARACTER_PROFILE_IDS.flatMap((id) => {
    const found = profiles.find((profile) => profile.id === id);
    return found === undefined ? [] : [found];
  });
}

/** The formats a profile writes for a model character (the first is its default). */
export function characterFormats(profile: string | null): readonly CharacterFormat[] {
  return profile === SPACE_PROFILE_ID ? ['vrm'] : ['vrm', 'glb'];
}

/** Why a (profile, format) pair cannot export a model character, or null. */
export function characterProfileProblem(profile: string | null, format: CharacterFormat): string | null {
  if (profile === OMOBA_GLB_PROFILE_ID) {
    return 'OMOBA plays its own motion library on a VRM: export with "Ekza avatar — Space and OMOBA (VRM 1.0)"';
  }
  if (profile !== null && !MODEL_CHARACTER_PROFILE_IDS.includes(profile)) {
    return `The profile ${profile} does not export characters made from models`;
  }
  if (!characterFormats(profile).includes(format)) {
    return 'The Ekza avatar is a VRM 1.0 file; a plain GLB goes through "Local file (generic checks)"';
  }
  return null;
}

/** Props are included by default for VRM and local/generic (§5.22; the MVP has no props). */
export function includePropsDefault(profile: string | null): boolean {
  return profile !== OMOBA_GLB_PROFILE_ID;
}

/** The file extension of a character export. */
export function characterExtension(format: CharacterFormat): 'vrm' | 'glb' {
  return format;
}
