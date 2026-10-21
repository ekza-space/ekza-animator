// C6 (skin UI; M6B-SPEC §5.10, §5.11, §6.2, §0.6): the U-state operators of Skin mode — no document write, no undo
// step:
// - `skin.influence.setActive {mesh, joint} | null`, `.walk {direction}` (parent, first child, previous/next sibling),
//   `.pickDominant {mesh?, point}` (`Shift+I`): the active influence (`RigSessionState.activeInfluence`);
// - `skin.influence.hold {joint?, on}`, `.holdAll`, `.releaseAll`: holds per character × joint key, applied on every
//   bound mesh of the character, remembered in `prefs.rigging.holds` ('<project>/<character>', §5.10);
// - `skin.paint.mode {mode | step}` (Paint Select arrives after the MVP: only 'paint'), `skin.paint.set {patch}` (the
//   brush; op/value/opacity/radius/falloff/reach/front faces are remembered in `prefs.rigging.brush`),
//   `skin.paint.mirrorToggle` (`Alt+R`), `skin.paint.sample {mesh?, point}` (`I`: value ← the active joint's weight);
// - `skin.testRotate.toggle` (`E` in Skin mode): shows the test-rotate handle on the active influence's joint (the
//   Paint Skin Weights tool draws it and writes the test pose while it is dragged, §5.11); `skinTestRotate(app)`
//   is its U state.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId, JointRecord, MeshId } from '@ekza-studio/doc';
import { meshKernel } from '../../../mesh/kernel';
import type { BrushSettings, EditorApp, PollResult } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { ARRIVES_AFTER_MVP } from './stub';
import {
  activeJoint,
  boundCharacter,
  boundMeshesOf,
  heldKeysOf,
  holdsPrefKey,
  skinCharacter,
  skinTargets,
} from './weights';

const NOT_SKIN = 'Skin mode works on a bound character (Skin › Bind Skin first)';
const PAINT_SELECT = `Paint Select: ${ARRIVES_AFTER_MVP}`;

// ---------- the test-rotate handle (U state) ----------

const testRotateState = new WeakMap<EditorApp, { on: boolean; readonly listeners: Set<() => void> }>();

function testRotateEntry(app: EditorApp): { on: boolean; readonly listeners: Set<() => void> } {
  let entry = testRotateState.get(app);
  if (entry === undefined) {
    entry = { on: false, listeners: new Set() };
    testRotateState.set(app, entry);
  }
  return entry;
}

/** Whether Skin mode's test-rotate handle shows (`E`, §5.11). */
export function skinTestRotate(app: EditorApp): boolean {
  return testRotateEntry(app).on;
}

/** Shows or hides the test-rotate handle. */
export function setSkinTestRotate(app: EditorApp, on: boolean): void {
  const entry = testRotateEntry(app);
  if (entry.on === on) return;
  entry.on = on;
  for (const listener of Array.from(entry.listeners)) listener();
}

