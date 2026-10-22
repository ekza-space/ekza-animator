// Quick Rig v2 fit (M6B-SPEC §0.4.2; C2): the template's joints from the nine markers. Pure and deterministic; the
// live preview and Create Skeleton call it with the same inputs, so the committed joints equal the last preview bit
// for bit. Markers are never moved; the joints that sit on markers equal them exactly except the elbow and knee, which
// only move in z, and only when the markers bend the limb less than the rest flexion (minimum bend).
import type { HumanBoneName } from '@ekza-studio/doc';
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import { assembleTemplate } from '../templates/build';
import { add, PRESET_BONES, presetOfBones, scale, sub, type TemplateKey, type Vec3 } from '../templates/presets';
import type { QuickRigMarker, QuickRigMarkers, SkeletonPreset, TemplateJoint } from '../types';
import { projectedCenterOf, rasterize, rowRuns } from './raster';

/** Fit constants (§0.4.2; calibrated by C2's spike, docs/wp-notes/m6b-skeleton-kernel.md). */
export const FIT = Object.freeze({
  /** neck = chin − 0.01 H; head = chin + 0.02 H. */
  neckBelowChin: 0.01,
  headAboveChin: 0.02,
  /** upper legs 0.02 H below the pelvis marker. */
  upperLegBelowPelvis: 0.02,
  /** upper legs at 0.6 of the pelvis half-width (spike; §0.4.2 says knee.x). */
  upperLegInPelvis: 0.6,
  /** thumb metacarpal 0.30 h forward of the hand (spike; the §5.2 table's 0.20 h stays for templates). */
  thumbForward: 0.3,
  /** hand tail = wrist + 0.55·(wrist − elbow). */
  handTail: 0.55,
  /** toes tail without a front extent: toe + (0, 0, 0.04 H); the front extent is searched below toe.y + 0.02 H. */
  toesTail: 0.04,
  toesBand: 0.02,
});

type Lookup = (key: TemplateKey) => TemplateJoint | undefined;

/** The marker's position, else the template's equivalent (§0.5: "missing markers take the template's proportions"). */
function markerOrTemplate(markers: QuickRigMarkers, name: QuickRigMarker, joint: Lookup, ground: number): Vec3 {
  const m = markers[name];
  if (m !== undefined) return [m[0], m[1], m[2]];
  const pos = (key: TemplateKey): Vec3 => {
    const j = joint(key);
    if (j === undefined) throw new Error(`fitTemplate: the template has no ${key}`);
    return j.position;
  };
  switch (name) {
    case 'headTop':
      return (joint('head')?.tail as Vec3 | undefined) ?? add(pos('head'), [0, 0.155 * (pos('head')[1] - ground), 0]);
    case 'chin': {
      const neck = pos('neck');
      const top = (joint('head')?.tail as Vec3 | undefined) ?? pos('head');
      return [0, neck[1] + FIT.neckBelowChin * (top[1] - ground), neck[2]];
    }
    case 'pelvis':
      return pos('hips');
    case 'shoulder':
      return pos('rightUpperArm');
    case 'elbow':
      return pos('rightLowerArm');
    case 'wrist':
      return pos('rightHand');
    case 'knee':
      return pos('rightLowerLeg');
    case 'ankle':
      return pos('rightFoot');
    case 'toe':
      return joint('rightToes')?.position ?? (joint('rightFoot')?.tail as Vec3 | undefined) ?? pos('rightFoot');
  }
}

/** z of the slab midpoint along the front view ray through (x, y), else `fallback`. */
export function frontCentreZ(bvh: TriangleBvh, x: number, y: number, fallback: number): number {
  const front = bvh.bounds()[1][2] + 1;
  const hit = projectedCenterOf(bvh, [x, y, front], [0, 0, -1], { mode: 'new', fallbackRadius: 0 });
  return hit === null ? fallback : hit[2];
}

/** The meshes' front extent (max z of the first front hits) at x over [y0, y1], or null. */
export function frontExtent(bvh: TriangleBvh, x: number, y0: number, y1: number): number | null {
  const front = bvh.bounds()[1][2] + 1;
  let best: number | null = null;
  const samples = 6;
  for (let k = 0; k < samples; k++) {
    const y = y0 + ((k + 0.5) / samples) * (y1 - y0);
    const hit = bvh.raycast([x, y, front], [0, 0, -1], 0, Number.POSITIVE_INFINITY);
    if (hit !== null) {
      const z = front - hit.t;
      if (best === null || z > best) best = z;
    }
  }
  return best;
}

/**
 * x of the right upper leg: 0.6 of the half-width of the central (torso) run of the front silhouette at the upper
 * leg's height, else the knee's x. Spike result (wp-notes): the §0.4.2 text's `knee.x` misplaces the hip joint of a
 * model whose thighs slant (T-posed Polybot: 0.057 H off); the pelvis width places it on all three fixtures.
 */
