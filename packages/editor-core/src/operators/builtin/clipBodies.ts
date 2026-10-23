// The apply bodies of the clip operators that open partitions in `prepare` (`clip.ts`; MVP-SPEC §4.9 `clip.*`): a
// lazy chunk of its own (M-AI B5, `check:size`), loaded by those `prepare`s. The bodies are the shipped ones, moved
// unchanged.
import { EkzaError } from '@ekza-studio/anim-core';
import type {
  CharacterId,
  ClipId,
  ClipProvenance,
  ClipRecord,
  CurveId,
  DerivedFrom,
  LayerId,
  Tx,
} from '@ekza-studio/doc';
import { newRecordId } from '../../app/internals';
import type { ApplyContext, OperatorArgs } from '../../types';
import { planEmptyClip, writeClipPlan } from '../../workflows/clipWrite';
import { CLIP_NAME_MAX, numberedName, uniqueName } from '../../workflows/names';
import { DEFAULT_CLIP_RANGE, orderAfter, orderBetween } from '../../workflows/records';
import { activateClip, sceneFpsIn } from '../../workflows/session';
import { sameFps } from '../../workflows/util';
import type { ClipSettingsArgs } from '../args';
import { clampedSceneFrame, finalRange, rescaleRatio, withoutKeys } from './clip';
import { isActorRun } from './define';

function siblingsOf(tx: Tx, character: CharacterId): readonly ClipRecord[] {
  return tx.query.clipsOfCharacter(character);
}