export function subscribeSkinTestRotate(app: EditorApp, listener: () => void): Disposer {
  const entry = testRotateEntry(app);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

// ---------- helpers ----------

function setRig(app: EditorApp, patch: Partial<ReturnType<EditorApp['session']['getState']>['rig']>): void {
  const state = app.session.getState();
  app.session.setState({ rig: { ...state.rig, ...patch } });
}

/** The live joint record of a palette key. */
function jointOf(app: EditorApp, key: string): JointRecord | null {
  const record = app.store.get('joints', key as never);
  return record === undefined || record.deleted !== null ? null : record;
}

/** Writes a character's holds to the session and the prefs. */
export function writeHolds(app: EditorApp, character: CharacterId, keys: Iterable<string>): void {
  const set = new Set(keys);
  const holds = new Map(app.session.getState().rig.holds);
  holds.set(character, set);
  setRig(app, { holds });
  const prefs = app.prefs.getState();
  const key = holdsPrefKey(app, character);
  const sorted = [...set].sort();
  const next = { ...prefs.rigging.holds };
  if (sorted.length === 0) delete next[key];
  else next[key] = sorted;
  app.prefs.setState({ rigging: { ...prefs.rigging, holds: next } });
}

/** The influences of the target meshes (the union of their palettes; joint keys, skeleton order). */
export function influencesOf(app: EditorApp, meshes: readonly MeshId[]): string[] {
  const kernel = meshKernel();
  const keys = new Set<string>();
  for (const mesh of meshes) {
    const data = app.meshes.get(mesh)?.data() ?? null;
    const skin = kernel === null || data === null ? null : kernel.readSkin(data);
    for (const entry of skin?.palette ?? []) keys.add(entry.key);
  }
  const character = meshes.length === 0 ? null : boundCharacter(app, meshes[0] as MeshId);
  const skeleton = character === null ? null : app.store.get('characters', character);
  const order =
    skeleton?.source.kind === 'model'
      ? app.store.query.jointsOfSkeleton(skeleton.source.skeleton).map((joint) => joint.id as string)
      : [];
  return [...keys].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** The skin row of a point: (joint key, weight) by descending weight, or null. */
function pointRow(app: EditorApp, mesh: MeshId, point: number): (readonly [string, number])[] | null {
  const kernel = meshKernel();
  const data = app.meshes.get(mesh)?.data() ?? null;
  const skin = kernel === null || data === null ? null : kernel.readSkin(data);
  if (skin === null || !Number.isInteger(point) || point < 0 || point >= skin.points) return null;
  const out: [string, number][] = [];
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * point + k] as number;
    const key = skin.palette[skin.joints[4 * point + k] as number]?.key;
    if (w > 0 && key !== undefined) out.push([key, w]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

function skinPoll(app: EditorApp): PollResult {
  return skinCharacter(app) === null || skinTargets(app).length === 0 ? fail(NOT_SKIN) : OK;
}

/** The mesh a point argument refers to: the given one, the active influence's, else the first target. */
function meshArg(app: EditorApp, args: unknown): MeshId | null {
  if (isRecord(args) && typeof args['mesh'] === 'string') return args['mesh'] as MeshId;
  return app.session.getState().rig.activeInfluence?.mesh ?? skinTargets(app)[0] ?? null;
}

// ---------- the active influence ----------

const setActive = defineOperator<'skin.influence.setActive'>({
  id: 'skin.influence.setActive',
  label: 'Set Active Influence',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['mesh', 'joint'],
  poll: ({ app }, args) => {
    if (args === null) return OK;
    if (!isRecord(args) || typeof args.mesh !== 'string' || typeof args.joint !== 'string') {
      return fail('expects { mesh, joint } or null');
    }
    if (boundCharacter(app, args.mesh) === null) return fail(NOT_SKIN);
    return jointOf(app, args.joint) === null ? fail(`${args.joint} is not a joint`) : OK;
  },
  apply: ({ app }, args) => {
    setRig(app, { activeInfluence: args === null ? null : { mesh: args.mesh, joint: args.joint } });
  },
});

type WalkDirection = 'up' | 'down' | 'left' | 'right';

/** The joint a walk reaches from `key`, or null. */
export function walkJoint(app: EditorApp, key: string, direction: WalkDirection): string | null {
  const joint = jointOf(app, key);
  if (joint === null) return null;
  const siblings = app.store.query
    .jointsOfSkeleton(joint.skeleton)
    .filter((other) => other.deleted === null && other.parent === joint.parent);
  if (direction === 'up') return joint.parent !== null && jointOf(app, joint.parent) !== null ? joint.parent : null;
  if (direction === 'down') {
    const child = app.store.query
      .jointsOfSkeleton(joint.skeleton)
      .find((other) => other.deleted === null && other.parent === joint.id);
    return child?.id ?? null;
  }
  const at = siblings.findIndex((other) => other.id === joint.id);
  const next = siblings[direction === 'left' ? at - 1 : at + 1];
  return next?.id ?? null;
}

const walk = defineOperator<'skin.influence.walk'>({
  id: 'skin.influence.walk',
  label: 'Walk Influences',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['direction'],
  poll: ({ app }, args) => {
    if (!isRecord(args) || !['up', 'down', 'left', 'right'].includes(args.direction)) {
      return fail('expects { direction }');
    }
    const active = app.session.getState().rig.activeInfluence;
    if (active === null) return fail('Pick an influence first (Paint Weights panel)');
    return walkJoint(app, active.joint, args.direction) === null ? fail('No joint that way') : OK;
  },
  apply: ({ app }, args) => {
    const active = app.session.getState().rig.activeInfluence;
    if (active === null) return;
    const next = walkJoint(app, active.joint, args.direction);
    if (next !== null) setRig(app, { activeInfluence: { mesh: active.mesh, joint: next } });
  },
});

const pickDominant = defineOperator<'skin.influence.pickDominant'>({
  id: 'skin.influence.pickDominant',
  label: 'Pick Dominant Influence',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['mesh', 'point'],
  poll: ({ app }, args) => {
    const mesh = meshArg(app, args);
    if (mesh === null || boundCharacter(app, mesh) === null) return fail(NOT_SKIN);
    const row = pointRow(app, mesh, isRecord(args) ? args['point'] : -1);
    return row === null || row.length === 0 ? fail('That point has no weights') : OK;
  },
  apply: ({ app }, args) => {
    const mesh = meshArg(app, args) as MeshId;
    const row = pointRow(app, mesh, args.point);
    const top = row?.[0];
    if (top !== undefined) setRig(app, { activeInfluence: { mesh, joint: top[0] } });
  },
});

// ---------- holds ----------

const hold = defineOperator<'skin.influence.hold'>({
  id: 'skin.influence.hold',
  label: 'Hold Influence',
  description: 'Locks (or unlocks) a joint’s weights on every bound mesh of the character (M6B-SPEC §5.10).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  extraArgs: ['joint', 'on'],
  poll: ({ app }, args) => {
    const character = skinCharacter(app);
    if (character === null) return fail(NOT_SKIN);
    const joint = (isRecord(args) && typeof args['joint'] === 'string' ? args['joint'] : null) ?? activeJoint(app);
    if (joint === null) return fail('Pick an influence first (Paint Weights panel)');
    if (!isRecord(args) || typeof args['on'] !== 'boolean') return fail('expects { joint?, on }');
    return jointOf(app, joint) === null ? fail(`${joint} is not a joint`) : OK;
  },
  apply: ({ app }, args) => {
    const character = skinCharacter(app) as CharacterId;
    const joint = args.joint ?? (activeJoint(app) as string);
    const keys = new Set(heldKeysOf(app, character));
    if (args.on) keys.add(joint);
    else keys.delete(joint);
    writeHolds(app, character, keys);
  },
});

const holdAll = defineOperator<'skin.influence.holdAll'>({
  id: 'skin.influence.holdAll',
  label: 'Hold All Influences',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  poll: ({ app }) => skinPoll(app),
  apply: ({ app }) => {
    const character = skinCharacter(app) as CharacterId;
    writeHolds(app, character, influencesOf(app, boundMeshesOf(app, character)));
  },
});

const releaseAll = defineOperator<'skin.influence.releaseAll'>({
  id: 'skin.influence.releaseAll',
  label: 'Release All Holds',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  poll: ({ app }) => (skinCharacter(app) === null ? fail(NOT_SKIN) : OK),
  apply: ({ app }) => {
    writeHolds(app, skinCharacter(app) as CharacterId, []);
  },
});

// ---------- the brush ----------

const paintMode = defineOperator<'skin.paint.mode'>({
  id: 'skin.paint.mode',
  label: 'Paint Mode',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['mode', 'step'],
  poll: (_ctx, args) => {
    if (!isRecord(args)) return fail('expects { mode } or { step }');
    return args['mode'] === 'paint' ? OK : fail(PAINT_SELECT);
  },
  apply: ({ app }) => {
    const rig = app.session.getState().rig;
    setRig(app, { paint: { ...rig.paint, mode: 'paint' } });
  },
});

const PAINT_OPS = ['replace', 'add', 'scale', 'smooth'] as const;
const FALLOFFS = ['smooth', 'linear', 'constant'] as const;
const REACHES = ['surface', 'volume'] as const;

/** A brush patch with every field checked and clamped (null when nothing valid is in it). */
export function brushPatch(patch: unknown, op: BrushSettings['op']): Partial<BrushSettings> | null {
  if (!isRecord(patch)) return null;
  const out: { -readonly [K in keyof BrushSettings]?: BrushSettings[K] } = {};
  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  if (PAINT_OPS.includes(patch['op'] as never)) out.op = patch['op'] as BrushSettings['op'];
  const nextOp = out.op ?? op;
  const value = num(patch['value']);
  if (value !== null) out.value = Math.min(Math.max(value, nextOp === 'add' ? -1 : 0), 1);
  const opacity = num(patch['opacity']);
  if (opacity !== null) out.opacity = Math.min(Math.max(opacity, 0), 1);
  const radius = num(patch['radiusPx']);
  if (radius !== null) out.radiusPx = Math.min(Math.max(radius, 1), 1000);
  if (FALLOFFS.includes(patch['falloff'] as never)) out.falloff = patch['falloff'] as BrushSettings['falloff'];
  if (REACHES.includes(patch['reach'] as never)) out.reach = patch['reach'] as BrushSettings['reach'];
  if (typeof patch['frontOnly'] === 'boolean') out.frontOnly = patch['frontOnly'];
  if (typeof patch['mirror'] === 'boolean') out.mirror = patch['mirror'];
  return Object.keys(out).length === 0 ? null : out;
}

/** Applies a brush patch to the session (and the remembered defaults, mirror excepted). */
export function setBrush(app: EditorApp, patch: Partial<BrushSettings>): void {
  const rig = app.session.getState().rig;
  const brush = { ...rig.paint.brush, ...patch };
  // An op switch keeps the value in its range (Add allows −1…1, the others 0…1).
  if (brush.op !== 'add' && brush.value < 0) brush.value = 0;
  setRig(app, { paint: { ...rig.paint, brush } });
  const { mirror: _mirror, ...remembered } = patch;
  if (Object.keys(remembered).length === 0) return;
  const prefs = app.prefs.getState();
  app.prefs.setState({ rigging: { ...prefs.rigging, brush: { ...prefs.rigging.brush, ...remembered } } });
}

const paintSet = defineOperator<'skin.paint.set'>({
  id: 'skin.paint.set',
  label: 'Brush Settings',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['patch'],
  poll: ({ app }, args) =>
    isRecord(args) && brushPatch(args['patch'], app.session.getState().rig.paint.brush.op) !== null
      ? OK
      : fail('expects { patch } with brush fields'),
  apply: ({ app }, args) => {
    const patch = brushPatch(args.patch, app.session.getState().rig.paint.brush.op);
    if (patch !== null) setBrush(app, patch);
  },
});

const mirrorToggle = defineOperator<'skin.paint.mirrorToggle'>({
  id: 'skin.paint.mirrorToggle',
  label: 'Mirror Stroke',
  description: 'Paints the mirror joint on the partner points too (M6B-SPEC §5.11).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  poll: ({ app }) => (app.session.getState().workspace === 'rig' ? OK : fail(NOT_SKIN)),
  apply: ({ app }) => {
    setBrush(app, { mirror: !app.session.getState().rig.paint.brush.mirror });
  },
});

const sample = defineOperator<'skin.paint.sample'>({
  id: 'skin.paint.sample',
  label: 'Sample Weight',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['mesh', 'point'],
  poll: ({ app }, args) => {
    const mesh = meshArg(app, args);
    if (mesh === null || boundCharacter(app, mesh) === null) return fail(NOT_SKIN);
    if (activeJoint(app) === null) return fail('Pick an influence first (Paint Weights panel)');
    const row = pointRow(app, mesh, isRecord(args) ? args['point'] : -1);
    return row === null ? fail('No such point') : OK;
  },
  apply: ({ app }, args) => {
    const mesh = meshArg(app, args) as MeshId;
    const joint = activeJoint(app) as string;
    const weight = pointRow(app, mesh, args.point)?.find(([key]) => key === joint)?.[1] ?? 0;
    setBrush(app, { value: weight });
  },
});

const testRotate = defineOperator<'skin.testRotate.toggle'>({
  id: 'skin.testRotate.toggle',
  label: 'Test Rotate',
  description: "Rotates the active influence's joint for a test pose without leaving the brush (M6B-SPEC §5.11).",
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  poll: ({ app }) => {
    const state = app.session.getState();
    if (state.workspace !== 'rig' || state.rig.mode !== 'skin') return fail('Test Rotate works in Skin mode');
    if (!skinTestRotate(app) && state.rig.activeInfluence === null) {
      return fail('Pick an influence first (Paint Weights panel)');
    }
    return OK;
  },
  apply: ({ app }) => {
    setSkinTestRotate(app, !skinTestRotate(app));
  },
});

export const INFLUENCE_OPERATORS: readonly AnyOperator[] = [
  setActive,
  hold,
  holdAll,
  releaseAll,
  walk,
  pickDominant,
  paintMode,
  paintSet,
  mirrorToggle,
  sample,
  testRotate,
];
