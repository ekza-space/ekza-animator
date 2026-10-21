// C2 (kernel) / C3 (UI) (skeleton kernel; M6B-SPEC §0.4.2 Quick Rig v2, §0.6): Create Skeleton
// (`skel.quickRig.commit {preset, markers, meshes, flexion}`: a new character through `char.fromModel` and its template
// skeleton fitted to the markers in one step, or a re-run that refits an existing template skeleton in place — same
// ids, "Refit Skeleton", the bound meshes rebound behind the `rebindSkin` confirm) and the start-check fixes
// `skel.quickRig.center` (Center and Ground) and `skel.quickRig.faceForward` (Rotate to Face +Z), one undo step each.
//
// The helpers C3's Quick Rig session uses: `quickRigFit` (the live preview; Create Skeleton calls the same function with
// the same inputs, so the committed joints equal the last preview bit for bit) and `quickRigStartInfo` (the start
// checks, the One-Click guess or the re-run seeding).
import { EkzaError, quatFromAxisAngle, type ReadonlyXf, xfMultiply } from '@ekza-studio/anim-core';
import type { CharacterId, JointId, JointRecord, MeshId, MeshRecord, ReadView, SkeletonId, Tx } from '@ekza-studio/doc';
import type { MeshData, SkinBindArgs, SkinSkeleton, SkinWeights } from '@ekza-studio/mesh-core';
import {
  DEFAULT_FLEXION,
  fitQuickRig,
  GUESS,
  guessMarkers,
  humanChainChildren,
  isSkeletonPreset,
  JointIndex,
  markersFromJoints,
  mirrorHumanBone,
  placeTemplate,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  type QuickRigMarker,
  type QuickRigMarkers,
  type QuickRigStartChecks,
  quickRigStartChecks,
  refitTemplateJoints,
  type SkeletonPreset,
  sideFromName,
  skeletonTemplate,
  type TemplateJoint,
} from '@ekza-studio/rig';
import { kernelMeshes } from '../../../mesh';
import { worldPlacement } from '../../../mesh/context';
import { loadMeshKernel } from '../../../mesh/kernel';
import { localFromWorld } from '../../../mesh/records';
import type { EditorApp, PollResult } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import {
  applyFromModel,
  boundsTemplate,
  enterSkeletonMode,
  FLEXION_PARAM,
  type FromModelStep,
  meshesOfObjects,
  PRESET_PARAM,
  prepareFromModel,
  type RigGeometry,
  type RigTarget,
  requireKernel,
  rigGeometry,
  rigTarget,
  updateControlRig,
  writeJointEdit,
  writeTemplateSkeleton,
} from './skeleton';

const MARKERS: readonly QuickRigMarker[] = [...QUICK_RIG_CENTRE_MARKERS, ...QUICK_RIG_SIDE_MARKERS];

export const CHECK_REASONS: Readonly<Record<keyof QuickRigStartChecks, string>> = {
  centred: 'The model is off the centre line: Center and Ground first',
  grounded: 'The model does not stand on the ground: Center and Ground first',
  facing: 'The model does not face +Z: Rotate to Face +Z first',
};
export const REBIND_CONFIRM = 'Rebind replaces painted weights';

/** Markers from raw args: known names with finite triples only; null when the value is not an object. */
export function markersArg(raw: unknown): QuickRigMarkers | null {
  if (!isRecord(raw)) return null;
  const out: Partial<Record<QuickRigMarker, readonly [number, number, number]>> = {};
  for (const name of MARKERS) {
    const v = raw[name];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => typeof c === 'number' && Number.isFinite(c)))
      return null;
    out[name] = [v[0] as number, v[1] as number, v[2] as number];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fit (preview = commit) and the start information

export interface QuickRigFitInput {
  readonly preset: SkeletonPreset;
  readonly markers: QuickRigMarkers;
  readonly meshes: readonly MeshId[];
  readonly flexion: number;
}

/**
 * §0.4.2 fit: the preset's template sized by the head-top marker (else the bounds) on the meshes' ground, fitted to
 * the markers over the meshes' world geometry. Pure in its inputs (the geometry is cached per revision).
 */
export function quickRigFit(
  app: EditorApp,
  view: ReadView,
  input: QuickRigFitInput,
): { readonly joints: readonly TemplateJoint[]; readonly geometry: RigGeometry } {
  const geometry = rigGeometry(app, view, input.meshes);
  const joints = fitQuickRig(input.preset, input.markers, geometry.bvh, {
    ground: geometry.ground,
    flexion: input.flexion,
  });
  return { joints, geometry };
}

