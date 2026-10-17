// Clip operators (MVP-SPEC §4.9 `clip.*`): several named clips per character. New clips and duplicates get their
// IDs in `prepare`, where their partition (`clip:<id>`) is opened before the transaction writes into it (§4.11.21).
import { EkzaError, type Fps, type Frame } from '@ekza-animator/anim-core';
import type {
  CharacterId,
  ClipId,
  ClipProvenance,
  ClipRecord,
  CurveId,
  DerivedFrom,
  LayerId,
  Redistributable,
  RootMotionMode,
  Tx,
} from '@ekza-animator/doc';
import { newRecordId } from '../../app/internals';
import { type EditorApp, GLOBAL_SCOPE } from '../../types';
import { planEmptyClip, writeClipPlan } from '../../workflows/clipWrite';
import { clipNameTaken } from '../../workflows/importModel';
import {
  CLIP_NAME_MAX,
  clipNameProblem,
  numberedName,
  slotProblem,
  tagsProblem,
  uniqueName,
} from '../../workflows/names';
import { DEFAULT_CLIP_RANGE, orderAfter, orderBetween } from '../../workflows/records';
import { activateClip, clipFrameOfScene, sceneFpsIn, sceneFrameOf } from '../../workflows/session';
import type { ClipSettingsArgs } from '../args';
import { type AnyOperator, all, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { pollEditable } from './polls';

const REDISTRIBUTABLE: readonly Redistributable[] = ['yes', 'no', 'unknown'];
const ROOT_MOTION: readonly RootMotionMode[] = ['hips', 'in-place'];

function fpsProblem(fps: unknown): string | null {
  if (!isRecord(fps)) return 'fps is { num, den }';
  const { num, den } = fps;
  if (!Number.isInteger(num) || !Number.isInteger(den) || (num as number) <= 0 || (den as number) <= 0) {
    return 'fps num and den must be positive integers';
  }
  return null;
}

function rangeProblem(range: unknown): string | null {
  if (!isRecord(range)) return 'range is { start, end }';
  const { start, end } = range;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'range start and end must be whole frames';
  return (start as number) < (end as number) ? null : 'range start must be before its end';
}

function clipOf(app: EditorApp, args: unknown): ClipRecord | null {
  if (!isRecord(args) || typeof args['clip'] !== 'string') return null;
  return app.store.get('clips', args['clip'] as ClipId) ?? null;
}

function pollClipArg(app: EditorApp, args: unknown) {
  if (!isRecord(args) || typeof args['clip'] !== 'string') return fail('expects { clip }');
  return clipOf(app, args) === null ? fail('The clip does not exist') : OK;
}

function siblingsOf(tx: Tx, character: CharacterId): readonly ClipRecord[] {
  return tx.query.clipsOfCharacter(character);
}

// ---------- new ----------

const clipNew = defineOperator<'clip.new', { readonly id: ClipId }>({
  id: 'clip.new',
  label: 'New Clip',
  description: 'Add an empty clip to the character and make it active.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'New Clip',
  poll({ app }, args) {
    const options = optionalArgs(args);
    if (options === null) return fail('expects { character?, name?, fps?, range? }');
    const character = (options['character'] as CharacterId | undefined) ?? app.session.getState().activeCharacter;
    if (character === null) return fail('Load a character first');
    if (typeof character !== 'string' || app.store.get('characters', character) === undefined) {
      return fail('The character does not exist');
    }
    if (options['name'] !== undefined) {
      const problem = clipNameProblem(options['name']);
      if (problem !== null) return fail(problem);
      if (clipNameTaken(app.store, character, options['name'] as string)) return fail('A clip with that name exists');
    }
    if (options['fps'] !== undefined) {
      const problem = fpsProblem(options['fps']);
      if (problem !== null) return fail(problem);
    }
    if (options['range'] !== undefined) {
      const problem = rangeProblem(options['range']);
      if (problem !== null) return fail(problem);
    }
    return pollEditable(app);
  },
  async prepare({ app }) {
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { id };
  },
  apply({ app, tx }, args, prepared) {
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
    const written = tx.get('clips', prepared.id);
    if (written !== undefined) activateClip(app, tx, written);
    return { clip: prepared.id };
  },
});

// ---------- rename ----------

const clipRename = defineOperator({
  id: 'clip.rename',
  label: 'Rename Clip',
  description: 'Rename a clip (letters, digits, spaces and . _ -, at most 64 characters).',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Rename Clip',
  poll({ app }, args) {
    const base = pollClipArg(app, args);
    if (base !== true) return base;
    const clip = clipOf(app, args) as ClipRecord;
    const name = (args as { readonly name?: unknown }).name;
    const problem = clipNameProblem(name);
    if (problem !== null) return fail(problem);
    if (clipNameTaken(app.store, clip.character, name as string, clip.id)) return fail('A clip with that name exists');
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'clip.rename runs in a transaction');
    const clip = tx.get('clips', args.clip);
    if (clip !== undefined && clip.name !== args.name) tx.patch('clips', clip.id, { name: args.name });
  },
});

