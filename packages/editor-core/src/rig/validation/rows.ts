// Validation rows (M6B-SPEC §5.21, §0.4.5; C7): the MVP rows of a character, derived from the rule owners' pure
// functions — C2's `checkSkeleton` (skel.*, xform.*), C6's `checkSkin` (skin.*) — plus the rows only the shell sees:
// `skin.unbound` (a mesh of the character without a skin), `rig.out-of-sync` (the control rig's recorded skeleton
// fingerprint differs from the joints' `jointsFingerprint`: merges, old projects; §5.16) and the VRM meta rows
// (`vrm.meta-required`, `vrm.licence-unset`, `vrm.thumbnail-square`; C10's byte-level `vrm.*` lints run on the
// written file at export).
// Severity follows the export profile ("VRM / Ekza" or "plain"); a rule that has not landed yet (its stub throws
// `not-implemented`) gives no rows. One row per code (and per mesh for skin rows).
import { EkzaError } from '@ekza-studio/anim-core';
import type { AssetId, CharacterId, JointRecord, MeshId } from '@ekza-studio/doc';
import { skeletonFromDoc } from '@ekza-studio/io';
import type { SkinProblem } from '@ekza-studio/mesh-core';
import { checkSkeleton, type RigProblem } from '@ekza-studio/rig';
import { meshKernel } from '../../mesh/kernel';
import type { EditorApp, OperatorId, RigValidationRow, RigValidationSeverity } from '../../types';
import { characterMeshes, characterSkeleton, docSkeletonInput, meshData, skinOf, skinSkeletonOf } from './inputs';
import { bodyMeshOf, crossesLimbs, limbRegions, partName, reachOf, regionList } from './limbs';

/** The profile the panel starts with (§0.4.6: the Ekza avatar profile is the default). */
export const DEFAULT_PROFILE = 'ekza/space-avatar-v1';
/** Profiles the panel offers (§8.12, §0.4.6: model-sourced characters export through these two). */
export const RIG_PROFILES: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'ekza/space-avatar-v1', label: 'Ekza avatar — Space and OMOBA (VRM 1.0)' },
  { id: 'local/generic', label: 'Local / generic' },
];

export type ProfileKind = 'ekza' | 'plain';
/** "VRM / Ekza" for the Ekza profiles (and none), "plain" for `local/generic` (§5.21). */
export function profileKind(profile: string | null): ProfileKind {
  return profile !== null && profile.startsWith('local/') ? 'plain' : 'ekza';
}

type Sev = RigValidationSeverity | null;
/** §5.21 severities as `[Ekza, plain]`; null = the row is absent for that profile. Only the MVP rows (§0.4.5). */
export const SEVERITY: Readonly<Record<string, readonly [Sev, Sev]>> = {
  'skel.required-bones': ['error', null],
  'skel.unique-names': ['error', 'error'],
  'skel.unique-human-bone': ['error', null],
  'skel.parent-map': ['error', null],
  'skel.multiple-roots': ['error', 'warning'],
  'skel.tpose': ['error', 'warning'],
  'skel.hinge-bend': ['warning', 'warning'],
  'skel.symmetry': ['warning', 'warning'],
  'skel.grounded': ['warning', 'warning'],
  'skel.facing': ['warning', 'warning'],
  'skel.height': ['warning', 'warning'],
  'skel.orientation-mixed': ['info', 'info'],
  'xform.scale': ['error', 'error'],
  'xform.not-frozen': ['error', 'error'],
  'skin.unbound': ['error', 'warning'],
  'skin.unweighted-vertex': ['error', 'error'],
  'skin.influences': ['error', 'error'],
  'skin.weight-sum': ['error', 'error'],
  'skin.unreachable-island': ['warning', 'warning'],
  'skin.cross-side': ['warning', 'warning'],
  'skin.joint-without-weights': ['info', 'info'],
  'skin.non-deforming-weighted': ['warning', 'warning'],
  'skin.limb-unweighted': ['error', 'warning'],
  'skin.cross-limb': ['warning', 'warning'],
  'rig.out-of-sync': ['warning', 'warning'],
  'vrm.meta-required': ['error', null],
  'vrm.licence-unset': ['error', null],
  'vrm.thumbnail-square': ['warning', null],
};

const AREA: Readonly<Record<string, RigValidationRow['area']>> = {
  skel: 'skeleton',
  xform: 'transforms',
  skin: 'skin',
  rig: 'rig',
  vrm: 'export',
};
const AREA_ORDER: readonly RigValidationRow['area'][] = ['skeleton', 'transforms', 'skin', 'rig', 'export'];
const SEVERITY_ORDER: Readonly<Record<RigValidationSeverity, number>> = { error: 0, warning: 1, info: 2 };

