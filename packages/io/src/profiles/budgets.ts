// Budget presets (M6A-SPEC §5.24, research 12 §2.2; B8 owns the presets, B10 the HUD that reads them): advisory
// triangle budgets with the "warn above" thresholds, plus the per-asset materials, palette texture and joint budgets.
// Data only — eager-safe, no kernel code.
import type { BudgetPresetId, MeshBudget } from '@ekza-animator/doc';

export interface BudgetPreset {
  readonly tris: number;
  readonly warnTris: number;
  readonly materials: number;
  readonly warnMaterials: number;
  /** Side of the palette texture in pixels (one palette sheet). */
  readonly textureSide: number;
  readonly warnTextureSide: number;
  /** Joints of a skinned character (null: props are not skinned). */
  readonly joints: number | null;
  readonly warnJoints: number | null;
}

const character = {
  materials: 1,
  warnMaterials: 2,
  textureSide: 128,
  warnTextureSide: 256,
  joints: 33,
  warnJoints: 75,
};
const prop = { materials: 1, warnMaterials: 4, textureSide: 128, warnTextureSide: 256, joints: null, warnJoints: null };

export const BUDGET_PRESETS: Readonly<Record<BudgetPresetId, BudgetPreset>> = {
  hero: { tris: 3000, warnTris: 5000, ...character },
  npc: { tris: 1000, warnTris: 1500, ...character },
  boss: { tris: 6000, warnTris: 8000, ...character },
  handheld: { tris: 600, warnTris: 1500, ...prop },
  'small-prop': { tris: 300, warnTris: 800, ...prop },
  'medium-prop': { tris: 1500, warnTris: 3000, ...prop },
  building: { tris: 5000, warnTris: 8000, ...prop },
};

/** The default budget preset of an export profile (handheld-glb-v1: 'handheld'), or null. */
export function profileBudget(profile: { readonly profile: string } | null): BudgetPresetId | null {
  return profile?.profile === 'handheld-glb-v1' ? 'handheld' : null;
}

/**
 * The budget that applies to a mesh (§5.24): its own, else its export root's, else the export profile's default,
 * else none. A `{ tris }` budget has no material, texture or joint part.
 */
export function resolveBudget(
  mesh: MeshBudget,
  root: MeshBudget,
  profile: { readonly profile: string } | null,
): { readonly label: string; readonly preset: BudgetPreset | null; readonly tris: number } | null {
  const chosen = mesh ?? root;
  if (chosen !== null) {
    if ('preset' in chosen) {
      const preset = BUDGET_PRESETS[chosen.preset];
      return { label: chosen.preset, preset, tris: preset.tris };
    }
    return { label: `${chosen.tris} triangles`, preset: null, tris: chosen.tris };
  }
  const fallback = profileBudget(profile);
  if (fallback === null) return null;
  const preset = BUDGET_PRESETS[fallback];
  return { label: fallback, preset, tris: preset.tris };
}
