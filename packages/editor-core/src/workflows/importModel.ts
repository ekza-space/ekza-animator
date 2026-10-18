// Model import (MVP-SPEC §4.11.6): `prepareModelImport` parses, checks, rigs and converts clips without touching the
// document (asynchronous; asset store, partitions); `applyModelImport` writes every record in the operator's single
// transaction and points the session at the new character.
import { EkzaError, type Fps } from '@ekza-animator/anim-core';
import type { AssetRecord, CameraId, CharacterId, ClipId, ModelFormat, RigId, Tx } from '@ekza-animator/doc';
import {
  checkInputBudget,
  detectModelFormat,
  type GlbContainer,
  parseGlb,
  readAnimations,
  readVrmLicense,
  skeletonFromGltf,
  type VrmLicenseInfo,
} from '@ekza-animator/io';
import {
  autoRig,
  compileRig,
  DEFAULT_REDUCE,
  detectClipFps,
  importRawClip,
  type RawClip,
  type RigDefinition,
  type SkeletonDesc,
  writeRigDefinition,
} from '@ekza-animator/rig';
import { newRecordId } from '../app/internals';
import type { ImportModelOptions, ImportResult } from '../operators/args';
import type { EditorApp } from '../types';
import { frameShotCamera, SHOT_FOV_Y } from './camera';
import { type ClipWritePlan, planEmptyClip, planImportedClip, resolveClipOptions, writeClipPlan } from './clipWrite';
import { type Progress, yieldToHost } from './host';
import { importLimbWarnings } from './ik';
import { baseName, extensionOf, numberedName, sanitizeClipName, uniqueName } from './names';
import { clipProvenance, isRestrictedLicense, type KnownLicense, sourceProvenance } from './provenance';
import { cameraRecord, characterRecord, DEFAULT_CLIP_RANGE, orderAfter, projectRecord } from './records';
import { activateClip, EMPTY_SELECTION, sceneFpsIn } from './session';
import { maxChannelKeys } from './util';

export { clipNamesOf, clipNameTaken } from './importChecks';

/** Embedded clips are all imported by default when there are at most this many (import dialog default). */
export const DEFAULT_ALL_CLIPS_LIMIT = 8;
/** Characters are placed side by side along +X, this many character heights apart. */
const CHARACTER_SPACING = 1.2;

export interface ModelImportInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly options?: Partial<ImportModelOptions> | undefined;
  /** Licence of a bundled sample (overrides the file's meta for provenance). */
  readonly known?: KnownLicense;
  /** Clip imported when `options.clips` is not given (bundled samples), by animation name. */
  readonly defaultClip?: string | null;
  /** Called after each converted clip (busy indicator). */
  readonly progress?: Progress;
}

export interface ModelImportPlan {
  readonly fileName: string;
  readonly asset: AssetRecord;
  readonly format: ModelFormat;
  readonly characterId: CharacterId;
  readonly characterName: string;
  readonly rig: RigDefinition;
  readonly height: number;
  readonly clips: readonly ClipWritePlan[];
  readonly cameraId: CameraId;
  readonly license: VrmLicenseInfo | null;
  /** For the user (toast and import summary): clips, licence, sub-frame keys, dropped channels. */
  readonly warnings: readonly string[];
  /** Technical notes on the skeleton and rig (summary only), e.g. near-uniform joint scales. */
  readonly notes: readonly string[];
}

/** Rejects files that fail the input budgets or the structural checks (§4.11.14), before anything large is read. */
export function assertWithinBudget(container: GlbContainer): void {
  const error = checkInputBudget(container).find((issue) => issue.severity === 'error');
  if (error === undefined) return;
  const code = error.code === 'budget-exceeded' ? 'budget-exceeded' : 'malformed-gltf';
  throw new EkzaError(code, error.message, error.pointer === undefined ? undefined : { pointer: error.pointer });
}

