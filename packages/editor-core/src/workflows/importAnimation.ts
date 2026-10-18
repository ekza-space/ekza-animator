// Animation import onto an existing character (`file.importAnimation`):
//
// - VRMA (MVP-SPEC §4.11.7): io `readVrma` (three-vrm-animation semantics) → rig `importHumanoidClip` onto the
//   target humanoid (missing/extra bones, hips scaling), one clip.
// - Animation-only GLB (M1-stretch, FR-IO-10): io `readAnimations` over the file's own skeleton → rig
//   `remapRawClipByName` onto the character's skeleton → `importRawClip`, one clip per animation.
//
// `prepare*` read and convert (asset store, partitions); `applyClipImport` writes the clips in the operator's
// transaction and activates the first. A file the Animator wrote keeps its `ekza_animation_v1` provenance.
import { EkzaError, type Fps } from '@ekza-animator/anim-core';
import type { AssetRecord, CharacterId, ClipId, ClipProvenance, ReadView, Tx } from '@ekza-animator/doc';
import { type GlbContainer, parseGlb, readAnimations, readVrma, skeletonFromGltf } from '@ekza-animator/io';
import {
  DEFAULT_REDUCE,
  detectClipFps,
  type HumanoidClipData,
  type ImportedClipKeys,
  importHumanoidClip,
  importRawClip,
  isHumanoidProgram,
  remapRawClipByName,
} from '@ekza-animator/rig';
import { newRecordId } from '../app/internals';
import type { ClipsResult, ImportAnimationOptions } from '../operators/args';
import type { CharacterRuntime, EditorApp } from '../types';
import { type ClipWritePlan, planImportedClip, resolveClipOptions, writeClipPlan } from './clipWrite';
import { yieldToHost } from './host';
import { importLimbWarnings } from './ik';
import { assertWithinBudget } from './importModel';
import { baseName, sanitizeClipName, uniqueName } from './names';
import { animationAndNodeNames, clipProvenance, embeddedEkzaProvenance, sourceProvenance } from './provenance';
import { orderAfter } from './records';
import { activateClip, sceneFpsIn } from './session';
import { maxChannelKeys } from './util';

/** Frame rate of a VRMA whose sample times fit no standard rate (§4.11.7). */
const VRMA_DEFAULT_FPS: Fps = { num: 30, den: 1 };

export interface ClipImportPlan {
  readonly character: CharacterId;
  readonly asset: AssetRecord;
  readonly clips: readonly ClipWritePlan[];
  readonly warnings: readonly string[];
}

interface ImportInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly character: CharacterId;
  readonly options?: Partial<ImportAnimationOptions> | undefined;
}

/** Why `character` cannot receive clips (`humanoid`: VRMA needs a humanoid rig), or null. */
export function animationTargetProblem(
  app: EditorApp,
  character: CharacterId | null,
  humanoid: boolean,
): string | null {
  if (character === null) return humanoid ? 'Load a humanoid character first' : 'Load a character first';
  if (app.store.get('characters', character) === undefined) return 'The character does not exist';
  const runtime = app.characters.get(character);
  if (runtime === undefined) return 'The character is still loading';
  if (humanoid && !isHumanoidProgram(runtime.program)) return 'VRMA clips need a humanoid (VRM) character';
  return null;
}

function requireRuntime(app: EditorApp, character: CharacterId, humanoid: boolean): CharacterRuntime {
  const problem = animationTargetProblem(app, character, humanoid);
  const runtime = app.characters.get(character);
  if (problem !== null || runtime === undefined) throw new EkzaError('unsupported', problem ?? 'No runtime');
  return runtime;
}

const sniffed = new WeakMap<Uint8Array, boolean>();

/**
 * True for a GLB that carries animations but no skin (an animation-only file, not a character). Cached per byte
 * array: importer resolution runs in every poll of `file.open`.
 */
export function isAnimationOnlyGlb(bytes: Uint8Array): boolean {
  let result = sniffed.get(bytes);
  if (result === undefined) {
    result = sniffAnimationOnly(bytes);
    sniffed.set(bytes, result);
  }
  return result;
}

