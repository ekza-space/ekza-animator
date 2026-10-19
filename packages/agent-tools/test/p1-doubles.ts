// Test doubles of P1's explicit-target operators (MCP-SPEC §4.10), used by the P2 tool tests until P1 merges
// (`READY.p1`): small implementations of the §4.10 contract over the shipped edit kernel — explicit targets, stored
// units, the tool's `label`, no session reads or writes. `withP1(app)` returns the app itself once READY.p1 is set
// (the real operators then run), else a view of it whose `runUntyped` routes those ids to the doubles. Only the
// behaviour the tool tests assert is modelled; everything else poll-fails "double: not modelled".
import {
  type Frame,
  mat4Compose,
  quatAngle,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatShortestArc,
  quatSlerp,
  type Quat,
  type TangentType,
  type Vec3,
} from '@ekza-animator/anim-core';
import {
  applyRestorePlan,
  type ChannelId,
  type ClipId,
  type ControlId,
  type KeyId,
  planRestore,
  restoreHostOf,
  type Tx,
} from '@ekza-animator/doc';
import {
  channelDefaultOf,
  deleteKeys,
  type EditorApp,
  ensureCurve,
  isKeyable,
  isLocked,
  moveKeys,
  scaleKeys,
  writeKeyAt,
} from '@ekza-animator/editor-core';
import {
  type ChannelBuffer,
  ikControlForEndWorld,
  readAttr,
  readControlChannels,
  solveBoneChannels,
  writeControlChannels,
} from '@ekza-animator/rig';
import { poses } from '../src';
import { READY } from './ready';

/** Ids the doubles stand in for. */
export const DOUBLED = [
  'key.write',
  'key.delete',
  'key.adjust',
  'key.retime',
  'pose.setAt',
  'pose.goals',
  'pose.transfer',
  'clip.makeLoop',
  'edit.revertSteps',
] as const;
const PREFIX = 'p1double.';
const registered = new WeakSet<EditorApp>();
const NOT_MODELLED = { ok: false, reason: 'double: not modelled' } as const;

type Args = Record<string, unknown>;
interface Target {
  readonly control: ControlId;
  readonly channel: ChannelId;
}

function clipOf(tx: Tx | EditorApp['store'], clip: ClipId) {
  const record = tx.get('clips', clip);
  if (record === undefined) throw new Error('double: no clip');
  return record;
}

function tangents(app: EditorApp, inType?: TangentType, outType?: TangentType) {
  const defaults = app.prefs.getState().defaultTangents;
  return { in: inType ?? defaults.in, out: outType ?? defaults.out };
}

/** Keys the evaluated keyed value of a channel at a frame (curves only). */
function keyedValue(app: EditorApp, clip: ClipId, control: ControlId, channel: ChannelId, frame: Frame): number {
  const record = app.store.get('controls', control);
  const character = record === undefined ? undefined : app.store.get('rigs', record.rig)?.character;
  const runtime = character === undefined ? undefined : app.characters.get(character);
  const value = runtime?.sampler(clip).value(control, channel, frame);
  return value ?? channelDefaultOf(record ?? null, channel);
}

function growRange(tx: Tx, clip: ClipId, frames: readonly number[], extend: boolean | undefined): boolean {
  const record = clipOf(tx, clip);
  const lo = Math.min(record.range.start, ...frames.map(Math.floor));
  const hi = Math.max(record.range.end, ...frames.map(Math.ceil));
  if (lo === record.range.start && hi === record.range.end) return false;
  if (extend !== true) throw new Error('double: frame outside the range');
  tx.patch('clips', clip, { range: { start: lo, end: hi } });
  return true;
}

function outside(app: EditorApp, clip: ClipId, frames: readonly number[]): boolean {
  const record = app.store.get('clips', clip);
  return record !== undefined && frames.some((f) => f < record.range.start - 1e-6 || f > record.range.end + 1e-6);
}