/** Animation names of a glTF file (without decoding any data); unnamed ones as io names them. */
export function animationNames(container: GlbContainer): readonly string[] {
  const animations = container.json['animations'];
  if (!Array.isArray(animations)) return [];
  return (animations as readonly unknown[]).map((animation, index) => {
    const name =
      typeof animation === 'object' && animation !== null ? (animation as { readonly name?: unknown }).name : undefined;
    return typeof name === 'string' && name !== '' ? name : `animation_${index}`;
  });
}

/**
 * Reads only the wanted glTF animations (io `readAnimations` over a container that lists just those), so a large
 * library is not decoded for one clip and an unwanted compressed animation does not block the import. The clips keep
 * their original index and name.
 */
export function readWantedAnimations(
  container: GlbContainer,
  skeleton: SkeletonDesc,
  wanted: readonly number[],
  names: readonly string[],
): readonly RawClip[] {
  const animations = container.json['animations'];
  if (!Array.isArray(animations) || wanted.length === 0) return [];
  const subset: GlbContainer = {
    ...container,
    json: { ...container.json, animations: wanted.map((index) => (animations as readonly unknown[])[index]) },
  };
  return readAnimations(subset, skeleton).flatMap((raw) => {
    const index = wanted[raw.index];
    return index === undefined ? [] : [{ ...raw, index, name: names[index] ?? raw.name }];
  });
}

/** glTF animation indices to import: the option, else the sample default, else all of them when there are few. */
export function selectClips(
  names: readonly string[],
  option: ImportModelOptions['clips'] | undefined,
  defaultClip: string | null | undefined,
  warnings: string[],
): readonly number[] {
  if (option === 'none') return [];
  if (option === 'all') return names.map((_, i) => i);
  if (option !== undefined) {
    const picked = [...new Set(option)].sort((a, b) => a - b);
    for (const index of picked) {
      if (!Number.isInteger(index) || index < 0 || index >= names.length) {
        warnings.push(`The file has no animation ${String(index)}; skipped`);
      }
    }
    return picked.filter((index) => Number.isInteger(index) && index >= 0 && index < names.length);
  }
  if (defaultClip !== undefined && defaultClip !== null) {
    const index = names.indexOf(defaultClip);
    if (index !== -1) return [index];
    warnings.push(`The default clip '${defaultClip}' is missing from the file`);
    return [];
  }
  return names.length <= DEFAULT_ALL_CLIPS_LIMIT ? names.map((_, i) => i) : [];
}

function characterTitle(fileName: string, license: VrmLicenseInfo | null): string {
  const title = license?.title?.trim();
  const usable = title !== undefined && title !== '' && title !== 'undefined' ? title : baseName(fileName);
  return usable.slice(0, 64);
}

