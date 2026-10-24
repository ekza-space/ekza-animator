// The Animate stage's pure parts (STUDIO-TOUCH-SPEC §7.1, §10; T7): which character and animation the Thread shows,
// the Animations row's chips (folded to the visible-target budget, §4.8), the arguments of *+ New* (a name and a length
// of 1, 2 or 4 s), the fitting manipulator of a control (§10.1: a turn ring for FK controls, move for IK goals and the
// root), whether a selected control can Reach (§10.1: a hand or a foot), and the operator calls of the clip verbs. Pure
// over the app: these read it and build arguments, they never run anything (the stage's actions do, through `ctx.run`).
// The headless journey test (`test/animate-journeys.test.ts`) replays the same calls against Studio Pro's.
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ClipRecord, ControlId, ControlRecord } from '@ekza-studio/doc';
import { type EditorApp, isKeyable, limbOfControlApp, VIEWPORT_TOOL } from '@ekza-studio/editor-core';

/** `ProjectRecord.sceneFps` when the document has none yet (the kernel's default, §4.2). */
export const DEFAULT_FPS: Fps = { num: 30, den: 1 };

/** The lengths *+ New* offers (§10.6). */
export const NEW_LENGTHS = [1, 2, 4] as const;
export type NewLength = (typeof NEW_LENGTHS)[number];

/** The Animations row shows at most this many chips (§4.8: the row's five targets with + New, Library and ⋯). */
export const MAX_CHIPS = 2;

/** One operator call (the shape both shells' runs take). */
export interface OpCall {
  readonly op: string;
  readonly args?: unknown;
}

/** The character the Animate stage works on: the active one, else the only one. */
export function animateCharacter(app: EditorApp): CharacterId | null {
  const active = app.session.getState().activeCharacter;
  if (active !== null && app.store.get('characters', active) !== undefined) return active;
  const all = app.store.list('characters');
  return all.length === 1 ? (all[0]?.id ?? null) : null;
}

/** The active animation (clip) of a character, or null. */
export function activeClip(app: EditorApp, character: CharacterId | null = animateCharacter(app)): ClipRecord | null {
  if (character === null) return null;
  const id = app.session.getState().activeClip[character];
  return id === undefined ? null : (app.store.get('clips', id) ?? null);
}

/** The character's animations in their order (the Animations row). */
export function animationsOf(app: EditorApp, character: CharacterId | null): readonly ClipRecord[] {
  if (character === null) return [];
  return app.store.query.clipsOfCharacter(character).filter((clip) => clip.deleted === null);
}

/**
 * The chips the row shows (§4.8): the active animation first, then the most recent others, at most `MAX_CHIPS`; the
 * rest fold into one `+n` chip that lists them all.
 */
export function rowChips(
  clips: readonly ClipRecord[],
  active: ClipId | null,
  max: number = MAX_CHIPS,
): { readonly shown: readonly ClipRecord[]; readonly folded: number } {
  if (clips.length <= max) return { shown: clips, folded: 0 };
  const head = clips.find((clip) => clip.id === active);
  const rest = clips.filter((clip) => clip.id !== active).reverse();
  const room = max - 1; // the `+n` chip takes one place
  const shown = [...(head === undefined ? [] : [head]), ...rest].slice(0, Math.max(1, room));
  const order = new Map(clips.map((clip, index) => [clip.id, index]));
  const sorted = [...shown].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { shown: sorted, folded: clips.length - sorted.length };
}

/** The scene's frame rate (a new animation's). */
export function sceneFps(app: EditorApp): Fps {
  return app.store.get('project', 'project')?.sceneFps ?? DEFAULT_FPS;
}

/** Whole frames of `seconds` at `fps` (keys always land on whole frames, §10.3). */
export function framesOf(seconds: number, fps: Fps): Frame {
  return Math.round((seconds * fps.num) / fps.den);
}

/** Seconds of a clip frame. */
export function secondsOf(frame: Frame, fps: Fps): number {
  return (frame * fps.den) / fps.num;
}

