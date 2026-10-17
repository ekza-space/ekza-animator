import type { Fps, Frame } from '@ekza-animator/anim-core';
import { isHumanoidProgram } from '../inverse/solve';
import { internalsOf, type RigInternals } from '../kernel/internals';
import { allocXfArrays, type XfArrays, xfaCopy, xfaMul } from '../math/xfa';
import type { ImportedClipKeys, ImportRawOptions, RawChannel, RawClip, RigProgram } from '../types';
import {
  buildImportedCurves,
  createFrameMapper,
  FrameTable,
  groupMode,
  makeSolvePlan,
  SOLVE_ROTATE,
  type SlotKeys,
  type SolvePlan,
  type SourceWorlds,
} from './core';
import { type SampledTrack, sampleTrack, trackKeyCount } from './sample';

type TrsPath = 'translation' | 'rotation' | 'scale';
type NodeTracks = Partial<Record<TrsPath, SampledTrack>>;

const COMPONENTS: Readonly<Record<TrsPath, number>> = { translation: 3, rotation: 4, scale: 3 };

/** A raw channel with strictly increasing finite times and enough values; null when malformed. */
function validTrack(channel: RawChannel, components: number): SampledTrack | null {
  const { times, values, interpolation } = channel;
  if (times.length === 0) return null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    if (!Number.isFinite(t) || (i > 0 && t <= (times[i - 1] as number))) return null;
  }
  const track: SampledTrack = { times, values, interpolation };
  if (trackKeyCount(track, components) < times.length) return null;
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return null;
  return track;
}

/** The source clip's node locals at a time, composed into canonical worlds (W = F · Π L). */
class RawSource implements SourceWorlds {
  readonly worlds: XfArrays;
  private readonly local: XfArrays = allocXfArrays(1);
  private readonly sample: number[] = [0, 0, 0, 0];

  constructor(
    private readonly internals: RigInternals,
    private readonly tracks: readonly (NodeTracks | undefined)[],
  ) {
    this.worlds = allocXfArrays(internals.nodeCount);
  }

  prepare(seconds: number): void {
    const { internals, tracks, local, sample, worlds } = this;
    for (let node = 0; node < internals.nodeCount; node++) {
      xfaCopy(internals.restLocal, node, local, 0);
      const nodeTracks = tracks[node];
      if (nodeTracks !== undefined) {
        if (nodeTracks.translation !== undefined) {
          sampleTrack(nodeTracks.translation, 3, seconds, sample);
          for (let c = 0; c < 3; c++) local.t[c] = sample[c] as number;
        }
        if (nodeTracks.rotation !== undefined) {
          sampleTrack(nodeTracks.rotation, 4, seconds, sample);
          const len = Math.hypot(sample[0] as number, sample[1] as number, sample[2] as number, sample[3] as number);
          if (len > 0) for (let c = 0; c < 4; c++) local.q[c] = (sample[c] as number) / len;
        }
        if (nodeTracks.scale !== undefined) {
          sampleTrack(nodeTracks.scale, 3, seconds, sample);
          for (let c = 0; c < 3; c++) local.s[c] = sample[c] as number;
        }
      }
      const parent = internals.nodeParent[node] as number;
      if (parent === -1) xfaMul(internals.facing, 0, local, 0, worlds, node);
      else xfaMul(worlds, parent, local, 0, worlds, node);
    }
  }
}

/** Clip frame range [0, ceil(duration · fps)] with whole frames snapped within 1e-4 s (at least one frame long). */
export function clipRange(duration: number, fps: Fps): { readonly start: Frame; readonly end: Frame } {
  const perSecond = fps.num / fps.den;
  const frames = Math.max(0, Number.isFinite(duration) ? duration : 0) * perSecond;
  const whole = Math.round(frames);
  const end = Math.abs(frames - whole) / perSecond <= 1e-4 ? whole : Math.ceil(frames);
  return { start: 0, end: Math.max(end, 1) };
}

/** The import target of the nearest control ancestor with one, −1 for the character root. */
function anchorNode(internals: RigInternals, plan: SolvePlan, slot: number): number {
  let parent = internals.controlParent[slot] as number;
  while (parent !== -1) {
    const target = plan.target[parent] as number;
    if (target !== -1) return target;
    parent = internals.controlParent[parent] as number;
  }
  return -1;
}

