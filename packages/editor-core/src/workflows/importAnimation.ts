// VRMA import (MVP-SPEC §4.11.7): a `.vrma` becomes a new clip on a humanoid character. `prepareVrmaImport` reads
// the file (io `readVrma`, following three-vrm-animation), converts it onto the character's rig (rig
// `importHumanoidClip`: missing/extra bones, hips scaling) and stores the source bytes; `applyClipImport` writes the
// clip in the operator's transaction and makes it active.
import { EkzaError, type Fps } from '@ekza-animator/anim-core';
import type { AssetRecord, CharacterId, ClipId, ReadView, Tx } from '@ekza-animator/doc';
import { parseGlb, readVrma } from '@ekza-animator/io';
import {
  DEFAULT_REDUCE,
  detectClipFps,
  type HumanoidClipData,
  importHumanoidClip,
  isHumanoidProgram,
} from '@ekza-animator/rig';
import { newRecordId } from '../app/internals';
import type { ClipsResult, ImportAnimationOptions } from '../operators/args';
import type { EditorApp } from '../types';
import { type ClipWritePlan, planImportedClip, resolveClipOptions, writeClipPlan } from './clipWrite';
import { assertWithinBudget } from './importModel';
import { baseName, sanitizeClipName, uniqueName } from './names';
import { embeddedEkzaProvenance, sourceProvenance } from './provenance';
import { orderAfter } from './records';
import { activateClip } from './session';

/** Frame rate of a VRMA whose sample times fit no standard rate (§4.11.7). */
const VRMA_DEFAULT_FPS: Fps = { num: 30, den: 1 };

export interface ClipImportPlan {
  readonly character: CharacterId;
  readonly asset: AssetRecord;
  readonly clip: ClipWritePlan;
  readonly warnings: readonly string[];
}

function maxKeys(data: HumanoidClipData): number {
  let max = data.hips?.times.length ?? 0;
  for (const track of Object.values(data.rotations)) if (track !== undefined) max = Math.max(max, track.times.length);
  return max;
}

/** Why `character` cannot receive a humanoid clip, or null. */
export function humanoidTargetProblem(app: EditorApp, character: CharacterId | null): string | null {
  if (character === null) return 'Load a humanoid character first';
  if (app.store.get('characters', character) === undefined) return 'The character does not exist';
  const runtime = app.characters.get(character);
  if (runtime === undefined) return 'The character is still loading';
  if (!isHumanoidProgram(runtime.program)) return 'VRMA clips need a humanoid (VRM) character';
  return null;
}

export async function prepareVrmaImport(
  app: EditorApp,
  input: {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly character: CharacterId;
    readonly options?: Partial<ImportAnimationOptions> | undefined;
  },
): Promise<ClipImportPlan> {
  const problem = humanoidTargetProblem(app, input.character);
  const runtime = app.characters.get(input.character);
  if (problem !== null || runtime === undefined) throw new EkzaError('unsupported', problem ?? 'No runtime');
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
  });
  warnings.push(...imported.warnings);

  const provenance =
    embeddedEkzaProvenance(container) ??
    sourceProvenance({
      fileTitle: data.name !== '' ? data.name : baseName(input.fileName),
      sha256: container.sha256,
      license: null,
    });
  const asset = await app.services.assets.put(input.bytes, {
    name: input.fileName,
    ext: 'vrma',
    role: 'animation-source',
  });
  const clipId: ClipId = newRecordId(app, 'clip');
  const clip = planImportedClip(
    app,
    {
      id: clipId,
      character: input.character,
      name: sanitizeClipName(data.name !== '' ? data.name : baseName(input.fileName)),
      loop: /loop/i.test(data.name),
      provenance,
      source: { kind: 'imported', fileName: input.fileName, asset: asset.id },
    },
    imported,
  );
  await app.store.open(`clip:${clipId}`);
  return { character: input.character, asset, clip, warnings };
}

/** Writes an imported clip (unique name, last in order) and makes it the character's active clip. */
export function applyClipImport(app: EditorApp, tx: Tx, plan: ClipImportPlan): ClipsResult {
  if (tx.get('assets', plan.asset.id) === undefined) tx.put('assets', plan.asset);
  const siblings = tx.query.clipsOfCharacter(plan.character);
  writeClipPlan(tx, plan.clip, {
    name: uniqueName(
      plan.clip.clip.name,
      siblings.map((clip) => clip.name),
    ),
    order: orderAfter(siblings.map((clip) => clip.order)),
  });
  const written = tx.get('clips', plan.clip.clip.id);
  if (written !== undefined) activateClip(app, tx, written);
  return { clips: [plan.clip.clip.id], warnings: plan.warnings };
}

/** The character a clip import targets: the given one, else the active one. */
export function importTarget(view: ReadView, explicit: CharacterId | undefined, active: CharacterId | null) {
  const id = explicit ?? active;
  return id !== null && view.get('characters', id) !== undefined ? id : null;
}