function sniffAnimationOnly(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return false;
  const length = view.getUint32(12, true);
  if (length > bytes.byteLength - 20) return false;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    if (typeof json !== 'object' || json === null) return false;
    const { skins, animations } = json as { readonly skins?: unknown; readonly animations?: unknown };
    const hasSkins = Array.isArray(skins) && skins.length > 0;
    return !hasSkins && Array.isArray(animations) && animations.length > 0;
  } catch {
    return false;
  }
}

function maxKeys(data: HumanoidClipData): number {
  let max = data.hips?.times.length ?? 0;
  for (const track of Object.values(data.rotations)) if (track !== undefined) max = Math.max(max, track.times.length);
  return max;
}

/**
 * A VRMA's provenance (§4.11.6 step 7, ADR 0010 §3): the Animator's own metadata when present, else unknown — forced
 * to 'no' when the clip, any animation or any node of the file is named like Mixamo's (`mixamo.com`, `mixamorig:*`).
 */
function vrmaProvenance(container: GlbContainer, clipName: string, title: string): ClipProvenance {
  return (
    embeddedEkzaProvenance(container) ??
    clipProvenance(sourceProvenance({ fileTitle: title, sha256: container.sha256, license: null }), [
      clipName,
      ...animationAndNodeNames(container),
    ])
  );
}

function storeSource(app: EditorApp, input: ImportInput, ext: 'vrma' | 'glb'): Promise<AssetRecord> {
  return app.services.assets.put(input.bytes, { name: input.fileName, ext, role: 'animation-source' });
}

export async function prepareVrmaImport(app: EditorApp, input: ImportInput): Promise<ClipImportPlan> {
  const runtime = requireRuntime(app, input.character, true);
  const options = input.options ?? {};
  const warnings: string[] = [];
  const container = await parseGlb(input.bytes);
  assertWithinBudget(container);
  const data = readVrma(container);

  const detected = detectClipFps(data);
  const resolved = resolveClipOptions({
    name: data.name,
    detected,
    sceneFps: detected ?? VRMA_DEFAULT_FPS,
    clipFps: options.clipFps,
    keyMode: options.keyMode,
    eulerFilter: options.eulerFilter,
    reduce: options.reduce,
    reducePref: app.prefs.getState().reduceOnImport,
    defaultReduce: DEFAULT_REDUCE,
    maxChannelKeys: maxKeys(data),
    duration: data.duration,
  });
  warnings.push(...resolved.warnings);
  const imported = importHumanoidClip(data, runtime.program, {
    fps: resolved.fps,
    keyMode: resolved.keyMode,
    eulerFilter: resolved.eulerFilter,
    reduce: resolved.reduce,
    hipsScale: options.hipsScale ?? 'auto',
    ik: 'auto',
  });
  warnings.push(...imported.warnings);

  const title = data.name !== '' ? data.name : baseName(input.fileName);
  // M2a §5.8: limbs kept FK for this clip say so, first (the import toast shows the first three warnings).
  warnings.unshift(...importLimbWarnings(title, imported));
  const asset = await storeSource(app, input, 'vrma');
  const clip = planImported(app, input, asset, title, vrmaProvenance(container, data.name, title), imported);
  await app.store.open(`clip:${clip.clip.id}`);
  return { character: input.character, asset, clips: [clip], warnings };
}

function planImported(
  app: EditorApp,
  input: ImportInput,
  asset: AssetRecord,
  name: string,
  provenance: ClipProvenance,
  imported: ImportedClipKeys,
): ClipWritePlan {
  return planImportedClip(
    app,
    {
      id: newRecordId(app, 'clip'),
      character: input.character,
      name: sanitizeClipName(name),
      loop: /loop/i.test(name),
      provenance,
      source: { kind: 'imported', fileName: input.fileName, asset: asset.id },
    },
    imported,
  );
}