export interface QuickRigStartInfo {
  readonly checks: QuickRigStartChecks;
  /** The One-Click guess (null on a re-run or when the checks fail). */
  readonly guess: { readonly armAngle: number; readonly aPose: boolean; readonly failed: string | null } | null;
  /** The markers to start from: guessed, template proportions on the bounds (a failed guess), or seeded (re-run). */
  readonly markers: QuickRigMarkers;
  /** §0.4.2 Re-run: the template skeleton being refitted (markers seeded from its joints, the preset locked). */
  readonly refit: SkeletonId | null;
  readonly preset: SkeletonPreset | null;
}

/** What `skel.quickRig.start` shows (C3): the start checks, then the guess, or the re-run seeding. */
export function quickRigStartInfo(
  app: EditorApp,
  view: ReadView,
  meshes: readonly MeshId[],
): QuickRigStartInfo | string {
  const target = rigTarget(view, meshes);
  if (typeof target === 'string') return target;
  const geometry = rigGeometry(app, view, target.meshes);
  const checks = quickRigStartChecks(geometry.bounds, geometry.bvh);
  const skeleton = target.kind === 'character' ? target.skeleton : null;
  const joints = skeleton === null ? [] : view.query.jointsOfSkeleton(skeleton);
  if (skeleton !== null && joints.some((joint) => joint.humanBone !== null)) {
    const index = new JointIndex(joints);
    const seeded = markersFromJoints((bone) => {
      const joint = index.byHumanBone(bone);
      return joint === undefined ? undefined : { position: joint.restPosition, tail: joint.tail };
    }, geometry.ground);
    const record = view.get('skeletons', skeleton);
    const preset = record !== undefined && isSkeletonPreset(record.preset) ? record.preset : null;
    return { checks, guess: null, markers: seeded, refit: skeleton, preset };
  }
  if (!(checks.centred && checks.grounded && checks.facing)) {
    return { checks, guess: null, markers: {}, refit: null, preset: null };
  }
  const guess = guessMarkers(geometry.bvh, geometry.bounds);
  if (guess !== null) {
    return {
      checks,
      guess: { armAngle: guess.armAngle, aPose: guess.aPose, failed: null },
      markers: guess.markers,
      refit: null,
      preset: null,
    };
  }
  const template = boundsTemplate('standard33', 'standard', geometry, DEFAULT_FLEXION);
  const byKey = new Map(template.map((joint) => [joint.key, joint]));
  const markers = markersFromJoints((bone) => {
    const joint = byKey.get(bone);
    return joint === undefined ? undefined : { position: joint.position, tail: joint.tail };
  }, geometry.ground);
  return {
    checks,
    guess: {
      armAngle: 0,
      aPose: false,
      failed: 'No leg split or arm run found: the markers follow the template proportions',
    },
    markers,
    refit: null,
    preset: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The rebind of a re-run (§0.4.2: "rebinds every bound mesh with its stored bind arguments")

/** §4.2 `SkinSkeleton` of joint records (palette keys = joint ids), for the solvers. */
export function skinSkeletonOf(joints: readonly JointRecord[], height: number): SkinSkeleton {
  const index = new JointIndex(joints);
  const order = index.order;
  const at = new Map<JointId, number>(order.map((joint, i) => [joint.id, i]));
  const J = order.length;
  const parent = new Int32Array(J);
  const head = new Float64Array(3 * J);
  const tail = new Float64Array(3 * J);
  const mirror = new Int32Array(J);
  const side = new Uint8Array(J);
  const deform = new Uint8Array(J);
  order.forEach((joint, i) => {
    parent[i] = joint.parent === null ? -1 : (at.get(joint.parent) ?? -1);
    head.set(joint.restPosition, 3 * i);
    side[i] = joint.side === 'L' ? 1 : joint.side === 'R' ? 2 : 0;
    deform[i] = joint.role === 'bone' ? 1 : 0;
  });
  order.forEach((joint, i) => {
    let end: readonly number[] | null = null;
    if (joint.humanBone !== null) {
      for (const bone of humanChainChildren(joint.humanBone)) {
        const mapped = index.byHumanBone(bone);
        if (mapped !== undefined && index.isAncestor(joint.id, mapped)) {
          end = mapped.restPosition;
          break;
        }
      }
    }
    end ??= index.children.get(joint.id)?.[0]?.restPosition ?? joint.tail;
    if (end === null) {
      const p = index.parentOf(joint);
      const dir =
        p === undefined
          ? [0, 1, 0]
          : [0, 1, 2].map((k) => (joint.restPosition[k] as number) - (p.restPosition[k] as number));
      const l = Math.hypot(...dir) || 1;
      end = [0, 1, 2].map((k) => (joint.restPosition[k] as number) + (0.05 * height * (dir[k] as number)) / l);
    }
    tail.set(end.slice(0, 3), 3 * i);
    let partner: JointId | undefined = joint.mirror ?? undefined;
    if (partner === undefined || !at.has(partner)) {
      const bone = joint.humanBone === null ? null : mirrorHumanBone(joint.humanBone);
      partner = bone === null ? undefined : index.byHumanBone(bone)?.id;
    }
    if (partner === undefined) {
      const swapped = sideFromName(joint.name)?.mirrored;
      partner = swapped === undefined ? undefined : order.find((other) => other.name === swapped)?.id;
    }
    mirror[i] = partner === undefined ? -1 : (at.get(partner) ?? -1);
  });
  return {
    keys: order.map((joint) => joint.id),
    parent,
    head,
    tail,
    mirror,
    side,
    deform,
    humanBone: order.map((joint) => joint.humanBone),
    height,
  };
}

function bindArgsOf(record: MeshRecord): (SkinBindArgs & { readonly symmetrize: boolean }) | null {
  const skin = record.skin;
  if (skin === null || !('skeleton' in skin)) return null;
  const stored = (skin.bind ?? {}) as Record<string, unknown>;
  const number = (key: string, fallback: number): number =>
    typeof stored[key] === 'number' && Number.isFinite(stored[key]) ? stored[key] : fallback;
  const method = stored['method'];
  return {
    method: method === 'closest' || method === 'rigid-islands' || method === 'heat' ? method : 'auto-lowpoly',
    joints: Array.isArray(stored['joints']) ? (stored['joints'] as string[]) : null,
    points: null,
    hierarchy: stored['hierarchy'] !== false,
    dropoff: number('dropoff', 4),
    stiffness: number('stiffness', 1),
    pruneBelow: number('pruneBelow', 0.025),
    rigidifyAbove: typeof stored['rigidifyAbove'] === 'number' ? stored['rigidifyAbove'] : null,
    symmetrize: stored['symmetrize'] === true,
  };
}

interface Rebind {
  readonly mesh: MeshId;
  readonly data: MeshData;
  readonly skin: SkinWeights;
}

/** The new weights of the bound meshes over the refitted joints (the solver of C4, synchronously). */
function rebind(
  app: EditorApp,
  view: ReadView,
  bound: readonly MeshRecord[],
  joints: readonly JointRecord[],
  height: number,
): Rebind[] {
  const runtimes = kernelMeshes(app);
  const skeleton = skinSkeletonOf(joints, height);
  return bound.map((record) => {
    const data = runtimes?.get(record.id)?.data() ?? null;
    if (data === null) throw new EkzaError('mesh-loading', 'Mesh is loading');
    const args = bindArgsOf(record);
    if (args === null) throw new EkzaError('invalid-input', `${record.name} is not bound to a model skeleton`);
    const kernel = requireKernel();
    const { skin } = kernel.bindSkin(kernel.skinGeometryOf(data, height), skeleton, args, kernel.readSkin(data));
    return { mesh: record.id, data, skin };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// skel.quickRig.commit

interface CommitPrepared {
  readonly target: RigTarget;
  readonly preset: SkeletonPreset;
  readonly joints: readonly TemplateJoint[];
  readonly fromModel: FromModelStep | null;
  /** Re-run: the skeleton refitted in place and the rebinds of its bound meshes. */
  readonly refit: {
    readonly skeleton: SkeletonId;
    readonly character: CharacterId;
    readonly rebinds: readonly Rebind[];
  } | null;
}

function commitArgs(raw: unknown): QuickRigFitInput | string {
  if (!isRecord(raw)) return 'expects { preset, markers, meshes, flexion }';
  const preset = raw['preset'] ?? 'standard33';
  if (!isSkeletonPreset(preset)) return 'preset: lite17, core21, standard33 or full52';
  const markers = markersArg(raw['markers'] ?? {});
  if (markers === null) return 'markers: { <marker>: [x, y, z] }';
  const meshes = raw['meshes'];
  if (!Array.isArray(meshes) || meshes.length === 0 || !meshes.every((id) => typeof id === 'string')) {
    return 'meshes: the mesh ids to rig';
  }
  const flexion =
    typeof raw['flexion'] === 'number' && Number.isFinite(raw['flexion']) ? raw['flexion'] : DEFAULT_FLEXION;
  return { preset, markers, meshes: meshes as MeshId[], flexion };
}

const commit = defineOperator<'skel.quickRig.commit', CommitPrepared>({
  id: 'skel.quickRig.commit',
  label: 'Create Skeleton',
  description:
    'Creates the character and its skeleton fitted to the Quick Rig markers, or refits it in place (§0.4.2).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true },
  params: [
    { ...PRESET_PARAM, primary: true },
    FLEXION_PARAM,
    { name: 'markers', label: 'Markers', kind: 'data', bound: 'pointer', default: null, nullable: true, hidden: true },
    { name: 'meshes', label: 'Meshes', kind: 'data', bound: 'selection', default: null, nullable: true, hidden: true },
  ],
  extraArgs: ['confirmed'],
  poll(ctx, args): PollResult {
    const input = commitArgs(args);
    if (typeof input === 'string') return fail(input);
    const target = rigTarget(ctx.app.store, input.meshes);
    return typeof target === 'string' ? fail(target) : OK;
  },
  async prepare(ctx, args): Promise<CommitPrepared> {
    await loadMeshKernel();
    const view = ctx.app.store;
    const input = commitArgs(args);
    if (typeof input === 'string') throw new EkzaError('invalid-input', input);
    const target = rigTarget(view, input.meshes);
    if (typeof target === 'string') throw new EkzaError('op-refused', target);
    const { joints, geometry } = quickRigFit(ctx.app, view, input);
    const checks = quickRigStartChecks(geometry.bounds, geometry.bvh);
    for (const key of ['centred', 'grounded', 'facing'] as const) {
      if (!checks[key]) throw new EkzaError('op-refused', CHECK_REASONS[key]);
    }
    let refit: CommitPrepared['refit'] = null;
    if (target.kind === 'character' && target.skeleton !== null) {
      const live = view.query.jointsOfSkeleton(target.skeleton);
      if (live.some((joint) => joint.humanBone !== null)) {
        const record = view.get('skeletons', target.skeleton);
        if (record !== undefined && isSkeletonPreset(record.preset) && record.preset !== input.preset) {
          throw new EkzaError(
            'op-refused',
            `The skeleton is ${record.preset}: changing the template needs a new skeleton`,
          );
        }
        const bound = view.query.meshesBoundTo(target.skeleton);
        if (bound.length > 0 && (args as unknown as Record<string, unknown>)['confirmed'] !== true) {
          throw new EkzaError('confirm-required', REBIND_CONFIRM);
        }
        let rebinds: Rebind[] = [];
        if (bound.length > 0) {
          // The refitted records, as the transaction will write them.
          const edit = refitTemplateJoints(live, joints);
          const next = new Map(live.map((joint) => [joint.id, joint]));
          for (const joint of edit.upserts) next.set(joint.id, joint);
          rebinds = rebind(ctx.app, view, bound, [...next.values()], geometry.height);
        }
        refit = { skeleton: target.skeleton, character: target.character, rebinds };
      }
    }
    const fromModel = target.kind === 'scene' ? await prepareFromModel(ctx, target.objects) : null;
    return { target, preset: input.preset, joints, fromModel, refit };
  },
  apply(ctx, _args, prepared) {
    const tx = ctx.tx;
    if (tx === null) throw new EkzaError('unsupported', 'skel.quickRig.commit needs a transaction');
    let character: CharacterId;
    let skeleton: SkeletonId;
    if (prepared.refit !== null) {
      ({ character, skeleton } = prepared.refit);
      writeJointEdit(tx, refitTemplateJoints(tx.query.jointsOfSkeleton(skeleton), prepared.joints));
      const meshes = kernelMeshes(ctx.app);
      for (const item of prepared.refit.rebinds) {
        meshes?.writeData(tx, item.mesh, requireKernel().withSkin(item.data, item.skin));
      }
      tx.annotate({ label: 'Refit Skeleton' });
    } else if (prepared.target.kind === 'scene') {
      ({ character, skeleton } = applyFromModel(ctx, prepared.fromModel as FromModelStep));
      writeTemplateSkeleton(tx, skeleton, prepared.preset, prepared.joints);
    } else {
      character = prepared.target.character;
      const found = tx.query.skeletonOfCharacter(character);
      if (found === undefined) throw new EkzaError('invalid-input', 'The character has no skeleton record');
      skeleton = found.id;
      writeTemplateSkeleton(tx, skeleton, prepared.preset, prepared.joints);
    }
    updateControlRig(ctx.app, tx, character);
    enterSkeletonMode(ctx.app, character);
    return { character, skeleton };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Start-check fixes (§0.4.2): Center and Ground, Rotate to Face +Z

interface FixPrepared {
  readonly meshes: readonly MeshId[];
  readonly geometry: RigGeometry;
}

/** The scene meshes of a fix: `args.meshes`, else Quick Rig's, else the selected objects'. */
function fixMeshes(app: EditorApp, view: ReadView, raw: unknown): MeshId[] | string {
  const given = isRecord(raw) && Array.isArray(raw['meshes']) ? (raw['meshes'] as unknown[]) : null;
  const ids =
    given?.filter((id): id is string => typeof id === 'string') ??
    app.session.getState().rig.quickRig?.meshes ??
    app.session.getState().selection.objects;
  const meshes = meshesOfObjects(view, ids);
  if (meshes.length === 0) return 'Select the meshes to rig';
  if (meshes.some((id) => !('scene' in (view.get('meshes', id) as MeshRecord).owner))) {
    return 'Works on scene meshes, before Create Skeleton';
  }
  return meshes;
}

function fixOperator(
  id: 'skel.quickRig.center' | 'skel.quickRig.faceForward',
  label: string,
  description: string,
  transform: (geometry: RigGeometry) => ReadonlyXf,
): AnyOperator {
  return defineOperator<typeof id, FixPrepared>({
    id,
    label,
    description,
    category: 'skel',
    scope: 'rig',
    workspaces: ['rig'],
    flags: { undo: true },
    extraArgs: ['meshes'],
    poll(ctx, args): PollResult {
      const meshes = fixMeshes(ctx.app, ctx.app.store, args);
      return typeof meshes === 'string' ? fail(meshes) : OK;
    },
    async prepare(ctx, args): Promise<FixPrepared> {
      await loadMeshKernel();
      const meshes = fixMeshes(ctx.app, ctx.app.store, args);
      if (typeof meshes === 'string') throw new EkzaError('op-refused', meshes);
      return { meshes, geometry: rigGeometry(ctx.app, ctx.app.store, meshes) };
    },
    apply(ctx, _args, prepared) {
      const tx = ctx.tx as Tx;
      const delta = transform(prepared.geometry);
      const targets = new Set<string>(prepared.meshes);
      for (const meshId of prepared.meshes) {
        const record = tx.get('meshes', meshId);
        if (record === undefined) continue;
        // A mesh under another target moves with it.
        let parent: string | null = record.parent;
        let nested = false;
        const seen = new Set<string>();
        while (parent !== null && !seen.has(parent)) {
          if (targets.has(parent)) nested = true;
          seen.add(parent);
          const node: { readonly parent: string | null } | undefined = parent.startsWith('grp_')
            ? tx.get('groups', parent as never)
            : tx.get('meshes', parent as MeshId);
          parent = node?.parent ?? null;
        }
        if (nested) continue;
        const world = xfMultiply(delta, worldPlacement(tx, record));
        const placement = localFromWorld(tx, record.owner, record.parent, world);
        tx.patch('meshes', meshId, { placement });
      }
    },
  });
}

const center = fixOperator(
  'skel.quickRig.center',
  'Center and Ground',
  'Moves the meshes so their bounds sit on x = 0 and y = 0 (Quick Rig start check).',
  ({ bounds }) => ({ t: [-(bounds[0][0] + bounds[1][0]) / 2, -bounds[0][1], 0], q: [0, 0, 0, 1], s: [1, 1, 1] }),
);

const faceForward = fixOperator(
  'skel.quickRig.faceForward',
  'Rotate to Face +Z',
  'Turns the meshes 180° about Y around their centre (Quick Rig start check).',
  ({ bounds }) => {
    const cx = (bounds[0][0] + bounds[1][0]) / 2;
    const cz = (bounds[0][2] + bounds[1][2]) / 2;
    // T(c)·Ry(π)·T(−c): a point p goes to (2cx − px, py, 2cz − pz).
    return { t: [2 * cx, 0, 2 * cz], q: quatFromAxisAngle([0, 1, 0], Math.PI), s: [1, 1, 1] };
  },
);

export const QUICK_RIG_OPERATORS: readonly AnyOperator[] = [commit, center, faceForward];

/** Every joint key the fit writes for a preset (C3's preview list). */
export function previewKeys(preset: SkeletonPreset): readonly string[] {
  return skeletonTemplate(preset, { height: 1, proportions: 'standard', flexion: DEFAULT_FLEXION }).map(
    (joint) => joint.key,
  );
}
