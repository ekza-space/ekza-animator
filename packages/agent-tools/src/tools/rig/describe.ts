// rig_describe (MCP-SPEC §6.2 tool 5, §5.5): a character's controls with keyable and locked channels, rotate orders,
// mirrors, attributes and limbs; concise lists the primary controls per body part and folds secondary (`sec.*`) and
// finger controls into one count row per body part, drilled into with `bodyParts` or `detail: 'detailed'`. Detailed
// adds axis hints — for every keyable rotation channel, how the driven bone's tip moves at rest with +10° on it, in
// centimetres with the character's direction words — and each driven bone's rest direction; cached per rig program.
import { DEG2RAD, type Vec3 } from '@ekza-animator/anim-core';
import type { CharacterId, ControlRecord } from '@ekza-animator/doc';
import {
  attrChannelsOf,
  attrDefOf,
  bodyPartOf,
  type CharacterRuntime,
  type EditorApp,
  isKeyable,
  isLocked,
  limbsOf,
} from '@ekza-animator/editor-core';
import type { RigProgram } from '@ekza-animator/rig';
import { controlKeyOf } from '../../resolve/resolver';
import { firstChildOf, nodeXf, restPoseOf } from '../../units/pose';
import { outValue, outVec, roundTo, toToolValue, unitOfChannel } from '../../units/units';
import { limbModes } from '../scene/summary';

const TRS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;
/** The test rotation of the axis hints (§6.2): +10°. */
export const AXIS_HINT_DEG = 10;

export interface RigControlRow {
  key: string;
  name: string;
  bone: string | null;
  side: 'L' | 'R' | 'C';
  bodyPart: string;
  channels: string[];
  locked: string[];
  rotateOrder: string;
  mirror: string | null;
  attrs: { name: string; unit: 'deg' | 'm' | 'none'; min?: number; max?: number; default: number }[];
  axisHints?: Record<string, string>;
  restDirection?: [number, number, number];
}

function boneName(control: ControlRecord): string | null {
  const bone = control.drives?.bone;
  if (bone === undefined) return null;
  return 'humanoid' in bone ? bone.humanoid : bone.name;
}

/** Folded rows (concise): secondary controls, and finger controls, counted per body part. */
function isFolded(control: ControlRecord, part: string): boolean {
  return control.group === 'secondary' || control.key.startsWith('sec.') || part.startsWith('fingers.');
}

/**
 * The concise view of a rig (§5.5): the group a control is counted in instead of being listed — secondary and finger
 * controls per body part, and the controls a limb's current mode hides in the editor (FK in IK, IK and pole in FK) —
 * or null for a listed (primary) control. rig_describe and pose_read's default targets share it.
 */
export function conciseFolding(app: EditorApp, character: CharacterId): (control: ControlRecord) => string | null {
  const rig = app.store.query.rigOfCharacter(character);
  const humanoid = rig?.generator.name === 'ekza-autorig-humanoid';
  const modes = limbModes(app, character);
  const hiddenByMode = new Map<string, string>();
  for (const limb of limbsOf(app, character)) {
    const mode = modes[limb.id];
    if (mode === 'ik') for (const id of limb.fkControls) hiddenByMode.set(id, `${limb.id} fk (hidden in IK)`);
    if (mode === 'fk') for (const id of limb.ikControls) hiddenByMode.set(id, `${limb.id} ik (hidden in FK)`);
  }
  return (control) => {
    const part = bodyPartOf(app, control.id) ?? (humanoid ? 'other' : 'all');
    return isFolded(control, part) ? part : (hiddenByMode.get(control.id) ?? null);
  };
}

const WORDS: readonly (readonly [number, string, string])[] = [
  [1, 'up', 'down'],
  [2, 'forward', 'back'],
  [0, 'left', 'right'],
];