/** Nodes whose motion changes the control's local transform: its target up to (excluding) the anchor bone. */
function influencePath(internals: RigInternals, plan: SolvePlan, slot: number): number[] {
  const target = plan.target[slot] as number;
  if (target === -1) return [];
  const anchor = anchorNode(internals, plan, slot);
  let isAncestor = false;
  for (let n = internals.nodeParent[target] as number; n !== -1; n = internals.nodeParent[n] as number) {
    if (n === anchor) {
      isAncestor = true;
      break;
    }
  }
  const path: number[] = [];
  for (let n = target; n !== -1 && !(isAncestor && n === anchor); n = internals.nodeParent[n] as number) path.push(n);
  return path;
}

/**
 * Imports a glTF animation onto the controls of `program` (MVP-SPEC §4.11.6): source tracks are sampled with their
 * glTF interpolation, bone worlds solved onto controls top-down (humanoid rigs: hips motion on `cog`, `fk.hips` and
 * `root` at rest) at the source key times (or every integer frame with `keyMode: 'resample'`), rotations converted
 * with eulerNear against the previous key and Euler-filtered; tangents follow the source interpolation, curves equal
 * to their channel default are not created and `reduce` runs `reduceKeys` per curve.
 */
export function importRawClip(raw: RawClip, program: RigProgram, opts: ImportRawOptions): ImportedClipKeys {
  const internals = internalsOf(program);
  const warnings: string[] = [];
  const nodes = program.skeleton.nodes;
  const nodeName = (node: number): string => nodes[node]?.name || `#${node}`;

  for (const skipped of raw.skipped) {
    warnings.push(`Channel ${skipped.channel} of "${raw.name}" was skipped by the reader (${skipped.reason})`);
  }
  const tracks: (NodeTracks | undefined)[] = Array.from({ length: internals.nodeCount }, () => undefined);
  let maxTime = 0;
  raw.channels.forEach((channel, index) => {
    if (!Number.isInteger(channel.node) || channel.node < 0 || channel.node >= internals.nodeCount) {
      warnings.push(`Channel ${index} targets node ${channel.node}, which is not in the skeleton; dropped`);
      return;
    }
    if (channel.path === 'weights') {
      warnings.push(`Morph target weights of "${nodeName(channel.node)}" are not imported (V1)`);
      return;
    }
    const track = validTrack(channel, COMPONENTS[channel.path]);
    if (track === null) {
      warnings.push(`Malformed ${channel.path} track of "${nodeName(channel.node)}" (times or values); dropped`);
      return;
    }
    const entry = tracks[channel.node] ?? {};
    if (entry[channel.path] !== undefined) {
      warnings.push(`Duplicate ${channel.path} track of "${nodeName(channel.node)}"; the first one is used`);
      return;
    }
    entry[channel.path] = track;
    tracks[channel.node] = entry;
    maxTime = Math.max(maxTime, track.times[track.times.length - 1] as number);
  });

  const plan = makeSolvePlan(internals, isHumanoidProgram(program));
  const range = clipRange(Math.max(maxTime, Number.isFinite(raw.duration) ? raw.duration : 0), opts.fps);
  const resample = opts.keyMode === 'resample';
  const mapper = createFrameMapper(opts.fps);
  const table = new FrameTable(mapper);
  if (!resample) {
    for (const entry of tracks) {
      if (entry === undefined) continue;
      for (const track of Object.values(entry)) for (const t of track.times) table.add(t);
    }
  }

  const used = new Set<number>();
  const slots: (SlotKeys | null)[] = [];
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const path = influencePath(internals, plan, slot);
    const all = new Set<string>();
    const byGroup: Record<TrsPath, Set<string>> = { translation: new Set(), rotation: new Set(), scale: new Set() };
    const seconds: number[] = [];
    for (const node of path) {
      const entry = tracks[node];
      if (entry === undefined) continue;
      used.add(node);
      for (const path of ['translation', 'rotation', 'scale'] as const) {
        const track = entry[path];
        if (track === undefined) continue;
        all.add(track.interpolation);
        byGroup[path].add(track.interpolation);
        if (path !== 'rotation' || node !== plan.target[slot]) byGroup.translation.add(track.interpolation);
        for (const t of track.times) seconds.push(t);
      }
    }
    if (all.size === 0) {
      slots.push(null);
      continue;
    }
    const pick = (group: TrsPath): Set<string> => (byGroup[group].size > 0 ? byGroup[group] : all);
    let keys: { readonly seconds: number[]; readonly frames: Frame[] };
    if (resample) {
      const perSecond = opts.fps.num / opts.fps.den;
      const frames: Frame[] = [];
      for (let f = range.start; f <= range.end; f++) frames.push(f);
      keys = { frames, seconds: frames.map((f) => f / perSecond) };
    } else {
      keys = table.keys(seconds);
    }
    slots.push({
      ...keys,
      rotation: groupMode(pick('rotation'), true, resample),
      translation: groupMode(pick('translation'), false, resample),
      scale: groupMode(pick('scale'), false, resample),
    });
  }

  // Tracks no control can carry.
  const spring = new Set(program.skeleton.springJoints);
  const constrained = new Set(program.skeleton.constrainedNodes);
  tracks.forEach((entry, node) => {
    if (entry === undefined || used.has(node) || !movesAwayFromRest(internals, node, entry)) return;
    const reason = spring.has(node)
      ? 'a spring-bone joint'
      : constrained.has(node)
        ? 'a node-constraint destination'
        : 'not driven by any control';
    warnings.push(`Animation of "${nodeName(node)}" was dropped: the node is ${reason}`);
  });
  translationWarnings(internals, plan, tracks, warnings, nodeName);

  if (mapper.subFrame) {
    warnings.push(
      `Source times of "${raw.name}" are not on whole frames at ${opts.fps.num}/${opts.fps.den} fps; sub-frame keys were created`,
    );
  }
  const curves = buildImportedCurves(internals, plan, new RawSource(internals, tracks), slots, opts);
  return { fps: opts.fps, range, curves, warnings };
}