export async function prepareModelImport(app: EditorApp, input: ModelImportInput): Promise<ModelImportPlan> {
  const warnings: string[] = [];
  const notes: string[] = [];
  const options = input.options ?? {};
  const container = await parseGlb(input.bytes);
  assertWithinBudget(container);
  const format = detectModelFormat(container.json);
  const skeleton: SkeletonDesc = skeletonFromGltf(container);
  if (!skeleton.nodes.some((node) => node.isJoint)) {
    throw new EkzaError('no-skin', `${input.fileName} has no skinned skeleton to animate`);
  }
  notes.push(...skeleton.warnings);

  // Clips: read only when some are wanted; compressed animation data cannot be edited.
  const names = animationNames(container);
  const wanted = selectClips(names, options.clips, input.defaultClip, warnings);
  let raws: readonly RawClip[] = [];
  if (wanted.length > 0) {
    try {
      raws = readWantedAnimations(container, skeleton, wanted, names);
    } catch (error) {
      if (!(error instanceof EkzaError && error.code === 'compressed-animation') || Array.isArray(options.clips)) {
        throw error;
      }
      warnings.push(
        'The embedded animations are compressed and cannot be edited; the model was imported without clips',
      );
    }
  }

  const characterId = newRecordId(app, 'character');
  const rigId: RigId = newRecordId(app, 'rig');
  // M2a §5.2: limb IK per the user's preference (legs IK, arms FK with IK one click away by default).
  const autoRigIk = app.prefs.getState().autoRigIk;
  const rig = autoRig(
    skeleton,
    { character: characterId, rig: rigId },
    { kind: 'auto', secondary: options.secondaryControls ?? true, ik: { legs: autoRigIk.legs, arms: autoRigIk.arms } },
  );
  const program = compileRig(rig, skeleton);
  for (const warning of program.warnings) {
    if (warning.code !== 'asymmetric-rest' && warning.code !== 'unpaired-mirror') notes.push(warning.message);
  }

  const license = format === 'gltf' ? null : readVrmLicense(container);
  if (isRestrictedLicense(license)) {
    warnings.push(
      "The avatar's licence forbids modification or redistribution: baking clips into it needs an acknowledgement",
    );
  }
  const source = sourceProvenance({
    fileTitle: baseName(input.fileName),
    sha256: container.sha256,
    license,
    ...(input.known === undefined ? {} : { known: input.known }),
  });
  const ext = extensionOf(input.fileName) === 'vrm' || format !== 'gltf' ? 'vrm' : 'glb';
  const asset = await app.services.assets.put(input.bytes, { name: input.fileName, ext, role: 'model' });
  if (app.store.list('characters').some((character) => character.asset === asset.id)) {
    warnings.push(`${input.fileName} is already in the project; it was imported as another character`);
  }

  const sceneFps: Fps = sceneFpsIn(app.store);
  const prefs = app.prefs.getState();
  const clips: ClipWritePlan[] = [];
  const takenNames: string[] = [];
  for (const [n, raw] of raws.entries()) {
    const detected = detectClipFps(raw);
    const resolved = resolveClipOptions({
      name: raw.name,
      detected,
      sceneFps,
      clipFps: options.clipFps,
      keyMode: options.keyMode,
      eulerFilter: options.eulerFilter,
      reduce: options.reduce,
      reducePref: prefs.reduceOnImport,
      defaultReduce: DEFAULT_REDUCE,
      maxChannelKeys: maxChannelKeys(raw),
      duration: raw.duration,
    });
    warnings.push(...resolved.warnings);
    const imported = importRawClip(raw, program, {
      fps: resolved.fps,
      keyMode: resolved.keyMode,
      eulerFilter: resolved.eulerFilter,
      reduce: resolved.reduce,
      ik: 'auto',
    });
    warnings.push(...imported.warnings.map((warning) => `${raw.name}: ${warning}`));
    // M2a §5.8: limbs kept FK say so, first (the import toast shows the first three warnings).
    warnings.unshift(...importLimbWarnings(raw.name, imported));
    const nodeNames = raw.channels.map((channel) => skeleton.nodes[channel.node]?.name ?? '');
    const name = uniqueName(sanitizeClipName(raw.name), takenNames);
    takenNames.push(name);
    clips.push(
      planImportedClip(
        app,
        {
          id: newRecordId(app, 'clip'),
          character: characterId,
          name,
          loop: /loop/i.test(raw.name),
          provenance: clipProvenance(source, [raw.name, ...nodeNames]),
          source: { kind: 'embedded', asset: asset.id, animationIndex: raw.index, animationName: raw.name },
        },
        imported,
      ),
    );
    // Yield between clips: a file with many clips must not freeze the page.
    input.progress?.((n + 1) / raws.length);
    await yieldToHost();
  }
  if (clips.length === 0) {
    clips.push(
      planEmptyClip(app, {
        id: newRecordId(app, 'clip'),
        character: characterId,
        name: numberedName('clip', []),
        fps: sceneFps,
        range: DEFAULT_CLIP_RANGE,
      }),
    );
  }

  // Open the partitions the records land in before the transaction (§4.11.21 opening order).
  await app.store.open('scene');
  await app.store.open(`char:${characterId}`);
  for (const plan of clips) await app.store.open(`clip:${plan.clip.id}`);

  return {
    fileName: input.fileName,
    asset,
    format,
    characterId,
    characterName: characterTitle(input.fileName, license),
    rig,
    height: skeleton.height,
    clips,
    cameraId: newRecordId(app, 'camera'),
    license,
    warnings,
    notes,
  };
}