/** `tip up 4.1 cm, back 0.4 cm`: the two largest components of a displacement in metres. */
export function describeMove(delta: readonly number[]): string {
  const parts = WORDS.map(([axis, positive, negative]) => {
    const value = delta[axis] ?? 0;
    return {
      size: Math.abs(value),
      text: `${value >= 0 ? positive : negative} ${roundTo(Math.abs(value) * 100, 0.1)} cm`,
    };
  })
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .filter((part, i) => i === 0 || part.size >= 0.0005);
  if ((parts[0]?.size ?? 0) < 0.0005) return 'twist: the tip stays';
  return `tip ${parts.map((part) => part.text).join(', ')}`;
}

interface AxisFacts {
  readonly hints: ReadonlyMap<string, Record<string, string>>;
  readonly restDirection: ReadonlyMap<string, Vec3>;
}
const AXIS_CACHE = new WeakMap<RigProgram, AxisFacts>();

/** The node a control drives and the tip that node's rotation moves (its first child, else a point along it). */
function tipOf(
  runtime: CharacterRuntime,
  node: number,
  pose: ReturnType<typeof restPoseOf>,
): { from: Vec3; tip: Vec3 } {
  const at = nodeXf(pose, node).position;
  const child = firstChildOf(runtime, node);
  if (child !== -1) {
    const tip = nodeXf(pose, child).position;
    if (Math.hypot(tip[0] - at[0], tip[1] - at[1], tip[2] - at[2]) > 1e-4) return { from: at, tip };
  }
  const parent = runtime.skeleton.nodes[node]?.parent ?? -1;
  const base = parent === -1 ? ([at[0], at[1] - 0.1, at[2]] as Vec3) : nodeXf(pose, parent).position;
  const dir = [at[0] - base[0], at[1] - base[1], at[2] - base[2]];
  const length = Math.hypot(dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? 0);
  const scale = length > 1e-6 ? Math.max(0.05, length * 0.5) / length : 0;
  return {
    from: at,
    tip: [at[0] + (dir[0] ?? 0) * scale, at[1] + (dir[1] ?? 0) * scale, at[2] + (dir[2] ?? 0) * scale],
  };
}

/** Axis hints and rest directions of every bone-driving control of a rig program (cached per program). */
function axisFactsOf(runtime: CharacterRuntime): AxisFacts {
  const program = runtime.program;
  const cached = AXIS_CACHE.get(program);
  if (cached !== undefined) return cached;
  const hints = new Map<string, Record<string, string>>();
  const restDirection = new Map<string, Vec3>();
  const rest = restPoseOf(program);
  const channels = program.allocChannels();
  const pose = program.allocPose();
  program.controls.forEach((control, slot) => {
    const bone = control.drives?.bone;
    if (bone === undefined) return;
    const humanoid = runtime.skeleton.humanoid ?? {};
    const node =
      'humanoid' in bone
        ? (humanoid[bone.humanoid] ?? -1)
        : (runtime.skeleton.nodes.find((n) => n.name === bone.name)?.index ?? -1);
    if (node === -1) return;
    const { from, tip } = tipOf(runtime, node, rest);
    const d = [tip[0] - from[0], tip[1] - from[1], tip[2] - from[2]];
    const length = Math.hypot(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0);
    if (length > 1e-6)
      restDirection.set(control.id, [(d[0] ?? 0) / length, (d[1] ?? 0) / length, (d[2] ?? 0) / length]);
    const row: Record<string, string> = {};
    for (const channel of ['rx', 'ry', 'rz'] as const) {
      if (!isKeyable(control, channel)) continue;
      program.resetChannels(channels);
      const index = slot * 9 + (channel === 'rx' ? 3 : channel === 'ry' ? 4 : 5);
      channels.values[index] = AXIS_HINT_DEG * DEG2RAD;
      program.evaluate(channels, pose);
      const moved = tipOf(runtime, node, pose).tip;
      row[channel] = describeMove([moved[0] - tip[0], moved[1] - tip[1], moved[2] - tip[2]]);
    }
    if (Object.keys(row).length > 0) hints.set(control.id, row);
  });
  const facts = { hints, restDirection };
  AXIS_CACHE.set(program, facts);
  return facts;
}