type Fix = RigValidationRow['fix'];
const fix = (label: string, op: OperatorId, args: unknown = {}): Fix => ({ label, op, args });

/** The Fix of a row (§5.21 table, the MVP operators of §0.6; deferred fixes are absent). */
function fixOf(row: RawRow, owner: { readonly character: CharacterId; readonly skeleton: string | null }): Fix {
  const { code, ids, points } = row;
  switch (code) {
    case 'skel.required-bones':
      return owner.skeleton === null
        ? null
        : fix('Add from template', 'skel.template.addMissing', { skeleton: owner.skeleton });
    case 'skel.tpose':
      // AUTORIG-SPEC A0: Straighten to T-Pose = T-Stance applied as the rest (the bound meshes baked, one step).
      return fix('Straighten to T-Pose', 'skel.pose.applyAsRest', { character: owner.character, pose: 'tStance' });
    case 'skel.hinge-bend':
      return fix('Restore template flexion', 'skel.joint.flex');
    case 'skel.symmetry':
      return fix('Mirror L → R', 'skel.joint.mirror');
    case 'skel.grounded':
      return fix('Center and ground', 'skel.quickRig.center');
    case 'skel.facing':
      return fix('Rotate to face +Z', 'skel.quickRig.faceForward');
    case 'xform.scale':
    case 'xform.not-frozen':
      return fix('Freeze', 'mesh.freezeTransforms', { ids, translate: true, rotate: true, scale: true });
    case 'skin.unbound':
      return fix('Bind Skin', 'skin.bind', { meshes: ids });
    case 'skin.unweighted-vertex': {
      // §0.4.4: Bind Unweighted Points = a masked re-solve with the stored bind arguments.
      const mesh = ids[0];
      const list = mesh === undefined ? undefined : points?.[mesh];
      return mesh === undefined || list === undefined
        ? null
        : fix('Bind unweighted points', 'skin.bind', { meshes: [mesh], points: [...list] });
    }
    case 'skin.influences':
      // §5.21 "Prune to 4": every weight tool keeps at most four influences per point (§5.10), prune included.
      return fix('Prune to 4', 'skin.weights.prune');
    case 'skin.weight-sum':
      return fix('Normalize', 'skin.weights.normalize');
    case 'rig.out-of-sync':
      return fix('Update Control Rig', 'rig.autoRig.update');
    case 'vrm.meta-required':
    case 'vrm.licence-unset':
      return fix('Edit VRM Meta…', 'ui.open', { dialog: 'vrmMeta' });
    case 'vrm.thumbnail-square':
      return fix('Render Thumbnail', 'char.renderThumbnail', { character: owner.character });
    default:
      return null;
  }
}

/** Runs a rule owner's function; a stub that has not landed (`not-implemented`) contributes nothing. */
function landed<T>(rule: () => readonly T[]): readonly T[] {
  try {
    return rule();
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return [];
    throw error;
  }
}

