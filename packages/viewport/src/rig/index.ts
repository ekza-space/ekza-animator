// Rig & Skin overlays (M6B-SPEC §4.7; imperative, no React): joints and Quick Rig markers (C3), the brush ring and the
// weight numbers (C6), constraint lines (C8b) and control-shape CVs (C9). C0 stubs: the classes exist so the owners
// fill them without touching a shared file; this module loads lazily through `loadViewportRig()` (./load.ts).

/** C3: instanced spheres, octahedral bones, axes, labels, ghosts, x-ray passes; §5.3, §8.3. */
export class JointOverlay {}
/** C6: numbers overlay, §5.12. */
export class WeightNumbers {}
/** C8b: §5.19 (deferred after the MVP). */
export class ConstraintLines {}
/** C9: §5.20 (deferred after the MVP). */
export class ShapeCvOverlay {}
/** C6: the paint brush ring (§8.3). */
export class BrushRing {}
/** C3: the Quick Rig markers, their left ghosts and the live skeleton preview (§0.4.2). */
export class QuickRigMarkers {}
// C1: the Rig & Skin skinned display (bound meshes through SkinnedSurface, §5.1).
export {
  attachSkinnedDisplay,
  inverseBindOf,
  paletteToBoneOf,
  SkinnedCharacterDisplay,
  type SkinnedDisplayTarget,
} from './skinned';