/** The rig_describe data of one character. */
export function describeRig(
  app: EditorApp,
  character: CharacterId,
  opts: { readonly bodyParts?: readonly string[] | undefined; readonly detail: 'concise' | 'detailed' },
) {
  const record = app.store.get('characters', character);
  const rig = app.store.query.rigOfCharacter(character);
  const runtime = app.characters.get(character);
  const controls = rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
  const humanoid = rig?.generator.name === 'ekza-autorig-humanoid';
  const wanted = opts.bodyParts === undefined || opts.bodyParts.includes('all') ? null : new Set(opts.bodyParts);
  const drill = opts.bodyParts !== undefined;
  const detailed = opts.detail === 'detailed';
  const facts = detailed && runtime !== undefined ? axisFactsOf(runtime) : null;
  const secondary = new Map<string, number>();
  const rows: RigControlRow[] = [];
  const fold = conciseFolding(app, character);
  for (const control of controls) {
    const part = bodyPartOf(app, control.id) ?? (humanoid ? 'other' : 'all');
    if (wanted !== null && !wanted.has(part)) continue;
    if (!drill && !detailed) {
      const folded = fold(control);
      if (folded !== null) {
        secondary.set(folded, (secondary.get(folded) ?? 0) + 1);
        continue;
      }
    }
    const channels: string[] = [];
    const locked: string[] = [];
    for (const channel of TRS) {
      if (!isKeyable(control, channel)) continue;
      channels.push(channel);
      if (isLocked(control, channel)) locked.push(channel);
    }
    const attrs: RigControlRow['attrs'] = [];
    for (const channel of attrChannelsOf(control)) {
      const def = attrDefOf(control, channel);
      if (def === undefined || !def.keyable) continue;
      channels.push(channel);
      // concise leaves the attribute details out (their channels are listed); bodyParts or detailed list them
      if (!drill && !detailed) continue;
      const unit = unitOfChannel(control, channel) as 'deg' | 'm' | 'none';
      attrs.push({
        name: channel.slice(1),
        unit,
        ...(def.min === undefined ? {} : { min: outValue(unit, toToolValue(unit, def.min)) }),
        ...(def.max === undefined ? {} : { max: outValue(unit, toToolValue(unit, def.max)) }),
        default: outValue(unit, toToolValue(unit, def.default)),
      });
    }
    const mirror = control.mirror === null ? undefined : app.store.get('controls', control.mirror);
    const row: RigControlRow = {
      key: controlKeyOf(control),
      name: control.name,
      bone: boneName(control),
      side: control.side,
      bodyPart: part,
      channels,
      locked,
      rotateOrder: control.rotateOrder,
      mirror: mirror === undefined ? null : controlKeyOf(mirror),
      attrs,
    };
    if (facts !== null) {
      const hints = facts.hints.get(control.id);
      if (hints !== undefined) row.axisHints = hints;
      const dir = facts.restDirection.get(control.id);
      if (dir !== undefined) row.restDirection = outVec(dir);
    }
    rows.push(row);
  }
  const keyOf = (id: string): string => {
    const control = app.store.get('controls', id as never);
    return control === undefined ? id : controlKeyOf(control);
  };
  const modes = limbModes(app, character);
  const limbs = limbsOf(app, character)
    .filter((limb) => wanted === null || wanted.has(limb.id))
    .map((limb) => ({
      limb: limb.id,
      mode: modes[limb.id] ?? ('fk' as const),
      ikFk: roundTo(app.evaluation.ikFk(character, limb.id) ?? 0, 0.001),
      ikControl: keyOf(limb.params.ikControl),
      pole: keyOf(limb.params.pole),
      fk: limb.fkControls.map(keyOf),
    }));
  return {
    character: record?.name ?? character,
    rig: humanoid ? ('humanoid' as const) : ('generic' as const),
    secondary: [...secondary].map(([group, count]) => ({ group, count })),
    controls: rows,
    limbs,
  };
}