/** A raw row before the profile decides its severity. */
export interface RawRow {
  readonly code: string;
  readonly message: string;
  readonly ids: readonly string[];
  readonly points?: Readonly<Record<string, Uint32Array>>;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function skinMessage(problem: SkinProblem, mesh: string): string {
  const n = problem.points.length;
  switch (problem.code) {
    case 'skin.unweighted-vertex':
      return `${plural(n, 'point')} of ${mesh} ${n === 1 ? 'has' : 'have'} no weight`;
    case 'skin.influences':
      return `${plural(n, 'point')} of ${mesh} ${n === 1 ? 'has' : 'have'} more than 4 influences`;
    case 'skin.weight-sum':
      return `${plural(n, 'point')} of ${mesh} ${n === 1 ? 'does' : 'do'} not sum to 1`;
    case 'skin.unreachable-island':
      return `${plural(n, 'point')} of ${mesh} took the rigid fallback`;
    case 'skin.cross-side':
      return `${plural(n, 'point')} of ${mesh} ${n === 1 ? 'is' : 'are'} weighted to the other side`;
    case 'skin.joint-without-weights':
      return `${plural(problem.joints.length, 'joint')} of ${mesh} influence nothing`;
    case 'skin.non-deforming-weighted':
      return `${plural(n, 'point')} of ${mesh} ${n === 1 ? 'is' : 'are'} weighted to a helper or prop joint`;
    case 'skin.review':
    case 'skin.dangling-joint':
      return `${problem.code} on ${mesh}`;
  }
}

/** Every raw row of a character (profile-independent). */
export function rawRows(app: Pick<EditorApp, 'store' | 'meshes'>, character: CharacterId): RawRow[] {
  const record = app.store.get('characters', character);
  // Asset-sourced characters (imported VRMs) are validated by their export profile's lints; Rig & Skin rows are for
  // model characters. (`source` is read defensively: pre-v3 snapshots loaded without migration in tests lack it.)
  const source = (record as { readonly source?: { readonly kind: string } } | undefined)?.source;
  if (record === undefined || source?.kind !== 'model') return [];
  const rows: RawRow[] = [];
  const skeleton = characterSkeleton(app.store, character);
  if (skeleton !== null) {
    const input = docSkeletonInput(app, character);
    const problems: readonly RigProblem[] = input === null ? [] : landed(() => checkSkeleton(input));
    for (const problem of problems) rows.push({ code: problem.code, message: problem.message, ids: problem.ids });
    const outOfSync = rigOutOfSync(app, record.rig, skeleton);
    if (outOfSync !== null && !rows.some((row) => row.code === outOfSync.code)) rows.push(outOfSync);
  }
  const meshes = characterMeshes(app.store, character);
  const unbound = meshes.filter((mesh) => mesh.skin === null);
  if (unbound.length > 0) {
    rows.push({
      code: 'skin.unbound',
      message:
        unbound.length === 1
          ? `${unbound[0]?.name ?? 'A mesh'} has no skin`
          : `${plural(unbound.length, 'mesh', 'meshes')} have no skin`,
      ids: unbound.map((mesh) => mesh.id),
    });
  }
  const kernel = meshKernel();
  if (skeleton !== null && kernel !== null) {
    const skinSkeleton = skinSkeletonOf(skeleton.joints);
    // AR-D10-3: the limb joints no bound mesh carries weight on (every skin read, at least one)
    let unweighted = null as Set<string> | null;
    let allRead = true;
    // AR-R4-5: the separate parts (every mesh but the body) whose weights reach two limbs that do not meet
    const regions = meshes.length > 1 ? limbRegions(skeleton.joints) : null;
    const body = regions === null ? null : bodyMeshOf(app, meshes, skeleton.joints);
    for (const mesh of meshes) {
      const skin = skinOf(app, mesh);
      if (skin === null) {
        if (mesh.skin !== null) allRead = false;
        continue;
      }
      const problems = landed(() =>
        kernel.checkSkin(skin, { skeleton: skinSkeleton, review: null, unreachable: null }),
      );
      const without = new Set(problems.find((problem) => problem.code === 'skin.joint-without-weights')?.joints ?? []);
      const before: Set<string> | null = unweighted;
      unweighted = before === null ? without : new Set([...before].filter((joint: string) => without.has(joint)));
      const data = body === null || mesh.id === body ? null : meshData(app, mesh);
      if (data !== null && regions !== null) {
        const reach = reachOf(mesh.id, skin, data.position, skeleton.joints, regions);
        if (crossesLimbs(reach)) {
          rows.push({
            code: 'skin.cross-limb',
            message: `${partName(mesh.name)} moves with ${regionList(reach.regions)}: it stretches between them`,
            ids: [mesh.id],
          });
        }
      }
      for (const problem of problems) {
        // AR-R4-4: a joint that moves no point of one part may move another: a multi-part character gets one row for
        // the joints no part carries weight on (below), named after the character
        if (problem.code === 'skin.joint-without-weights' && meshes.length > 1) continue;
        rows.push({
          code: problem.code,
          message: skinMessage(problem, problem.code === 'skin.joint-without-weights' ? record.name : mesh.name),
          ids: problem.joints.length > 0 && problem.points.length === 0 ? [mesh.id, ...problem.joints] : [mesh.id],
          points: { [mesh.id]: problem.points },
        });
      }
    }
    if (meshes.length > 1 && allRead && unweighted !== null && unweighted.size > 0) {
      const joints = skeleton.joints.filter((joint) => unweighted?.has(joint.id) === true).map((joint) => joint.id);
      rows.push({
        code: 'skin.joint-without-weights',
        message: `${plural(joints.length, 'joint')} of ${record.name} influence nothing`,
        ids: joints,
      });
    }
    const limbs = allRead && unweighted !== null ? limbsWithoutWeights(skeleton.joints, unweighted) : [];
    if (limbs.length > 0) {
      rows.push({
        code: 'skin.limb-unweighted',
        message: `${limbs.map((joint) => joint.name).join(', ')} ${limbs.length === 1 ? 'moves' : 'move'} no part of the model: the skeleton is not inside the body`,
        ids: limbs.map((joint) => joint.id),
      });
    }
  }
  const vrm = record.vrm;
  if (vrm === null || vrm.name.trim() === '' || !vrm.authors.some((author) => author.trim() !== '')) {
    rows.push({
      code: 'vrm.meta-required',
      message: 'VRM export needs a name and at least one author',
      ids: [character],
    });
  }
  if (vrm === null || vrm.licensePreset === null) {
    rows.push({ code: 'vrm.licence-unset', message: 'Choose a licence for the VRM export', ids: [character] });
  }
  if (!squareThumbnail(app, vrm?.thumbnail ?? null)) {
    rows.push({
      code: 'vrm.thumbnail-square',
      message: 'The VRM thumbnail is missing or not square',
      ids: [character],
    });
  }
  return rows;
}

/** The upper and lower arm and leg bones: each must move part of a humanoid's body (the hands, feet may be tiny). */
const LIMB_BONES: ReadonlySet<string> = new Set([
  'leftUpperArm',
  'leftLowerArm',
  'rightUpperArm',
  'rightLowerArm',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
]);

/**
 * `skin.limb-unweighted` (AR-D10-3): the limb joints no bound mesh carries weight on. A skeleton placed beside the
 * body — an arms-down model rigged on the template's guess, its arm bones through the head — binds the hanging arms to
 * the spine and leaves these bones moving nothing, which every other row passes.
 */
function limbsWithoutWeights(joints: readonly JointRecord[], unweighted: ReadonlySet<string>): JointRecord[] {
  return joints.filter(
    (joint) => joint.humanBone !== null && LIMB_BONES.has(joint.humanBone) && unweighted.has(joint.id),
  );
}

/**
 * `rig.out-of-sync` (§5.21): the rig records the fingerprint of the skeleton it was generated from (C1's
 * `rig.autoRig.update` writes `skeletonFromDoc(…).fingerprint`); joints edited without an update (merges, older
 * projects) no longer match it. Joints only (`jointsFingerprint`), so meshes never matter.
 */
function rigOutOfSync(
  app: Pick<EditorApp, 'store'>,
  rigId: string | null,
  found: NonNullable<ReturnType<typeof characterSkeleton>>,
): RawRow | null {
  const rig = rigId === null ? undefined : app.store.get('rigs', rigId as never);
  if (rig === undefined || rig.deleted !== null || found.joints.length === 0) return null;
  const fingerprint = skeletonFromDoc({ skeleton: found.skeleton, joints: found.joints, meshes: [] }).fingerprint;
  return fingerprint === rig.skeleton.fingerprint
    ? null
    : { code: 'rig.out-of-sync', message: 'The control rig does not match the joints', ids: [rig.id] };
}

/** The thumbnail asset exists (its squareness is C10's: the renderer writes square images only). */
function squareThumbnail(app: Pick<EditorApp, 'store'>, thumbnail: AssetId | null): boolean {
  return thumbnail !== null && app.store.get('assets', thumbnail) !== undefined;
}

/** The rows of a character under a profile: MVP codes only, severity per profile, grouped by area, by severity. */
export function profileRows(
  raw: readonly RawRow[],
  profile: string | null,
  owner: { readonly character: CharacterId; readonly skeleton: string | null },
): RigValidationRow[] {
  const column = profileKind(profile) === 'plain' ? 1 : 0;
  const rows: RigValidationRow[] = [];
  for (const row of raw) {
    const severity = SEVERITY[row.code]?.[column] ?? null;
    if (severity === null) continue;
    rows.push({
      code: row.code,
      severity,
      area: AREA[row.code.slice(0, row.code.indexOf('.'))] ?? 'export',
      message: row.message,
      ids: row.ids,
      ...(row.points === undefined ? {} : { points: row.points }),
      fix: fixOf(row, owner),
    });
  }
  return rows.sort(
    (a, b) =>
      AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** The mesh ids of a character whose data is not loaded yet (rows are incomplete until they are). */
export function pendingMeshes(app: Pick<EditorApp, 'store' | 'meshes'>, character: CharacterId): MeshId[] {
  return characterMeshes(app.store, character)
    .filter((mesh) => meshData(app, mesh) === null)
    .map((mesh) => mesh.id);
}
