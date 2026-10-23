// Clip operators (MVP-SPEC §4.9 `clip.*`): several named clips per character. New clips and duplicates get their
// IDs in `prepare`, where their partition (`clip:<id>`) is opened before the transaction writes into it (§4.11.21).
// MCP-SPEC §4.10 (P1): `clip.new {loop, activate}`, `clip.duplicate {name, activate}` (`activate: false` leaves the
// session alone; default true, the shipped behaviour), and `clip.delete` under an agent run never writes the session
// (the session keeper re-points a deleted active clip after the commit).
import { EkzaError, type Frame } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ClipRecord, Redistributable, RootMotionMode } from '@ekza-studio/doc';
import { newRecordId } from '../../app/internals';
import { type EditorApp, GLOBAL_SCOPE, type Selection } from '../../types';
import { clipNameTaken } from '../../workflows/importChecks';
import { clipNameProblem, slotProblem, tagsProblem } from '../../workflows/names';
import { clipFrameOfScene, EMPTY_SELECTION, sceneFpsIn, sceneFrameOf } from '../../workflows/session';
import { derivedFromProblem, fpsValue, sameFps } from '../../workflows/util';
import type { ClipSettingsArgs } from '../args';
import { type AnyOperator, all, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { lazyBodies } from './lazyBodies';
import { pollEditable } from './polls';

/** The apply bodies of clip.new, clip.duplicate, clip.delete and clip.setSettings (`lazyBodies`, M-AI B5): their
 *  `prepare` (already asynchronous: it opens the clip partitions) loads them. */
const clipBodies = lazyBodies(() => import('./clipBodies'));
type ClipBodies = Awaited<ReturnType<typeof clipBodies>>;

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

// ---------- new ----------

const clipNew = defineOperator<'clip.new', { readonly id: ClipId; readonly bodies: ClipBodies }>({
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
    if (options['loop'] !== undefined && typeof options['loop'] !== 'boolean') return fail('loop must be a boolean');
    if (options['activate'] !== undefined && typeof options['activate'] !== 'boolean') {
      return fail('activate must be a boolean');
    }
    return pollEditable(app);
  },
  async prepare({ app }) {
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { id, bodies: await clipBodies() };
  },
  apply: (ctx, args, prepared) => prepared.bodies.clipNew(ctx, args, prepared),
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

const clipDuplicate = defineOperator<'clip.duplicate', { readonly id: ClipId; readonly bodies: ClipBodies }>({
  id: 'clip.duplicate',
  label: 'Duplicate Clip',
  description: 'Copy a clip with its layers, curves, keys and provenance.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Duplicate Clip',
  poll({ app }, args) {
    const base = all(pollClipArg(app, args), pollEditable(app));
    if (base !== true) return base;
    const options = args as { readonly name?: unknown; readonly activate?: unknown };
    if (options.name !== undefined) {
      const problem = clipNameProblem(options.name);
      if (problem !== null) return fail(problem);
      const source = clipOf(app, args) as ClipRecord;
      if (clipNameTaken(app.store, source.character, options.name as string))
        return fail('A clip with that name exists');
    }
    if (options.activate !== undefined && typeof options.activate !== 'boolean')
      return fail('activate must be a boolean');
    return OK;
  },
  async prepare({ app }, args) {
    await app.store.open(`clip:${args.clip}`);
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { id, bodies: await clipBodies() };
  },
  apply: (ctx, args, prepared) => prepared.bodies.clipDuplicate(ctx, args, prepared),
});

// ---------- delete ----------

const clipDelete = defineOperator<'clip.delete', { readonly replacement: ClipId | null; readonly bodies: ClipBodies }>({
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
    if (clip === undefined) return { replacement: null, bodies: await clipBodies() };
    const others = app.store.query.clipsOfCharacter(clip.character).filter((c) => c.id !== clip.id);
    if (others.length > 0) return { replacement: null, bodies: await clipBodies() };
    const id = newRecordId(app, 'clip');
    await app.store.open(`clip:${id}`);
    return { replacement: id, bodies: await clipBodies() };
  },
  apply: (ctx, args, prepared) => prepared.bodies.clipDelete(ctx, args, prepared),
});

// ---------- set active ----------

/** The selection without keys (they belong to the curves of the previously active clip). */
export function withoutKeys(selection: Selection): Selection {
  return selection.keys.size === 0 ? selection : { ...selection, keys: new Map() };
}

/** Scene frame that shows `clip` inside its range: the current one when it does, else the nearest range end. */
export function clampedSceneFrame(app: EditorApp, clip: ClipRecord): Frame {
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
    // The selection holds one character's controls and the active clip's keys (select.ts): another character
    // starts with an empty selection, another clip of the same character keeps the controls but not the keys.
    const selection =
      clip.character !== state.activeCharacter
        ? EMPTY_SELECTION
        : state.activeClip[clip.character] !== clip.id
          ? withoutKeys(state.selection)
          : state.selection;
    app.session.setState({
      activeCharacter: clip.character,
      activeClip: { ...state.activeClip, [clip.character]: clip.id },
      time: { ...state.time, sceneFrame, band: null },
      selection,
    });
  },
});

// ---------- settings ----------

function derivedFromListProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'provenance.derivedFrom must be a list';
  for (const entry of value as readonly unknown[]) {
    const problem = derivedFromProblem(entry);
    if (problem !== null) return problem;
  }
  return null;
}

/** The keep-seconds rescale ratio of a frame-rate change (null: no rescale). */
export function rescaleRatio(clip: ClipRecord, args: Pick<ClipSettingsArgs, 'fps' | 'fpsMode'>): number | null {
  if (args.fps === undefined || sameFps(args.fps, clip.fps) || (args.fpsMode ?? 'keep-seconds') !== 'keep-seconds') {
    return null;
  }
  return fpsValue(args.fps) / fpsValue(clip.fps);
}

/** The clip range after the settings: the given range, else the current one rescaled by a keep-seconds fps change. */
export function finalRange(
  clip: ClipRecord,
  args: Pick<ClipSettingsArgs, 'fps' | 'fpsMode' | 'range'>,
): { readonly start: Frame; readonly end: Frame } {
  if (args.range !== undefined) return args.range;
  const ratio = rescaleRatio(clip, args);
  if (ratio === null) return clip.range;
  const start = Math.round(clip.range.start * ratio);
  return { start, end: Math.max(start + 1, Math.round(clip.range.end * ratio)) };
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
    const range = finalRange(clip, args);
    if (args['contact'] < range.start || args['contact'] > range.end) return 'contact must lie inside the clip range';
  }
  const provenance = args['provenance'];
  if (provenance !== undefined) {
    if (!isRecord(provenance)) return 'provenance is { derivedFrom?, redistributable? }';
    if (provenance['derivedFrom'] !== undefined) {
      const problem = derivedFromListProblem(provenance['derivedFrom']);
      if (problem !== null) return problem;
    }
    const redistributable = provenance['redistributable'];
    if (redistributable !== undefined && !REDISTRIBUTABLE.includes(redistributable as Redistributable)) {
      return "redistributable is 'yes', 'no' or 'unknown'";
    }
  }
  return null;
}

const clipSetSettings = defineOperator<'clip.setSettings', ClipBodies>({
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
    return clipBodies();
  },
  apply: (ctx, args: ClipSettingsArgs, bodies) => bodies.clipSetSettings(ctx, args),
});

export const CLIP_OPERATORS: readonly AnyOperator[] = [
  clipNew,
  clipRename,
  clipDuplicate,
  clipDelete,
  clipSetActive,
  clipSetSettings,
];