// ---------- duplicate ----------

/** `<name> copy`, kept within the name limit and unique among the character's clips. */
function copyName(name: string, siblings: readonly ClipRecord[]): string {
  const suffix = ' copy';
  const base = `${name.slice(0, CLIP_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  return uniqueName(
    base,
    siblings.map((clip) => clip.name),
  );
}

const clipDuplicate = defineOperator<'clip.duplicate', { readonly id: ClipId }>({
  id: 'clip.duplicate',
  label: 'Duplicate Clip',
  description: 'Copy a clip with its layers, curves, keys and provenance.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Duplicate Clip',
  poll: ({ app }, args) => all(pollClipArg(app, args), pollEditable(app)),
  async prepare({ app }, args) {
    await app.store.open(`clip:${args.clip}`);
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { id };
  },
  apply({ app, tx }, args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'clip.duplicate runs in a transaction');
    const source = tx.get('clips', args.clip);
    if (source === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
    const siblings = siblingsOf(tx, source.character);
    tx.put('clips', {
      ...source,
      id: prepared.id,
      name: copyName(source.name, siblings),
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
    return { clip: prepared.id };
  },
});

// ---------- delete ----------

const clipDelete = defineOperator<'clip.delete', { readonly replacement: ClipId | null }>({
  id: 'clip.delete',
  label: 'Delete Clip',
  description: 'Delete a clip (undoable); another clip becomes active, or a new empty one is created.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Delete Clip',
  poll: ({ app }, args) => all(pollClipArg(app, args), pollEditable(app)),
  async prepare({ app }, args) {
    const clip = app.store.get('clips', args.clip);
    if (clip === undefined) return { replacement: null };
    const others = app.store.query.clipsOfCharacter(clip.character).filter((c) => c.id !== clip.id);
    if (others.length > 0) return { replacement: null };
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { replacement: id };
  },
  apply({ app, tx }, args, prepared) {
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
    const state = app.session.getState();
    if (next !== undefined && state.activeClip[clip.character] === clip.id) {
      app.session.setState({ activeClip: { ...state.activeClip, [clip.character]: next.id } });
    }
  },
});

// ---------- set active ----------

/** Scene frame that shows `clip` inside its range: the current one when it does, else the nearest range end. */
function clampedSceneFrame(app: EditorApp, clip: ClipRecord): Frame {
  const fps = sceneFpsIn(app.store);
  const sceneFrame = app.session.getState().time.sceneFrame;
  const frame = clipFrameOfScene(app, fps, clip, sceneFrame);
  const clamped = Math.min(Math.max(frame, clip.range.start), clip.range.end);
  return clamped === frame ? sceneFrame : sceneFrameOf(app, fps, clip, clamped);
}

const clipSetActive = defineOperator({
  id: 'clip.setActive',
  label: 'Set Active Clip',
  description: 'Edit and play another clip of the character.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll: ({ app }, args) => pollClipArg(app, args),
  async prepare({ app }, args) {
    await app.store.open(`clip:${args.clip}`);
  },
  apply({ app }, args) {
    const clip = app.store.get('clips', args.clip);
    if (clip === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
    const state = app.session.getState();
    const sceneFrame = clampedSceneFrame(app, clip);
    app.session.setState({
      activeCharacter: clip.character,
      activeClip: { ...state.activeClip, [clip.character]: clip.id },
      time: { ...state.time, sceneFrame, band: null },
    });
  },
});

// ---------- settings ----------

function derivedFromProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'provenance.derivedFrom must be a list';
  for (const entry of value as readonly unknown[]) {
    if (!isRecord(entry)) return 'provenance sources are { title, author, license, sourceSha256 }';
    const { title, author, license, sourceSha256 } = entry;
    if (typeof title !== 'string' || typeof author !== 'string' || typeof license !== 'string') {
      return 'provenance sources need a title, author and licence';
    }
    if (sourceSha256 !== null && (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceSha256))) {
      return 'sourceSha256 is a lowercase SHA-256 or null';
    }
  }
  return null;
}

/** Why the settings cannot apply to `clip`, or null (shape and value rules, §4.2 `ClipRecord`, ADR 0010). */
export function settingsProblem(clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  if (args['fps'] !== undefined) {
    const problem = fpsProblem(args['fps']);
    if (problem !== null) return problem;
  }
  if (args['fpsMode'] !== undefined && args['fpsMode'] !== 'keep-seconds' && args['fpsMode'] !== 'keep-frames') {
    return "fpsMode is 'keep-seconds' or 'keep-frames'";
  }
  if (args['range'] !== undefined) {
    const problem = rangeProblem(args['range']);
    if (problem !== null) return problem;
  }
  if (args['sceneStart'] !== undefined && !isFiniteNumber(args['sceneStart'])) return 'sceneStart must be a number';
  if (args['loop'] !== undefined && typeof args['loop'] !== 'boolean') return 'loop must be a boolean';
  if (args['rootMotion'] !== undefined && !ROOT_MOTION.includes(args['rootMotion'] as RootMotionMode)) {
    return "rootMotion is 'hips' or 'in-place'";
  }
  if (args['slot'] !== undefined) {
    const problem = slotProblem(args['slot']);
    if (problem !== null) return problem;
  }
  if (args['tags'] !== undefined) {
    const problem = tagsProblem(args['tags']);
    if (problem !== null) return problem;
  }
  if (args['contact'] !== undefined && args['contact'] !== null) {
    if (!isFiniteNumber(args['contact'])) return 'contact must be a frame or null';
    const range = (args['range'] as ClipRecord['range'] | undefined) ?? clip.range;
    if (args['contact'] < range.start || args['contact'] > range.end) return 'contact must lie inside the clip range';
  }
  const provenance = args['provenance'];
  if (provenance !== undefined) {
    if (!isRecord(provenance)) return 'provenance is { derivedFrom?, redistributable? }';
    if (provenance['derivedFrom'] !== undefined) {
      const problem = derivedFromProblem(provenance['derivedFrom']);
      if (problem !== null) return problem;
    }
    const redistributable = provenance['redistributable'];
    if (redistributable !== undefined && !REDISTRIBUTABLE.includes(redistributable as Redistributable)) {
      return "redistributable is 'yes', 'no' or 'unknown'";
    }
  }
  return null;
}

function fpsEqual(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/** Rescales every key of a clip by `ratio` (times and handle `dt`, so slopes per second are kept). */
function rescaleKeys(tx: Tx, clip: ClipId, ratio: number): void {
  for (const key of tx.list('keys')) {
    if (key.clip !== clip) continue;
    tx.put('keys', {
      ...key,
      t: key.t * ratio,
      inHandle: { dt: key.inHandle.dt * ratio, dv: key.inHandle.dv },
      outHandle: { dt: key.outHandle.dt * ratio, dv: key.outHandle.dv },
    });
  }
}

const clipSetSettings = defineOperator({
  id: 'clip.setSettings',
  label: 'Clip Settings',
  description: 'Frame rate, range, scene start, loop, root motion, Ekza slot, contact frame, tags and provenance.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, structural: true, internal: true },
  undoLabel: () => 'Clip Settings',
  poll({ app }, args) {
    const base = pollClipArg(app, args);
    if (base !== true) return base;
    const problem = settingsProblem(
      clipOf(app, args) as ClipRecord,
      args as unknown as Readonly<Record<string, unknown>>,
    );
    return problem === null ? pollEditable(app) : fail(problem);
  },
  async prepare({ app }, args) {
    // A frame-rate change rescales the clip's keys: they must be loaded.
    await app.store.open(`clip:${args.clip}`);
  },
  apply({ tx }, args: ClipSettingsArgs) {
    if (tx === null) throw new EkzaError('internal', 'clip.setSettings runs in a transaction');
    const clip = tx.get('clips', args.clip);
    if (clip === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
    const patch: { -readonly [K in keyof ClipRecord]?: ClipRecord[K] } = {};
    let range = clip.range;
    let contact = clip.contact;
    if (args.fps !== undefined && !fpsEqual(args.fps, clip.fps)) {
      patch.fps = args.fps;
      if ((args.fpsMode ?? 'keep-seconds') === 'keep-seconds') {
        const ratio = args.fps.num / args.fps.den / (clip.fps.num / clip.fps.den);
        rescaleKeys(tx, clip.id, ratio);
        const start = Math.round(range.start * ratio);
        range = { start, end: Math.max(start + 1, Math.round(range.end * ratio)) };
        if (contact !== null) contact = Math.round(contact * ratio);
      }
    }
    if (args.range !== undefined) range = args.range;
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
  },
});

export const CLIP_OPERATORS: readonly AnyOperator[] = [
  clipNew,
  clipRename,
  clipDuplicate,
  clipDelete,
  clipSetActive,
  clipSetSettings,
];
