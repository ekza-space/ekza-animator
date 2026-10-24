// Animation import onto an existing character (`file.importAnimation`):
//
// - VRMA (MVP-SPEC §4.11.7): io `readVrma` (three-vrm-animation semantics) → rig `importHumanoidClip` onto the
//   target humanoid (missing/extra bones, hips scaling), one clip.
// - Animation-only GLB (M1-stretch, FR-IO-10): io `readAnimations` over the file's own skeleton → rig
//   `remapRawClipByName` onto the character's skeleton → `importRawClip`, one clip per animation.
//
// `prepare*` read and convert (asset store, partitions); `applyClipImport` writes the clips in the operator's
// transaction and activates the first. A file the editor wrote keeps its `ekza_animation_v1` provenance.
import { EkzaError, type Fps } from '@ekza-studio/anim-core';
import type { AssetRecord, CharacterId, ClipId, ClipProvenance, Tx } from '@ekza-studio/doc';
import { type GlbContainer, parseGlb, readAnimations, readVrma, skeletonFromGltf } from '@ekza-studio/io';
import {
  DEFAULT_REDUCE,
  detectClipFps,
  type HumanoidClipData,
  type ImportedClipKeys,
  importHumanoidClip,
  importRawClip,
  remapRawClipByName,
} from '@ekza-studio/rig';
import { newRecordId } from '../app/internals';
import type { ClipsResult, ImportAnimationOptions } from '../operators/args';
import type { CharacterRuntime, EditorApp } from '../types';
import { type ClipWritePlan, planImportedClip, resolveClipOptions, writeClipPlan } from './clipWrite';
import { embeddedClipSettings, withRestoredSettings, writeRestoredMarkers } from './ekzaClipRestore';
import { embeddedEkzaLoop } from './ekzaLoop';
import { yieldToHost } from './host';
import { importLimbWarnings } from './ik';
import { assertWithinBudget } from './importModel';
import { baseName, sanitizeClipName, uniqueName } from './names';
import { animationAndNodeNames, clipProvenance, embeddedEkzaProvenance, sourceProvenance } from './provenance';
import { orderAfter } from './records';
import { activateClip, sceneFpsIn } from './session';
import { maxChannelKeys } from './util';
import { animationTargetProblem } from './importChecks';

export { animationTargetProblem, importTarget, isAnimationOnlyGlb } from './importChecks';

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

function requireRuntime(app: EditorApp, character: CharacterId, humanoid: boolean): CharacterRuntime {
  const problem = animationTargetProblem(app, character, humanoid);
  const runtime = app.characters.get(character);
  if (problem !== null || runtime === undefined) throw new EkzaError('unsupported', problem ?? 'No runtime');
  return runtime;
}

function maxKeys(data: HumanoidClipData): number {
  let max = data.hips?.times.length ?? 0;
  for (const track of Object.values(data.rotations)) if (track !== undefined) max = Math.max(max, track.times.length);
  return max;
}

/**
 * A VRMA's provenance (§4.11.6 step 7, ADR 0010 §3): the editor's own metadata when present, else unknown — forced
 * to 'no' when the clip, any animation or any node of the file carries a web auto-rigging service's marker
 * (`isNonRedistributableSource`).
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
  const clip = withRestoredSettings(
    planImported(app, input, asset, title, vrmaProvenance(container, data.name, title), imported),
    embeddedClipSettings(container),
  );
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
  loop: boolean | null = null,
): ClipWritePlan {
  return planImportedClip(
    app,
    {
      id: newRecordId(app, 'clip'),
      character: input.character,
      name: sanitizeClipName(name),
      loop: loop ?? /loop/i.test(name),
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
    clips.push(
      withRestoredSettings(
        planImported(app, input, asset, name, provenance, imported, embeddedEkzaLoop(container, raw.index)),
        embeddedClipSettings(container, raw.index),
      ),
    );
    await yieldToHost();
  }
  if (clips.length === 0) throw new EkzaError('unsupported', `No animation of ${input.fileName} fits the character`);
  for (const plan of clips) await app.store.open(`clip:${plan.clip.id}`);
  return { character: input.character, asset, clips, warnings };
}

/**
 * Writes imported clips (unique names, after the character's clips) and makes the first one active, unless
 * `activate: false` (MCP-SPEC §4.10, agent imports: the session's active character and clip stay).
 */
export function applyClipImport(
  app: EditorApp,
  tx: Tx,
  plan: ClipImportPlan,
  opts?: { readonly activate?: boolean },
): ClipsResult {
  // The file was read asynchronously: the character may have gone meanwhile (undo, delete).
  if (tx.get('characters', plan.character) === undefined) {
    throw new EkzaError('invalid-record', 'The character was removed while the file was being read');
  }
  if (tx.get('assets', plan.asset.id) === undefined) tx.put('assets', plan.asset);
  const names = tx.query.clipsOfCharacter(plan.character).map((clip) => clip.name);
  const orders = tx.query.clipsOfCharacter(plan.character).map((clip) => clip.order);
  // §8.14 (C2): a restored slot stays only while no other live clip of the character holds it
  const slots = new Set(
    tx.query
      .clipsOfCharacter(plan.character)
      .filter((clip) => clip.deleted === null)
      .map((clip) => clip.slot),
  );
  const ids: ClipId[] = [];
  for (const planned of plan.clips) {
    const taken = planned.clip.slot !== null && slots.has(planned.clip.slot);
    const clip = taken ? { ...planned, clip: { ...planned.clip, slot: null } } : planned;
    slots.add(clip.clip.slot);
    const name = uniqueName(clip.clip.name, names);
    const order = orderAfter(orders);
    writeClipPlan(tx, clip, { name, order });
    writeRestoredMarkers(tx, clip.clip, (planned as { readonly markers?: Readonly<Record<string, number>> }).markers);
    names.push(name);
    orders.push(order);
    ids.push(clip.clip.id);
  }
  const first = ids[0] === undefined ? undefined : tx.get('clips', ids[0]);
  if (first !== undefined && opts?.activate !== false) activateClip(app, tx, first);
  return { clips: ids, warnings: plan.warnings };
}