/** Writes the import plan (one transaction) and activates the new character's first clip at its start. */
export function applyModelImport(app: EditorApp, tx: Tx, plan: ModelImportPlan): ImportResult {
  const existing = tx.list('characters');
  const firstCharacter = existing.length === 0;
  if (tx.get('assets', plan.asset.id) === undefined) tx.put('assets', plan.asset);

  // The first character sets the scene clock, so one character's clip and scene frames coincide (§4.11.8).
  const firstClip = plan.clips[0]?.clip;
  const project = tx.get('project', 'project');
  if (project === undefined) {
    tx.put('project', {
      ...projectRecord(baseName(plan.fileName), firstClip?.fps),
      sceneRange: firstClip?.range ?? DEFAULT_CLIP_RANGE,
    });
  } else if (firstCharacter && firstClip !== undefined) {
    const patch: { sceneFps?: Fps; sceneRange?: { readonly start: number; readonly end: number }; name?: string } = {};
    if (project.sceneFps.num * firstClip.fps.den !== firstClip.fps.num * project.sceneFps.den)
      patch.sceneFps = firstClip.fps;
    if (project.sceneRange.start !== firstClip.range.start || project.sceneRange.end !== firstClip.range.end) {
      patch.sceneRange = firstClip.range;
    }
    if (project.name === 'Untitled') patch.name = baseName(plan.fileName);
    if (Object.keys(patch).length > 0) tx.patch('project', 'project', patch);
  }

  const height = Number.isFinite(plan.height) && plan.height > 0 ? plan.height : 1.7;
  // Next to the right-most character (deleted ones leave gaps rather than overlaps).
  const x =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((character) => character.placement.t[0])) + CHARACTER_SPACING * height;
  tx.put(
    'characters',
    characterRecord({
      id: plan.characterId,
      name: uniqueName(
        plan.characterName,
        existing.map((character) => character.name),
      ),
      asset: plan.asset.id,
      format: plan.format,
      rig: plan.rig.rig.id,
      placement: { t: [x, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      order: orderAfter(existing.map((character) => character.order)),
    }),
  );
  writeRigDefinition(tx, plan.rig);

  if (tx.list('cameras').length === 0) {
    const frame = frameShotCamera(height, x);
    tx.put(
      'cameras',
      cameraRecord({
        id: plan.cameraId,
        name: 'shotCam',
        fovY: SHOT_FOV_Y,
        transform: { t: frame.position, q: frame.quaternion, s: [1, 1, 1] },
        target: frame.target,
        locked: true,
        order: orderAfter([]),
      }),
    );
  }

  const clipIds: ClipId[] = [];
  const orders: string[] = [];
  for (const clipPlan of plan.clips) {
    const order = orderAfter(orders);
    orders.push(order);
    writeClipPlan(tx, clipPlan, { name: clipPlan.clip.name, order });
    clipIds.push(clipPlan.clip.id);
  }

  const first = clipIds[0] === undefined ? undefined : tx.get('clips', clipIds[0]);
  if (first !== undefined) activateClip(app, tx, first, { clearSelection: true });
  else app.session.setState({ activeCharacter: plan.characterId, selection: EMPTY_SELECTION });
  const name = tx.get('project', 'project')?.name;
  if (name !== undefined && name !== app.session.getState().projectName) app.session.setState({ projectName: name });
  return { character: plan.characterId, clips: clipIds, warnings: [...plan.warnings, ...plan.notes] };
}