/** Whether any track of `node` leaves its rest local value (1e-6; rotations compared up to sign). */
function movesAwayFromRest(internals: RigInternals, node: number, entry: NodeTracks): boolean {
  for (const path of ['translation', 'rotation', 'scale'] as const) {
    const track = entry[path];
    if (track === undefined) continue;
    const components = COMPONENTS[path];
    const rest = path === 'translation' ? internals.restLocal.t : path === 'rotation' ? internals.restLocal.q : internals.restLocal.s;
    const cubic = track.interpolation === 'CUBICSPLINE';
    for (let k = 0; k < track.times.length; k++) {
      const base = cubic ? (3 * k + 1) * components : k * components;
      if (path === 'rotation') {
        let dot = 0;
        let norm = 0;
        for (let c = 0; c < 4; c++) {
          dot += (track.values[base + c] as number) * (rest[node * 4 + c] as number);
          norm += (track.values[base + c] as number) ** 2;
        }
        if (1 - Math.abs(dot) / Math.sqrt(norm) > 1e-9) return true;
      } else {
        for (let c = 0; c < 3; c++) {
          if (Math.abs((track.values[base + c] as number) - (rest[node * 3 + c] as number)) > 1e-6) return true;
        }
      }
    }
  }
  return false;
}

/** Rotate-bound targets cannot move: warn when their translation (or scale) track leaves the rest value. */
function translationWarnings(
  internals: RigInternals,
  plan: SolvePlan,
  tracks: readonly (NodeTracks | undefined)[],
  warnings: string[],
  nodeName: (node: number) => string,
): void {
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const node = plan.target[slot] as number;
    if (node === -1) continue;
    const entry = tracks[node];
    if (entry === undefined) continue;
    const keyable = internals.keyable;
    for (const [path, offset, rest] of [
      ['translation', 0, internals.restLocal.t],
      ['scale', 6, internals.restLocal.s],
    ] as const) {
      const track = entry[path];
      if (track === undefined) continue;
      const free = keyable[slot * 9 + offset] === 1 || plan.mode[slot] !== SOLVE_ROTATE;
      if (free) continue;
      const stride = track.interpolation === 'CUBICSPLINE' ? 9 : 3;
      const base = track.interpolation === 'CUBICSPLINE' ? 3 : 0;
      let moved = false;
      for (let k = 0; k < track.times.length && !moved; k++) {
        for (let c = 0; c < 3; c++) {
          const value = track.values[k * stride + base + c] as number;
          if (Math.abs(value - (rest[node * 3 + c] as number)) > 1e-4) moved = true;
        }
      }
      if (moved) {
        warnings.push(`The ${path} animation of "${nodeName(node)}" was dropped: its control is rotate-only`);
      }
    }
  }
}