/** Animation-only GLB onto any rigged character, matched by node name (FR-IO-10). */
export async function prepareGlbAnimationImport(app: EditorApp, input: ImportInput): Promise<ClipImportPlan> {
  const runtime = requireRuntime(app, input.character, false);
  const options = input.options ?? {};
  const warnings: string[] = [];
  const container = await parseGlb(input.bytes);
  assertWithinBudget(container);
  const source = skeletonFromGltf(container);
  const raws = readAnimations(container, source);
  if (raws.length === 0) throw new EkzaError('unsupported', `${input.fileName} has no animations`);
  const asset = await storeSource(app, input, 'glb');
  const unknown = sourceProvenance({ fileTitle: baseName(input.fileName), sha256: container.sha256, license: null });
  const clips: ClipWritePlan[] = [];
  const taken: string[] = [];
  for (const raw of raws) {
    const { clip: remapped, unmatched } = remapRawClipByName(raw, source, runtime.skeleton);
    if (unmatched.length > 0) {
      warnings.push(
        `${raw.name}: no node named ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ', …' : ''}`,
      );
    }
    if (remapped.channels.length === 0) {
      warnings.push(`${raw.name}: no channel matches the character's skeleton; skipped`);
      continue;
    }
    const resolved = resolveClipOptions({
      name: raw.name,
      detected: detectClipFps(remapped),
      sceneFps: sceneFpsIn(app.store),
      clipFps: options.clipFps,
      keyMode: options.keyMode,
      eulerFilter: options.eulerFilter,
      reduce: options.reduce,
      reducePref: app.prefs.getState().reduceOnImport,
      defaultReduce: DEFAULT_REDUCE,
      maxChannelKeys: maxChannelKeys(remapped),
      duration: remapped.duration,
    });
    warnings.push(...resolved.warnings);
    const imported = importRawClip(remapped, runtime.program, {
      fps: resolved.fps,
      keyMode: resolved.keyMode,
      eulerFilter: resolved.eulerFilter,
      reduce: resolved.reduce,
      ik: 'auto',
    });
    warnings.push(...imported.warnings.map((warning) => `${raw.name}: ${warning}`));
    // M2a §5.8: limbs kept FK say so, first (the import toast shows the first three warnings).
    warnings.unshift(...importLimbWarnings(raw.name, imported));
    const names = [raw.name, ...raw.channels.map((channel) => source.nodes[channel.node]?.name ?? '')];
    const name = uniqueName(sanitizeClipName(raw.name), taken);
    taken.push(name);
    const provenance = embeddedEkzaProvenance(container, raw.index) ?? clipProvenance(unknown, names);
    clips.push(planImported(app, input, asset, name, provenance, imported));
    await yieldToHost();
  }
  if (clips.length === 0) throw new EkzaError('unsupported', `No animation of ${input.fileName} fits the character`);
  for (const plan of clips) await app.store.open(`clip:${plan.clip.id}`);
  return { character: input.character, asset, clips, warnings };
}

/** Writes imported clips (unique names, after the character's clips) and makes the first one active. */
export function applyClipImport(app: EditorApp, tx: Tx, plan: ClipImportPlan): ClipsResult {
  // The file was read asynchronously: the character may have gone meanwhile (undo, delete).
  if (tx.get('characters', plan.character) === undefined) {
    throw new EkzaError('invalid-record', 'The character was removed while the file was being read');
  }
  if (tx.get('assets', plan.asset.id) === undefined) tx.put('assets', plan.asset);
  const names = tx.query.clipsOfCharacter(plan.character).map((clip) => clip.name);
  const orders = tx.query.clipsOfCharacter(plan.character).map((clip) => clip.order);
  const ids: ClipId[] = [];
  for (const clip of plan.clips) {
    const name = uniqueName(clip.clip.name, names);
    const order = orderAfter(orders);
    writeClipPlan(tx, clip, { name, order });
    names.push(name);
    orders.push(order);
    ids.push(clip.clip.id);
  }
  const first = ids[0] === undefined ? undefined : tx.get('clips', ids[0]);
  if (first !== undefined) activateClip(app, tx, first);
  return { clips: ids, warnings: plan.warnings };
}

/** The character a clip import targets: the given one, else the active one. */
export function importTarget(
  view: ReadView,
  explicit: CharacterId | undefined,
  active: CharacterId | null,
): CharacterId | null {
  const id = explicit ?? active;
  return id !== null && view.get('characters', id) !== undefined ? id : null;
}