function keysAt(app: EditorApp, tx: Tx, clip: ClipId, targets: readonly Target[], args: Args): KeyId[] {
  const frames = args['frames'] as readonly number[] | undefined;
  const range = args['range'] as { start: number; end: number } | undefined;
  const out: KeyId[] = [];
  const layer = tx.query.baseLayer(clip);
  if (layer === undefined) return out;
  for (const t of targets) {
    const curve = tx.query.curveFor(clip, layer.id, t.control, t.channel);
    if (curve === undefined) continue;
    for (const key of tx.query.keysOfCurve(curve.id)) {
      if (frames !== undefined && !frames.some((f) => Math.abs(f - key.t) <= 1e-6)) continue;
      if (range !== undefined && (key.t < range.start - 1e-6 || key.t > range.end + 1e-6)) continue;
      out.push(key.id);
    }
  }
  void app;
  return out;
}

function runtimeOfClip(app: EditorApp, clip: ClipId) {
  const record = app.store.get('clips', clip);
  const runtime = record === undefined ? undefined : app.characters.get(record.character);
  if (runtime === undefined) throw new Error('double: no runtime');
  return runtime;
}

function register(app: EditorApp): void {
  if (registered.has(app)) return;
  registered.add(app);
  const op = (
    id: string,
    def: {
      poll?: (args: Args) => true | { ok: false; reason: string };
      /** The step label when the operator sets its own (§4.10), else the tool's `label` argument. */
      label?: (args: Args) => string;
      apply: (tx: Tx, args: Args, ctx: { readonly app: EditorApp }) => unknown;
    },
  ): void => {
    app.operators.register<Args, unknown, void>({
      id: `${PREFIX}${id}` as `${string}.${string}`,
      label: id,
      category: 'test',
      scope: 'global',
      flags: { undo: true, internal: true },
      undoLabel: (args) => def.label?.(args) ?? (typeof args['label'] === 'string' ? args['label'] : id),
      poll: (_ctx, args) => def.poll?.(args) ?? true,
      apply: (ctx, args) => {
        if (ctx.tx === null) throw new Error('double: no transaction');
        return def.apply(ctx.tx, args, { app: ctx.app });
      },
    });
  };

  op('key.write', {
    poll(args) {
      const keys = (args['keys'] as { frame: number }[] | undefined) ?? [];
      const pose = args['poseAt'] as { frames: number[] } | undefined;
      const frames = [...keys.map((k) => k.frame), ...(pose?.frames ?? [])];
      if (args['extendRange'] !== true && outside(app, args['clip'] as ClipId, frames)) {
        return { ok: false, reason: 'a frame is outside the clip range' };
      }
      return true;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      let written = 0;
      let curvesCreated = 0;
      const items: {
        control: ControlId;
        channel: ChannelId;
        frame: number;
        value: number;
        inType?: TangentType;
        outType?: TangentType;
        breakdown?: boolean;
      }[] = [...((args['keys'] as typeof items | undefined) ?? [])];
      const pose = args['poseAt'] as { controls: ControlId[]; frames: number[] } | undefined;
      if (pose !== undefined) {
        for (const frame of pose.frames) {
          for (const control of pose.controls) {
            const record = tx.get('controls', control);
            if (record === undefined) continue;
            for (const channel of ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const) {
              if (!isKeyable(record, channel) || isLocked(record, channel)) continue;
              items.push({ control, channel, frame, value: keyedValue(app, clip, control, channel, frame) });
            }
          }
        }
      }
      const rangeExtended = growRange(
        tx,
        clip,
        items.map((i) => i.frame),
        args['extendRange'] as boolean | undefined,
      );
      const layer = tx.query.baseLayer(clip);
      for (const item of items) {
        const existed =
          layer !== undefined && tx.query.curveFor(clip, layer.id, item.control, item.channel) !== undefined;
        const curve = ensureCurve(app, tx, clip, item.control, item.channel);
        if (!existed) curvesCreated++;
        writeKeyAt(app, tx, curve, item.frame, item.value, tangents(app, item.inType, item.outType), {
          breakdown: item.breakdown === true,
          existing: 'set',
        });
        written++;
      }
      return { written, curvesCreated, rangeExtended, hiddenByOverrides: [] };
    },
  });

  op('key.delete', {
    apply(tx, args) {
      const ids = keysAt(app, tx, args['clip'] as ClipId, args['targets'] as Target[], args);
      return { deleted: deleteKeys(app, tx, ids) };
    },
  });

  op('key.adjust', {
    poll(args) {
      return args['falloffFrames'] !== undefined && args['falloffFrames'] !== 0 ? NOT_MODELLED : true;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const record = clipOf(tx, clip);
      const range = (args['range'] as { start: number; end: number } | undefined) ?? record.range;
      const factor = (args['factor'] as number | undefined) ?? 1;
      const offset = (args['offset'] as Record<string, number> | undefined) ?? {};
      const pivot = (args['pivot'] as { kind: string; frame?: number; value?: number } | undefined) ?? { kind: 'rest' };
      const skipped: (Target & { reason: string })[] = [];
      let keys = 0;
      let curves = 0;
      const layer = tx.query.baseLayer(clip);
      for (const t of args['targets'] as Target[]) {
        const control = tx.get('controls', t.control);
        if (control === undefined) continue;
        if (isLocked(control, t.channel)) {
          skipped.push({ ...t, reason: 'locked' });
          continue;
        }
        const curve = layer === undefined ? undefined : tx.query.curveFor(clip, layer.id, t.control, t.channel);
        const all = curve === undefined ? [] : tx.query.keysOfCurve(curve.id);
        const inside = all.filter((key) => {
          const frames = args['frames'] as number[] | undefined;
          if (frames !== undefined) return frames.some((f) => Math.abs(f - key.t) <= 1e-6);
          return key.t >= range.start - 1e-6 && key.t <= range.end + 1e-6;
        });
        if (curve === undefined || inside.length === 0) {
          skipped.push({ ...t, reason: 'no_keys' });
          continue;
        }
        const value = (f: number) => keyedValue(app, clip, t.control, t.channel, f);
        let p = channelDefaultOf(control, t.channel);
        if (pivot.kind === 'mean') {
          let sum = 0;
          let n = 0;
          for (let f = Math.ceil(range.start); f <= range.end; f++) {
            sum += value(f);
            n++;
          }
          p = n === 0 ? p : sum / n;
        } else if (pivot.kind === 'rangeStart') p = value(range.start);
        else if (pivot.kind === 'frame') p = value(pivot.frame ?? 0);
        else if (pivot.kind === 'value') p = pivot.value ?? 0;
        const kind = t.channel.startsWith('@')
          ? 'attr'
          : t.channel.startsWith('r')
            ? 'rotate'
            : t.channel.startsWith('t')
              ? 'translate'
              : 'scale';
        const add = offset[kind] ?? 0;
        for (const key of inside) {
          tx.put('keys', {
            ...key,
            v: p + factor * (key.v - p) + add,
            inHandle: { dt: key.inHandle.dt, dv: key.inHandle.dv * factor },
            outHandle: { dt: key.outHandle.dt, dv: key.outHandle.dv * factor },
          });
          keys++;
        }
        curves++;
      }
      return { keys, curves, skipped };
    },
  });

  op('key.retime', {
    poll(args) {
      return args['mode'] === 'offset' || args['mode'] === 'scale' ? true : NOT_MODELLED;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const ids = keysAt(app, tx, clip, args['targets'] as Target[], {});
      const opts = { snap: args['snapToFrames'] !== false, resolveCollisions: true };
      const result =
        args['mode'] === 'offset'
          ? moveKeys(app, tx, ids, args['offset'] as number, 0, opts)
          : scaleKeys(app, tx, ids, args['pivot'] as number, args['factor'] as number, opts);
      return { moved: result.moved, merged: result.deleted.length, clamped: 0, snapped: 0, contactFrame: null };
    },
  });

  op('pose.setAt', {
    poll(args) {
      return args['mode'] === 'propose' ? NOT_MODELLED : true;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const frame = args['frame'] as number;
      const edits = args['edits'] as (Target & { value: number })[];
      const mode = args['mode'] as 'key' | 'static';
      const skipped: (Target & { reason: string })[] = [];
      let keyed = 0;
      let synced = 0;
      let statics = 0;
      if (mode === 'key') growRange(tx, clip, [frame], args['extendRange'] as boolean | undefined);
      const edited = new Set<string>();
      const layer = tx.query.baseLayer(clip);
      for (const edit of edits) {
        const control = tx.get('controls', edit.control);
        if (control === undefined) continue;
        if (!isKeyable(control, edit.channel)) {
          skipped.push({ control: edit.control, channel: edit.channel, reason: 'non-keyable' });
          continue;
        }
        if (isLocked(control, edit.channel)) {
          skipped.push({ control: edit.control, channel: edit.channel, reason: 'locked' });
          continue;
        }
        if (mode === 'static') {
          const curve = layer === undefined ? undefined : tx.query.curveFor(clip, layer.id, edit.control, edit.channel);
          if (curve !== undefined && tx.query.keysOfCurve(curve.id).length > 0) {
            skipped.push({ control: edit.control, channel: edit.channel, reason: 'animated' });
            continue;
          }
          const id = ensureCurve(app, tx, clip, edit.control, edit.channel);
          tx.patch('curves', id, { staticValue: edit.value });
          statics++;
          continue;
        }
        const curve = ensureCurve(app, tx, clip, edit.control, edit.channel);
        writeKeyAt(app, tx, curve, frame, edit.value, tangents(app, args['tangent'] as TangentType | undefined), {
          existing: 'set',
        });
        edited.add(`${edit.control} ${edit.channel}`);
        keyed++;
      }
      if (mode === 'key' && args['syncRotation'] !== false) {
        for (const edit of edits) {
          if (!edit.channel.startsWith('r')) continue;
          const control = tx.get('controls', edit.control);
          if (control === undefined) continue;
          for (const channel of ['rx', 'ry', 'rz'] as const) {
            const name = `${edit.control} ${channel}`;
            if (edited.has(name) || !isKeyable(control, channel) || isLocked(control, channel)) continue;
            edited.add(name);
            const curve = ensureCurve(app, tx, clip, edit.control, channel);
            writeKeyAt(app, tx, curve, frame, keyedValue(app, clip, edit.control, channel, frame), tangents(app), {
              existing: 'keep',
            });
            synced++;
          }
        }
      }
      return { keyed, synced, statics, skipped, hiddenByOverrides: [] };
    },
  });

  op('pose.goals', {
    poll(args) {
      const ik = (args['ik'] as { ensureIk: string }[] | undefined) ?? [];
      return ik.some((entry) => entry.ensureIk === 'auto') ? NOT_MODELLED : true;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const frame = args['frame'] as number;
      growRange(tx, clip, [frame], args['extendRange'] as boolean | undefined);
      const runtime = runtimeOfClip(app, clip);
      const program = runtime.program;
      const ch: ChannelBuffer = program.allocChannels();
      runtime.sampler(clip).sample(frame, ch);
      const pose = program.allocPose();
      program.evaluate(ch, pose);
      const rest = poses.restPoseOf(program);
      let keyed = 0;
      const keyControl = (control: ControlId, channels: readonly ChannelId[]): void => {
        const record = tx.get('controls', control);
        if (record === undefined) return;
        const values = readControlChannels(program, ch, control);
        for (const channel of channels) {
          if (!isKeyable(record, channel) || isLocked(record, channel)) continue;
          const curve = ensureCurve(app, tx, clip, control, channel);
          writeKeyAt(app, tx, curve, frame, values[channel as 'rx'], tangents(app), { existing: 'set' });
          keyed++;
        }
      };
      const aims = [];
      for (const aim of (args['aims'] as { bone: string; direction: Vec3; weight: number }[] | undefined) ?? []) {
        const node = poses.nodeOfBone(runtime, aim.bone);
        const now = poses.nodeXf(pose, node);
        const before = poses.nodeXf(rest, node);
        const restDir = (() => {
          const child = poses.firstChildOf(runtime, node);
          const at = before.position;
          const tip = child === -1 ? ([at[0], at[1] + 0.1, at[2]] as Vec3) : poses.nodeXf(rest, child).position;
          const d: Vec3 = [tip[0] - at[0], tip[1] - at[1], tip[2] - at[2]];
          const l = Math.hypot(...d);
          return [d[0] / l, d[1] / l, d[2] / l] as Vec3;
        })();
        const delta = quatMultiply(now.rotation, quatInvert(before.rotation));
        const current = quatRotateVec3(delta, restDir);
        const arc = quatSlerp([0, 0, 0, 1], quatShortestArc(current, aim.direction), aim.weight);
        const desired: Quat = quatNormalize(quatMultiply(arc, now.rotation));
        const world = mat4Compose({ t: now.position, q: desired, s: [1, 1, 1] });
        const solved = solveBoneChannels(program, pose, new Map([[node, world]]), new Map());
        for (const [control, values] of solved) {
          writeControlChannels(program, ch, control, values);
          keyControl(control, ['rx', 'ry', 'rz']);
        }
        program.evaluate(ch, pose);
        const after = poses.nodeXf(pose, node);
        const achieved = quatRotateVec3(quatMultiply(after.rotation, quatInvert(before.rotation)), restDir);
        const dot = achieved[0] * aim.direction[0] + achieved[1] * aim.direction[1] + achieved[2] * aim.direction[2];
        aims.push({
          bone: aim.bone,
          control: [...solved.keys()][0] ?? ('' as ControlId),
          achieved,
          errorRad: Math.acos(Math.max(-1, Math.min(1, dot))),
        });
      }
      const ik = [];
      for (const entry of (args['ik'] as { limb: string; position: Vec3; rotation?: Quat }[] | undefined) ?? []) {
        const limb = program.limbs.find((candidate) => candidate.id === entry.limb);
        if (limb === undefined) throw new Error('double: no limb');
        const end = poses.nodeXf(pose, limb.nodes.end);
        const world = mat4Compose({ t: entry.position, q: entry.rotation ?? end.rotation, s: [1, 1, 1] });
        const reference = readControlChannels(program, ch, limb.params.ikControl);
        const values = ikControlForEndWorld(program, pose, ch, limb.id, world, reference);
        writeControlChannels(program, ch, limb.params.ikControl, values);
        keyControl(limb.params.ikControl, ['tx', 'ty', 'tz', 'rx', 'ry', 'rz']);
        program.evaluate(ch, pose);
        const reached = poses.nodeXf(pose, limb.nodes.end).position;
        const errorM = Math.hypot(
          reached[0] - entry.position[0],
          reached[1] - entry.position[1],
          reached[2] - entry.position[2],
        );
        ik.push({ limb: limb.id, reached: errorM < 1e-3, errorM, switched: null });
      }
      void quatAngle;
      void readAttr;
      return { aims, ik, keyed };
    },
  });

  op('pose.transfer', {
    poll(args) {
      return args['mirror'] === 'none' ? true : NOT_MODELLED;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const from = (args['fromClip'] as ClipId | undefined) ?? clip;
      const toFrames = args['toFrames'] as number[];
      growRange(tx, clip, toFrames, args['extendRange'] as boolean | undefined);
      let keyed = 0;
      for (const control of args['controls'] as ControlId[]) {
        const record = tx.get('controls', control);
        if (record === undefined) continue;
        for (const channel of ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const) {
          if (!isKeyable(record, channel) || isLocked(record, channel)) continue;
          const value = keyedValue(app, from, control, channel, args['fromFrame'] as number);
          const curve = ensureCurve(app, tx, clip, control, channel);
          for (const frame of toFrames) {
            writeKeyAt(app, tx, curve, frame, value, tangents(app), { existing: 'set' });
            keyed++;
          }
        }
      }
      return { keyed };
    },
  });

  op('clip.makeLoop', {
    poll(args) {
      return args['method'] === 'blend' ? NOT_MODELLED : true;
    },
    apply(tx, args) {
      const clip = args['clip'] as ClipId;
      const record = clipOf(tx, clip);
      const layer = tx.query.baseLayer(clip);
      const curves = layer === undefined ? [] : tx.query.curvesOfClip(clip).filter((c) => c.layer === layer.id);
      const seam = () => {
        let maxC0 = 0;
        const worst: Target[] = [];
        for (const curve of curves) {
          const a = keyedValue(app, clip, curve.control, curve.channel, record.range.start);
          const b = keyedValue(app, clip, curve.control, curve.channel, record.range.end);
          const c0 = Math.abs(b - a);
          if (c0 > maxC0) {
            maxC0 = c0;
            worst.unshift({ control: curve.control, channel: curve.channel });
          }
        }
        return { maxC0, maxC1: 0, worst: worst.slice(0, 5) };
      };
      const before = seam();
      if (args['dryRun'] === true) return { before, after: before, curvesChanged: 0 };
      let curvesChanged = 0;
      if (args['method'] === 'matchEnds') {
        for (const curve of curves) {
          if (tx.query.keysOfCurve(curve.id).length === 0) continue;
          const start = keyedValue(app, clip, curve.control, curve.channel, record.range.start);
          writeKeyAt(app, tx, curve.id, record.range.end, start, tangents(app), { existing: 'set' });
          curvesChanged++;
        }
      }
      tx.patch('clips', clip, { loop: true });
      for (const curve of curves) tx.patch('curves', curve.id, { pre: 'cycle', post: 'cycle' });
      return { before, after: { maxC0: 0, maxC1: 0, worst: [] }, curvesChanged };
    },
  });

  op('edit.revertSteps', {
    // §4.10: an actor run is labelled `AI: Revert N steps` (the runner adds the prefix)
    label: (args) => `Revert ${(args['steps'] as number[]).length} steps`,
    poll(args) {
      const steps = args['steps'] as number[];
      const undo = app.history.entries().undo;
      return steps.every((id) => undo.some((step) => step.id === id && (step.changes?.length ?? 0) > 0))
        ? true
        : { ok: false, reason: 'a step is not on the undo stack or has no changes' };
    },
    apply(tx, args) {
      const steps = [...(args['steps'] as number[])].sort((a, b) => b - a);
      const undo = app.history.entries().undo;
      const skippedFields: { table: string; id: string; fields: readonly string[] | null }[] = [];
      for (const id of steps) {
        const step = undo.find((s) => s.id === id);
        const plan = planRestore(restoreHostOf(tx), step?.changes ?? [], 'undo');
        applyRestorePlan(tx, plan);
        for (const skip of plan.skipped)
          skippedFields.push({ table: skip.change.table, id: skip.change.id, fields: skip.fields });
      }
      return { reverted: steps, skipped: [], skippedFields };
    },
  });
}

/** The app with P1's operators: itself once P1 merged (READY.p1), else a view that runs the doubles. */
export function withP1(app: EditorApp): EditorApp {
  if (READY.p1) return app;
  register(app);
  const doubled: ReadonlySet<string> = new Set(DOUBLED);
  return new Proxy(app, {
    get(target, prop) {
      if (prop === 'runUntyped') {
        return (id: string, args?: unknown, ctx?: Parameters<EditorApp['runUntyped']>[2]) =>
          target.runUntyped(doubled.has(id) ? `${PREFIX}${id}` : id, args, ctx);
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
