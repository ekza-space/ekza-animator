// Validation rows (M6B-SPEC §5.21, §0.4.5; C7): the MVP rows of a character, derived from the rule owners' pure
// functions — C2's `checkSkeleton` (skel.*, xform.*), C6's `checkSkin` (skin.*) — plus the rows only the shell sees:
// `skin.unbound` (a mesh of the character without a skin) and the VRM meta rows (`vrm.meta-required`,
// `vrm.licence-unset`, `vrm.thumbnail-square`; C10's byte-level `vrm.*` lints run on the written file at export).
// Severity follows the export profile ("VRM / Ekza" or "plain"); a rule that has not landed yet (its stub throws
// `not-implemented`) gives no rows. One row per code (and per mesh for skin rows).
import { EkzaError } from '@ekza-studio/anim-core';
import type { AssetId, CharacterId, MeshId } from '@ekza-studio/doc';
import type { SkinProblem } from '@ekza-studio/mesh-core';
import { checkSkeleton, type RigProblem } from '@ekza-studio/rig';
import { meshKernel } from '../../mesh/kernel';
import type { EditorApp, OperatorId, RigValidationRow, RigValidationSeverity } from '../../types';
import { characterMeshes, characterSkeleton, docSkeletonInput, meshData, skinOf, skinSkeletonOf } from './inputs';

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
  if (record === undefined || record.source.kind !== 'model') return [];
  const rows: RawRow[] = [];
  const skeleton = characterSkeleton(app.store, character);
  if (skeleton !== null) {
    const input = docSkeletonInput(app, character);
    const problems: readonly RigProblem[] = input === null ? [] : landed(() => checkSkeleton(input));
    for (const problem of problems) rows.push({ code: problem.code, message: problem.message, ids: problem.ids });
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
    for (const mesh of meshes) {
      const skin = skinOf(app, mesh);
      if (skin === null) continue;
      const problems = landed(() =>
        kernel.checkSkin(skin, { skeleton: skinSkeleton, review: null, unreachable: null }),
      );
      for (const problem of problems) {
        rows.push({
          code: problem.code,
          message: skinMessage(problem, mesh.name),
          ids: problem.joints.length > 0 && problem.points.length === 0 ? [mesh.id, ...problem.joints] : [mesh.id],
          points: { [mesh.id]: problem.points },
        });
      }
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