/** A clip name the kernel takes: letters, digits, spaces and `. _ -`, at most 64 characters, trimmed. */
export function cleanClipName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/** The next free "Animation n" of a character (the name field's placeholder and the name of an untyped one). */
export function nextAnimationName(clips: readonly Pick<ClipRecord, 'name'>[], word: (n: number) => string): string {
  const taken = new Set(clips.map((clip) => clip.name.toLowerCase()));
  for (let n = clips.length + 1; ; n++) {
    const name = word(n);
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** *+ New* (§10.6): `clip.new` with the name and a range of whole frames from 0 for the length, made active. */
export function newAnimationCall(
  character: CharacterId,
  name: string,
  seconds: NewLength,
  fps: Fps,
): OpCall & { readonly args: { character: CharacterId; name: string; range: { start: Frame; end: Frame } } } {
  return {
    op: 'clip.new',
    args: { character, name, range: { start: 0, end: framesOf(seconds, fps) } },
  };
}

/** *Loop it* (§10.6): the public wrapper `clip.loop` with its defaults (match the ends, keep root travel). */
export function loopItCall(clip: ClipId): OpCall {
  return { op: 'clip.loop', args: { clip } };
}

/** The controls of a character (the rows *+ swap sides* mirrors). */
export function controlsOf(app: EditorApp, character: CharacterId): readonly ControlRecord[] {
  const rig = app.store.query.rigOfCharacter(character);
  return rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
}

/**
 * *Duplicate ▾ › + swap sides* (§6.2, J5): the copy, then the copy's animation mirrored left for right on every
 * control of the character (`pose.mirrorAnimation {mode: 'flip'}`, Pro's Mirror Animation without the half-cycle
 * offset). The second call runs on the copy (it is the active animation after `clip.duplicate`).
 */
export function swapSidesCalls(app: EditorApp, clip: ClipRecord): readonly OpCall[] {
  const controls = controlsOf(app, clip.character).map((control) => control.id);
  return [
    { op: 'clip.duplicate', args: { clip: clip.id } },
    { op: 'pose.mirrorAnimation', args: { mode: 'flip', offset: 'none', controls } },
  ];
}

const ROOT_KEYS = /^(root|cog|fk\.hips|hips|center|centre)$/i;

/**
 * The manipulator a control gets when it is selected (§10.1): move for IK goals, poles and the root; a turn ring for
 * every control that turns; move for the rest.
 */
export function fittingTool(
  app: EditorApp,
  control: ControlId,
): typeof VIEWPORT_TOOL.move | typeof VIEWPORT_TOOL.rotate {
  const record = app.store.get('controls', control);
  if (record === undefined) return VIEWPORT_TOOL.rotate;
  const limb = limbOfControlApp(app, control);
  if (limb !== null && limb.ikControls.includes(control)) return VIEWPORT_TOOL.move;
  const turns = isKeyable(record, 'rx') || isKeyable(record, 'ry') || isKeyable(record, 'rz');
  const moves = isKeyable(record, 'tx') || isKeyable(record, 'ty') || isKeyable(record, 'tz');
  if (moves && (record.parent === null || ROOT_KEYS.test(record.key))) return VIEWPORT_TOOL.move;
  return turns ? VIEWPORT_TOOL.rotate : VIEWPORT_TOOL.move;
}

/** The tools the fitting choice may replace (a tool the person chose elsewhere — scale, a Model tool — stays). */
export const FITTABLE_TOOLS: ReadonlySet<string> = new Set([
  VIEWPORT_TOOL.select,
  VIEWPORT_TOOL.move,
  VIEWPORT_TOOL.rotate,
]);

/** The limb a selected control Reaches with (§10.1): the hand or foot at the end of an FK chain, else null. */
export function reachLimbOf(app: EditorApp, control: ControlId): string | null {
  const limb = limbOfControlApp(app, control);
  if (limb === null) return null;
  return limb.fkControls[limb.fkControls.length - 1] === control ? limb.id : null;
}