function upperLegX(bvh: TriangleBvh, y: number, knee: Vec3, H: number): number {
  const [lo, hi] = bvh.bounds();
  const step = H / 256;
  if (!(step > 0) || !(y > lo[1]) || !(y < hi[1])) return knee[0];
  const reach = Math.max(Math.abs(lo[0]), Math.abs(hi[0]));
  const half = Math.ceil(reach / step) + 1;
  const row = rasterize(bvh, 0, y - step / 2, -half * step, step, 1, 2 * half + 1);
  const centre = rowRuns(row, 0).find(([a, b]) => a <= half && b >= half);
  if (centre === undefined) return knee[0];
  const halfWidth = Math.min(half - centre[0], centre[1] - half) * step;
  return halfWidth > 0 ? -FIT.upperLegInPelvis * halfWidth : knee[0];
}

/**
 * §0.4.2 fit of `template` (its keys, parents and the fallback positions of missing markers) to `markers` (character
 * space; side markers on the right, x < 0). `opts.ground` = the meshes' min y; `opts.flexion` = the rest flexion
 * (radians); `opts.hingeBias` is the guess's (§5.3), unused here: a marker is where the user wants the joint.
 */
export function fitTemplate(
  template: readonly TemplateJoint[],
  markers: QuickRigMarkers,
  bvh: TriangleBvh,
  opts: { readonly ground: number; readonly hingeBias: number /* 0.15 */; readonly flexion: number /* 2° */ },
): readonly TemplateJoint[] {
  const byKey = new Map<TemplateKey, TemplateJoint>(template.map((joint) => [joint.key, joint]));
  const bones = new Set(template.map((joint) => joint.key).filter((key): key is HumanBoneName => key !== 'root'));
  const preset: SkeletonPreset = presetOfBones(bones) ?? 'standard33';
  const joint = (key: TemplateKey) => byKey.get(key);
  const m = (name: QuickRigMarker): Vec3 => markerOrTemplate(markers, name, joint, opts.ground);
  const headTop = m('headTop');
  const chin = m('chin');
  const pelvis = m('pelvis');
  const shoulder = m('shoulder');
  const elbow = m('elbow');
  const wrist = m('wrist');
  const knee = m('knee');
  const ankle = m('ankle');
  const toe = m('toe');
  const H = headTop[1] - opts.ground;

  const pos = new Map<TemplateKey, Vec3>();
  const tails = new Map<TemplateKey, Vec3>();
  pos.set('root', [0, opts.ground, 0]);
  pos.set('hips', pelvis);
  // Legs.
  const upperLegY = pelvis[1] - FIT.upperLegBelowPelvis * H;
  pos.set('rightUpperLeg', [upperLegX(bvh, upperLegY, knee, H), upperLegY, pelvis[2]]);
  pos.set('rightLowerLeg', knee);
  pos.set('rightFoot', ankle);
  const front = frontExtent(bvh, toe[0], opts.ground, toe[1] + FIT.toesBand * H);
  const toesTail: Vec3 =
    front !== null && front > toe[2] ? [toe[0], toe[1], front] : add(toe, [0, 0, FIT.toesTail * H]);
  if (bones.has('rightToes')) {
    pos.set('rightToes', toe);
    tails.set('rightToes', toesTail);
  } else {
    tails.set('rightFoot', toe);
  }
  // Arms.
  pos.set('rightUpperArm', shoulder);
  pos.set('rightLowerArm', elbow);
  pos.set('rightHand', wrist);
  tails.set('rightHand', add(wrist, scale(sub(wrist, elbow), FIT.handTail)));
  // Neck and head.
  const neck: Vec3 = [0, chin[1] - FIT.neckBelowChin * H, chin[2]];
  pos.set('neck', neck);
  pos.set('head', [0, chin[1] + FIT.headAboveChin * H, chin[2]]);
  tails.set('head', headTop);
  // Spine bones evenly between hips and neck, their z by projected centre.
  const spine = (['spine', 'chest', 'upperChest'] as const).filter((bone) => bones.has(bone));
  spine.forEach((bone, k) => {
    const t = (k + 1) / (spine.length + 1);
    const p = add(pelvis, scale(sub(neck, pelvis), t));
    pos.set(bone, [0, p[1], frontCentreZ(bvh, 0, p[1], p[2])]);
  });
  // Clavicle: halfway between the shoulder and the spine axis at the shoulder's height (z of the chest).
  if (bones.has('rightShoulder')) {
    const chest = pos.get('chest') ?? pos.get('spine') ?? pelvis;
    const axis: Vec3 = [0, shoulder[1], chest[2]];
    pos.set('rightShoulder', scale(add(shoulder, axis), 0.5));
  }
  return assembleTemplate(preset, { positions: pos, tails }, opts.flexion, { thumbForward: FIT.thumbForward });
}

/** Every humanoid bone the presets know, for callers that need the list (C3's preview). */
export const FIT_BONES = PRESET_BONES;