/** `<name> copy`, kept within the name limit and unique among the character's clips. */
function copyName(name: string, siblings: readonly ClipRecord[]): string {
  const suffix = ' copy';
  const base = `${name.slice(0, CLIP_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  return uniqueName(
    base,
    siblings.map((clip) => clip.name),
  );
}

/**
 * Rescales every key of a clip by `ratio` (times and handle `dt`, so slopes per second are kept): the keys of each
 * canonical curve, duplicates' keys included (`keysOfCurve` unions them, `hiddenKeys` has the time collisions).
 */
function rescaleKeys(tx: Tx, clip: ClipId, ratio: number): void {
  const keys = tx.query
    .curvesOfClip(clip)
    .flatMap((curve) => [...tx.query.keysOfCurve(curve.id), ...tx.query.hiddenKeys(curve.id)]);
  for (const key of keys) {
    tx.put('keys', {
      ...key,
      t: key.t * ratio,
      inHandle: { dt: key.inHandle.dt * ratio, dv: key.inHandle.dv },
      outHandle: { dt: key.outHandle.dt * ratio, dv: key.outHandle.dv },
    });
  }
}

export function clipNew({ app, tx }: ApplyContext, args: OperatorArgs<'clip.new'>, prepared: { readonly id: ClipId }) {
  if (tx === null) throw new EkzaError('internal', 'clip.new runs in a transaction');
  const options = args ?? {};
  const character = options.character ?? app.session.getState().activeCharacter;
  if (character === null) throw new EkzaError('unsupported', 'Load a character first');
  const siblings = siblingsOf(tx, character);
  const plan = planEmptyClip(app, {
    id: prepared.id,
    character,
    name:
      options.name ??
      numberedName(
        'clip',
        siblings.map((clip) => clip.name),
      ),
    fps: options.fps ?? sceneFpsIn(tx),
    range: options.range ?? DEFAULT_CLIP_RANGE,
  });
  writeClipPlan(tx, plan, { name: plan.clip.name, order: orderAfter(siblings.map((clip) => clip.order)) });
  // A new clip has no curves yet: keying it later creates curves with the loop clip's cycle infinities (§5.23).
  if (options.loop === true && tx.get('clips', prepared.id)?.loop !== true)
    tx.patch('clips', prepared.id, { loop: true });
  const written = tx.get('clips', prepared.id);
  if (written !== undefined && options.activate !== false) activateClip(app, tx, written);
  return { clip: prepared.id };
}

export function clipDuplicate(
  { app, tx }: ApplyContext,
  args: OperatorArgs<'clip.duplicate'>,
  prepared: { readonly id: ClipId },
) {
  if (tx === null) throw new EkzaError('internal', 'clip.duplicate runs in a transaction');
  const source = tx.get('clips', args.clip);
  if (source === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
  const siblings = siblingsOf(tx, source.character);
  tx.put('clips', {
    ...source,
    id: prepared.id,
    name: args.name ?? copyName(source.name, siblings),
    order: orderBetween(
      source.order,
      siblings.map((clip) => clip.order),
    ),
    deleted: null,
  });
  const layers = new Map<LayerId, LayerId>();
  for (const layer of tx.query.layersOfClip(source.id)) {
    const id = newRecordId(app, 'layer');
    layers.set(layer.id, id);
    tx.put('layers', { ...layer, id, clip: prepared.id });
  }
  const curves = new Map<CurveId, CurveId>();
  for (const curve of tx.query.curvesOfClip(source.id)) {
    const layer = layers.get(curve.layer);
    if (layer === undefined) continue;
    const id = newRecordId(app, 'curve');
    curves.set(curve.id, id);
    tx.put('curves', { ...curve, id, clip: prepared.id, layer });
  }
  for (const [from, to] of curves) {
    for (const key of tx.query.keysOfCurve(from)) {
      tx.put('keys', { ...key, id: newRecordId(app, 'key'), clip: prepared.id, curve: to });
    }
  }
  // MCP-SPEC §4.10: `activate: true` makes the copy the active clip (at its start, like `clip.new`); default false
  // for duplicates keeps the shipped behaviour (the source stays active).
  const copy = tx.get('clips', prepared.id);
  if (args.activate === true && copy !== undefined) activateClip(app, tx, copy);
  return { clip: prepared.id };
}

export function clipDelete(
  ctx: ApplyContext,
  args: OperatorArgs<'clip.delete'>,
  prepared: { readonly replacement: ClipId | null },
) {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('internal', 'clip.delete runs in a transaction');
  const clip = tx.get('clips', args.clip);
  if (clip === undefined) return;
  const siblings = siblingsOf(tx, clip.character);
  const index = siblings.findIndex((c) => c.id === clip.id);
  tx.softDelete('clips', clip.id);
  let next: ClipRecord | undefined = siblings[index + 1] ?? siblings[index - 1];
  if (next === undefined || next.id === clip.id) {
    const id = prepared.replacement ?? newRecordId(app, 'clip');
    const plan = planEmptyClip(app, {
      id,
      character: clip.character,
      name: numberedName('clip', []),
      fps: sceneFpsIn(tx),
      range: DEFAULT_CLIP_RANGE,
    });
    writeClipPlan(tx, plan, { name: plan.clip.name, order: orderAfter([clip.order]) });
    next = tx.get('clips', id);
  }
  // MCP-SPEC §4.10: an agent run never writes the session; when it deleted the user's active clip, the session
  // keeper re-points `activeClip` after the commit (a kernel reaction the tool reports as a warning).
  if (isActorRun(ctx)) return;
  const state = app.session.getState();
  if (next !== undefined && state.activeClip[clip.character] === clip.id) {
    const activeClip = { ...state.activeClip, [clip.character]: next.id };
    // The timeline and Graph Editor show the active character's clip: keep the frame inside the new clip's range
    // and drop the key selection (keys of the deleted clip). Another character's switch changes nothing on screen.
    app.session.setState(
      clip.character === state.activeCharacter
        ? {
            activeClip,
            time: { ...state.time, sceneFrame: clampedSceneFrame(app, next), band: null },
            selection: withoutKeys(state.selection),
          }
        : { activeClip },
    );
  }
}

export function clipSetSettings({ tx }: ApplyContext, args: ClipSettingsArgs) {
  if (tx === null) throw new EkzaError('internal', 'clip.setSettings runs in a transaction');
  const clip = tx.get('clips', args.clip);
  if (clip === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
  const patch: { -readonly [K in keyof ClipRecord]?: ClipRecord[K] } = {};
  const range = finalRange(clip, args);
  let contact = clip.contact;
  if (args.fps !== undefined && !sameFps(args.fps, clip.fps)) {
    patch.fps = args.fps;
    const ratio = rescaleRatio(clip, args);
    if (ratio !== null) {
      rescaleKeys(tx, clip.id, ratio);
      if (contact !== null) contact = Math.round(contact * ratio);
    }
  }
  if (args.contact !== undefined) contact = args.contact;
  if (contact !== null) contact = Math.min(Math.max(contact, range.start), range.end);
  if (range.start !== clip.range.start || range.end !== clip.range.end) patch.range = range;
  if (contact !== clip.contact) patch.contact = contact;
  if (args.sceneStart !== undefined && args.sceneStart !== clip.sceneStart) patch.sceneStart = args.sceneStart;
  if (args.loop !== undefined && args.loop !== clip.loop) patch.loop = args.loop;
  if (args.rootMotion !== undefined && args.rootMotion !== clip.rootMotion) patch.rootMotion = args.rootMotion;
  if (args.slot !== undefined && args.slot !== clip.slot) patch.slot = args.slot;
  if (args.tags !== undefined && JSON.stringify(args.tags) !== JSON.stringify(clip.tags)) patch.tags = [...args.tags];
  if (args.provenance !== undefined) {
    const provenance: ClipProvenance = {
      derivedFrom: args.provenance.derivedFrom?.map((d: DerivedFrom) => ({ ...d })) ?? clip.provenance.derivedFrom,
      redistributable: args.provenance.redistributable ?? clip.provenance.redistributable,
    };
    if (JSON.stringify(provenance) !== JSON.stringify(clip.provenance)) patch.provenance = provenance;
  }
  if (Object.keys(patch).length > 0) tx.patch('clips', clip.id, patch);
}
