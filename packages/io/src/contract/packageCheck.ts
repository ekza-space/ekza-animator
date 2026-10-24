// The byte-level rules of a character package (GAME-PROTOCOL-SPEC §7.2; CHARACTER-CONTRACT-SPEC §5.1, §8.9; C2): the
// TypeScript side of "one rule table, implemented twice" — what OMOBA's passport checks, run by Studio on the bytes it
// wrote (read-back) and on any package file (the conformance fixtures). Parameters come from the contract's rule table
// (`rules[].params`, the slot's window and markers, the rig, the packaging), never from code; a rule the contract does
// not list is not checked. Order as the gate verdicts expect (CC Appendix D): `pack.manifest`, `pack.contract`,
// `pack.target` (each stops the check), then `pack.bytes` (stops), then `pack.slot-known`, `pack.ref`,
// `pack.unreferenced` (warning) and `rig.humanoid` (an error stops before the slots), then every custom slot alone:
// `clip.channels`, `clip.sampler`, `clip.keys`, `clip.duration`, `clip.in-place`, `clip.loop-closure`, `clip.markers`,
// `clip.min-interval` (warning). Measured values (duration, keys, sample rate, hips drift, loop seam, markers) go with
// each slot. Pure and synchronous: parse, read accessors, no allocation from untrusted counts beyond the caps.
import { EkzaError } from '@ekza-studio/anim-core';
import { parseGlbSync } from '../glb/parse';
import { GltfReader } from '../gltf/accessor';
import {
  accessorsOf,
  animationsOf,
  COMPONENT_SIZE,
  type GltfAnimationDef,
  type GltfNodeDef,
  isIndex,
  isRecord,
  listField,
  nodesOf,
  TYPE_COMPONENTS,
} from '../gltf/schema';
import type { GltfJson } from '../types';
import type {
  ContractModel,
  ContractOffer,
  ContractRig,
  ContractRuleSeverity,
  ContractRuleSpec,
  ContractSlotSpec,
} from './model';
import { characterOffer, PACKAGE_MANIFEST_KEY, type PackageManifest, readPackageManifest } from './packageManifest';

export interface PackageIssue {
  readonly rule: string;
  readonly severity: ContractRuleSeverity;
  readonly message: string;
  /** A JSON pointer into the file, or null. */
  readonly path: string | null;
}

export type MeasuredValue = number | string | boolean | null;

export interface PackageSlotReport {
  readonly mode: 'custom' | 'default';
  /** `skipped`: a package-level error stopped the check before the slots. */
  readonly verdict: 'pass' | 'fail' | 'skipped';
  readonly issues: readonly PackageIssue[];
  readonly measured: Readonly<Record<string, MeasuredValue>>;
}

export interface PackageReport {
  readonly bytes: number;
  readonly manifest: PackageManifest | null;
  readonly contract: ContractModel | null;
  /** Package-level issues (`pack.*`, `rig.humanoid`). */
  readonly issues: readonly PackageIssue[];
  /** One entry per manifest slot (custom slots are checked; default slots pass). */
  readonly slots: Readonly<Record<string, PackageSlotReport>>;
  /** No error anywhere. */
  readonly ok: boolean;
}

export interface PackageCheckOptions {
  /** The contract of a revision this checker knows, or undefined (`pack.contract`). */
  readonly contract: (revision: string) => ContractModel | undefined;
  /** True for a revision Hub retired (`pack.contract`). */
  readonly retired?: (revision: string) => boolean;
}

type Vec3 = [number, number, number];
type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function numbers(value: unknown, length: number): number[] | null {
  return Array.isArray(value) && value.length === length && value.every((n) => typeof n === 'number') ? value : null;
}

/** Column-major local matrix of a node (matrix, or T·R·S). */
function localMatrix(node: GltfNodeDef): Mat4 {
  const matrix = numbers(node.matrix, 16);
  if (matrix !== null) return matrix;
  const [tx, ty, tz] = (numbers(node.translation, 3) as Vec3 | null) ?? [0, 0, 0];
  const [x, y, z, w] = (numbers(node.rotation, 4) as [number, number, number, number] | null) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (numbers(node.scale, 3) as Vec3 | null) ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ] as Mat4;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = Array.from({ length: 16 }, () => 0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** The rest pose of the file: parents and world matrices by node index (cycles read as roots). */
class Rest {
  readonly parent = new Map<number, number>();
  private readonly world = new Map<number, Mat4>();
  constructor(private readonly nodes: readonly GltfNodeDef[]) {
    nodes.forEach((node, index) => {
      for (const child of listField(node.children)) if (isIndex(child)) this.parent.set(child, index);
    });
  }
  worldOf(index: number, depth = 0): Mat4 {
    const known = this.world.get(index);
    if (known !== undefined) return known;
    const node = this.nodes[index] ?? {};
    const up = this.parent.get(index);
    const matrix =
      up === undefined || depth > this.nodes.length
        ? localMatrix(node)
        : multiply(this.worldOf(up, depth + 1), localMatrix(node));
    this.world.set(index, matrix);
    return matrix;
  }
  parentWorld(index: number): Mat4 {
    const up = this.parent.get(index);
    return up === undefined ? IDENTITY : this.worldOf(up);
  }
  position(index: number): Vec3 {
    const m = this.worldOf(index);
    return [m[12] as number, m[13] as number, m[14] as number];
  }
}

/** A direction (or offset) through the linear part of a matrix. */
const linear = (m: Mat4, v: Vec3): Vec3 => [
  (m[0] as number) * v[0] + (m[4] as number) * v[1] + (m[8] as number) * v[2],
  (m[1] as number) * v[0] + (m[5] as number) * v[1] + (m[9] as number) * v[2],
  (m[2] as number) * v[0] + (m[6] as number) * v[1] + (m[10] as number) * v[2],
];

/** The VRM humanoid of the file: its version and node index by bone name (null: no or two VRM extensions). */
function humanoidOf(json: GltfJson): { readonly version: 'vrm0' | 'vrm1' | null; readonly bones: Map<string, number> } {
  const root = json as unknown as Readonly<Record<string, unknown>>;
  const extensions = isRecord(root['extensions']) ? root['extensions'] : {};
  const v1 = extensions['VRMC_vrm'];
  const v0 = extensions['VRM'];
  const bones = new Map<string, number>();
  if (isRecord(v1) && isRecord(v0)) return { version: null, bones };
  if (isRecord(v1)) {
    const human = isRecord(v1['humanoid']) ? v1['humanoid']['humanBones'] : undefined;
    for (const [name, bone] of Object.entries(isRecord(human) ? human : {})) {
      if (isRecord(bone) && isIndex(bone['node'])) bones.set(name, bone['node']);
    }
    return { version: 'vrm1', bones };
  }
  if (isRecord(v0)) {
    const human = isRecord(v0['humanoid']) ? v0['humanoid']['humanBones'] : undefined;
    for (const bone of Array.isArray(human) ? human : []) {
      if (isRecord(bone) && typeof bone['bone'] === 'string' && isIndex(bone['node'])) {
        bones.set(bone['bone'], bone['node']);
      }
    }
    return { version: 'vrm0', bones };
  }
  return { version: null, bones };
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const round = (value: number, places = 6): number => Math.round(value * 10 ** places) / 10 ** places;
const secs = (value: number): string => `${(Math.round(value * 1000) / 1000).toFixed(3)} s`;

/** Accessor byte size from its definition (count × components × component size; no reading). */
function accessorBytes(json: GltfJson, index: unknown): number {
  const accessor = isIndex(index) ? accessorsOf(json)[index] : undefined;
  if (accessor === undefined) return 0;
  const components = TYPE_COMPONENTS[accessor.type] ?? 0;
  const size = COMPONENT_SIZE[accessor.componentType] ?? 0;
  return isIndex(accessor.count) ? accessor.count * components * size : 0;
}

/** `ekza_animation_v1` clip entries of the file by animation index. */
function clipMetaByIndex(json: GltfJson): Map<number, Readonly<Record<string, unknown>>> {
  const out = new Map<number, Readonly<Record<string, unknown>>>();
  const asset = (json as unknown as Readonly<Record<string, unknown>>)['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  const meta = isRecord(extras) ? extras['ekza_animation_v1'] : undefined;
  const clips = isRecord(meta) && Array.isArray(meta['clips']) ? meta['clips'] : [];
  for (const clip of clips) if (isRecord(clip) && isIndex(clip['index'])) out.set(clip['index'], clip);
  return out;
}

class Issues {
  readonly list: PackageIssue[] = [];
  constructor(private readonly rules: (id: string) => ContractRuleSpec | undefined) {}
  /** Adds an issue of `rule` when the contract lists it (its severity; `severity` overrides). */
  add(rule: string, message: string, path: string | null = null, severity?: ContractRuleSeverity): void {
    const spec = this.rules(rule);
    if (spec === undefined && severity === undefined) return;
    this.list.push({ rule, severity: severity ?? spec?.severity ?? 'error', message, path });
  }
  get errors(): boolean {
    return this.list.some((issue) => issue.severity === 'error');
  }
}

/** The structural package rules up to the contract (`pack.manifest`, `pack.contract`): fixed severity `error`. */
const ALWAYS = (): undefined => undefined;

interface Channel {
  readonly node: number | null;
  readonly path: string;
  readonly interpolation: string;
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly at: string;
}

function channelsOf(reader: GltfReader, animation: GltfAnimationDef, a: number): Channel[] | string {
  const samplers = listField(animation.samplers);
  const out: Channel[] = [];
  for (const [c, channel] of listField(animation.channels).entries()) {
    const sampler = isIndex(channel.sampler) ? samplers[channel.sampler] : undefined;
    if (sampler === undefined) return `animation ${a} channel ${c} has no sampler`;
    try {
      out.push({
        node: isRecord(channel.target) && isIndex(channel.target.node) ? channel.target.node : null,
        path: isRecord(channel.target) ? String(channel.target.path) : '',
        interpolation: typeof sampler.interpolation === 'string' ? sampler.interpolation : 'LINEAR',
        times: reader.readFloat(sampler.input),
        values: reader.readFloat(sampler.output),
        at: `/animations/${a}/channels/${c}`,
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return out;
}

/** Quaternion at key `i` of a rotation channel (the value of a CUBICSPLINE key is its middle element). */
function quatAt(channel: Channel, i: number): [number, number, number, number] {
  const stride = channel.interpolation === 'CUBICSPLINE' ? 12 : 4;
  const base = i * stride + (stride === 12 ? 4 : 0);
  const v = channel.values;
  return [v[base] as number, v[base + 1] as number, v[base + 2] as number, v[base + 3] as number];
}

function vec3At(channel: Channel, i: number): Vec3 {
  const stride = channel.interpolation === 'CUBICSPLINE' ? 9 : 3;
  const base = i * stride + (stride === 9 ? 3 : 0);
  const v = channel.values;
  return [v[base] as number, v[base + 1] as number, v[base + 2] as number];
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(...a) || 1;
  const lb = Math.hypot(...b) || 1;
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += ((a[i] as number) / la) * ((b[i] as number) / lb);
  return (2 * Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI;
}

interface SlotContext {
  readonly model: ContractModel;
  readonly rig: ContractRig | undefined;
  readonly rest: Rest;
  readonly bones: ReadonlyMap<string, number>;
  readonly legLength: number;
  readonly meta: ReadonlyMap<number, Readonly<Record<string, unknown>>>;
}

/** The `clip.*` rules of one custom animation slot. */
function checkAnimationSlot(
  ctx: SlotContext,
  spec: ContractSlotSpec,
  markers: Readonly<Record<string, number>>,
  index: number,
  channels: readonly Channel[],
  issues: Issues,
  rule: (id: string) => ContractRuleSpec | undefined,
): Record<string, MeasuredValue> {
  const anim = spec.animation;
  const measured: Record<string, MeasuredValue> = {};
  if (anim === null) return measured;
  const byNode = new Map<number, string>();
  for (const [bone, node] of ctx.bones) byNode.set(node, bone);
  const driven = new Set(ctx.rig?.drivenBones ?? []);

  // clip.channels
  const channelParams = rule('clip.channels')?.params ?? {};
  const translationBones = Array.isArray(channelParams['translation'])
    ? (channelParams['translation'] as unknown[]).filter((b): b is string => typeof b === 'string')
    : ['hips'];
  for (const channel of channels) {
    const bone = channel.node === null ? undefined : byNode.get(channel.node);
    const where = bone ?? (channel.node === null ? 'no node' : `node ${channel.node}`);
    if (channel.path === 'weights') issues.add('clip.channels', 'A morph weights channel', channel.at);
    else if (channel.path === 'scale') issues.add('clip.channels', `A scale channel on ${where}`, channel.at);
    else if (bone === undefined) issues.add('clip.channels', `A channel on ${where}, not a humanoid bone`, channel.at);
    else if (channel.path === 'rotation' && !driven.has(bone)) {
      issues.add('clip.channels', `${bone} is not a bone the game drives`, channel.at);
    } else if (channel.path === 'translation' && !translationBones.includes(bone)) {
      issues.add('clip.channels', `A translation channel on ${bone} (only ${translationBones.join(', ')})`, channel.at);
    } else if (channel.path !== 'rotation' && channel.path !== 'translation') {
      issues.add('clip.channels', `A ${channel.path || 'pathless'} channel on ${bone}`, channel.at);
    }
  }

  // clip.sampler and clip.keys
  const samplerParams = rule('clip.sampler')?.params ?? {};
  const allowed = Array.isArray(samplerParams['interpolation'])
    ? (samplerParams['interpolation'] as unknown[]).map(String)
    : ['LINEAR', 'STEP'];
  const timeEps = num(samplerParams['timeEpsilonSecs'], 1e-4);
  const startAt = num(samplerParams['startsAtSecs'], 0);
  const quatEps = num(samplerParams['unitQuatEpsilon'], 1e-3);
  const keysParams = rule('clip.keys')?.params ?? {};
  const maxKeys = num(keysParams['maxKeysPerChannel'], Number.POSITIVE_INFINITY);
  const maxHz = num(keysParams['maxSampleRateHz'], Number.POSITIVE_INFINITY);
  let duration = 0;
  let keys = 0;
  let rate = 0;
  for (const channel of channels) {
    const { times, at } = channel;
    keys = Math.max(keys, times.length);
    if (!allowed.includes(channel.interpolation)) {
      issues.add('clip.sampler', `${channel.interpolation} interpolation (${allowed.join(' or ')} only)`, at);
    }
    let sorted = true;
    let finiteTimes = true;
    for (let i = 0; i < times.length; i++) {
      const t = times[i] as number;
      if (!Number.isFinite(t)) finiteTimes = false;
      else duration = Math.max(duration, t);
      if (i > 0 && !((times[i - 1] as number) < t)) sorted = false;
    }
    if (!finiteTimes) issues.add('clip.sampler', 'A key time is not a number', at);
    else if (!sorted) issues.add('clip.sampler', 'Key times do not increase', at);
    const first = times[0];
    if (first !== undefined && Number.isFinite(first) && Math.abs(first - startAt) > timeEps) {
      issues.add('clip.sampler', `The first key is at ${secs(first)}, not ${secs(startAt)}`, at);
    }
    const valueCount = channel.values.length;
    let finiteValues = true;
    for (let i = 0; i < valueCount; i++) if (!Number.isFinite(channel.values[i])) finiteValues = false;
    if (!finiteValues) issues.add('clip.sampler', 'A key value is not a number', at);
    else if (channel.path === 'rotation') {
      for (let i = 0; i < times.length; i++) {
        const length = Math.hypot(...quatAt(channel, i));
        if (Math.abs(length - 1) > quatEps) {
          issues.add('clip.sampler', `A rotation key of length ${length.toFixed(4)} (not a unit quaternion)`, at);
          break;
        }
      }
    }
    if (times.length > maxKeys) issues.add('clip.keys', `${times.length} keys in one channel (≤ ${maxKeys})`, at);
    const last = times[times.length - 1];
    if (times.length > 1 && first !== undefined && last !== undefined && last > first) {
      const hz = (times.length - 1) / (last - first);
      rate = Math.max(rate, hz);
    }
  }
  if (rate > maxHz + 1e-6) issues.add('clip.keys', `Sampled at ${Math.round(rate)} Hz (≤ ${maxHz} Hz)`);
  measured['durationSecs'] = round(duration);
  measured['keys'] = keys;
  measured['sampleRateHz'] = round(rate, 3);

  // clip.duration
  if (rule('clip.duration') !== undefined) {
    const { minSecs, maxSecs } = anim.window;
    if (duration < minSecs - 1e-6 || duration > maxSecs + 1e-6) {
      issues.add('clip.duration', `${secs(duration)} is outside ${secs(minSecs)}–${secs(maxSecs)}`);
    }
  }

  // clip.in-place and clip.loop-closure (hips translation in world units of the parent, leg lengths)
  const hipsNode = ctx.bones.get('hips');
  const hips = channels.find((channel) => channel.node === hipsNode && channel.path === 'translation');
  const leg = ctx.legLength;
  if (hips !== undefined && hips.times.length > 0) {
    const parent = ctx.rest.parentWorld(hipsNode as number);
    const first = vec3At(hips, 0);
    let horizontal = 0;
    let vertical = 0;
    for (let i = 0; i < hips.times.length; i++) {
      const v = vec3At(hips, i);
      const d = linear(parent, [v[0] - first[0], v[1] - first[1], v[2] - first[2]]);
      horizontal = Math.max(horizontal, Math.hypot(d[0], d[2]));
      vertical = Math.max(vertical, Math.abs(d[1]));
    }
    measured['hipsDrift'] = round(horizontal / leg, 4);
    measured['hipsLift'] = round(vertical / leg, 4);
    const inPlace = rule('clip.in-place');
    if (inPlace !== undefined && anim.inPlace) {
      const cap = num(
        anim.playback === 'hold' ? inPlace.params['maxHorizontalHold'] : inPlace.params['maxHorizontal'],
        Number.POSITIVE_INFINITY,
      );
      const capUp = num(inPlace.params['maxVertical'], Number.POSITIVE_INFINITY);
      if (horizontal / leg > cap + 1e-9) {
        issues.add('clip.in-place', `The hips travel ${(horizontal / leg).toFixed(3)} leg lengths (≤ ${cap})`);
      } else if (vertical / leg > capUp + 1e-9) {
        issues.add('clip.in-place', `The hips rise ${(vertical / leg).toFixed(3)} leg lengths (≤ ${capUp})`);
      }
    }
  }
  const loopRule = rule('clip.loop-closure');
  if (anim.loop) {
    let seam = 0;
    for (const channel of channels) {
      if (channel.path !== 'rotation' || channel.times.length < 2) continue;
      seam = Math.max(seam, angleDeg(quatAt(channel, 0), quatAt(channel, channel.times.length - 1)));
    }
    measured['loopSeamDeg'] = round(seam, 3);
    let offset = 0;
    if (hips !== undefined && hips.times.length > 1) {
      const a = vec3At(hips, 0);
      const b = vec3At(hips, hips.times.length - 1);
      const d = linear(ctx.rest.parentWorld(hipsNode as number), [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      offset = Math.hypot(...d) / leg;
    }
    if (loopRule !== undefined) {
      const maxDeg = num(loopRule.params['maxBoneDegrees'], Number.POSITIVE_INFINITY);
      const maxOffset = num(loopRule.params['maxHipsOffset'], Number.POSITIVE_INFINITY);
      if (seam > maxDeg + 1e-9) issues.add('clip.loop-closure', `The loop's ends differ by ${seam.toFixed(1)}°`);
      else if (offset > maxOffset + 1e-9) {
        issues.add('clip.loop-closure', `The hips end ${offset.toFixed(3)} leg lengths from where they start`);
      }
    }
  }

  // clip.markers (seconds from the clip's first key; custom clips play at rate 1 from the start)
  const markersRule = rule('clip.markers');
  if (markersRule !== undefined) {
    const tolerance = num(markersRule.params['toleranceSecs'], 0);
    const meta = ctx.meta.get(index);
    for (const [name, marker] of Object.entries(anim.markers)) {
      const at = markers[name];
      if (at !== undefined) measured[`${name}Secs`.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = at;
      if (at === undefined) {
        if (marker.required) issues.add('clip.markers', `No ${name} time`);
        continue;
      }
      if (at < -tolerance || at > duration + tolerance) {
        issues.add('clip.markers', `The ${name} (${secs(at)}) is outside the clip (${secs(duration)})`);
      } else if (marker.maxSecs !== null && at > marker.maxSecs + tolerance) {
        issues.add('clip.markers', `The ${name} comes at ${secs(at)} (≤ ${secs(marker.maxSecs)})`);
      }
      const metaMarkers = isRecord(meta?.['markers']) ? meta['markers'] : {};
      const recorded = name === 'contact' ? meta?.['contactSeconds'] : metaMarkers[name];
      if (typeof recorded === 'number' && Math.abs(recorded - at) > tolerance) {
        issues.add('clip.markers', `The manifest's ${name} (${secs(at)}) differs from the clip's (${secs(recorded)})`);
      }
    }
  }

  // clip.min-interval (a warning: the next action cuts a longer clip)
  if (anim.minIntervalSecs !== null && duration > anim.minIntervalSecs + 1e-6) {
    issues.add('clip.min-interval', `The next attack cuts it after ${secs(anim.minIntervalSecs)}`);
  }
  return measured;
}

/** The `rig.humanoid` rules on the file's VRM humanoid (§4.2). */
function checkRig(
  json: GltfJson,
  rest: Rest,
  rig: ContractRig | undefined,
  containers: readonly string[],
  issues: Issues,
): { bones: Map<string, number>; legLength: number } {
  const { version, bones } = humanoidOf(json);
  const nodes = nodesOf(json);
  let legLength = rig?.lengthUnit.referenceM ?? 1;
  if (version === null) {
    issues.add('rig.humanoid', 'The file must be exactly one of VRM 0.x or VRM 1.0', '/extensions');
    return { bones, legLength };
  }
  if (!containers.includes(version)) issues.add('rig.humanoid', `${version} files are not accepted`, '/extensions');
  if (rig !== undefined) {
    const required = version === 'vrm0' ? [...rig.requiredBones, ...rig.requiredBonesVrm0] : rig.requiredBones;
    const missing = required.filter((bone) => {
      const node = bones.get(bone);
      return node === undefined || node >= nodes.length;
    });
    if (missing.length > 0) issues.add('rig.humanoid', `The humanoid has no ${missing.join(', ')}`, '/extensions');
    if (bones.size > rig.maxHumanoidBones) {
      issues.add('rig.humanoid', `${bones.size} humanoid bones (≤ ${rig.maxHumanoidBones})`, '/extensions');
    }
    if (nodes.length > rig.maxNodes) issues.add('rig.humanoid', `${nodes.length} nodes (≤ ${rig.maxNodes})`, '/nodes');
    if (rig.uniformScale === 'humanoid-bones-and-ancestors') {
      const checked = new Set<number>();
      for (const start of bones.values()) {
        for (let node: number | undefined = start; node !== undefined && !checked.has(node); ) {
          checked.add(node);
          const m = rest.worldOf(node);
          const s = [0, 4, 8].map((c) => Math.hypot(m[c] as number, m[c + 1] as number, m[c + 2] as number));
          if (Math.max(...s) - Math.min(...s) > 1e-5) {
            issues.add('rig.humanoid', `Node ${node} is scaled unevenly`, `/nodes/${node}`);
            break;
          }
          node = rest.parent.get(node);
        }
      }
    }
  }
  const hips = bones.get('hips');
  const feet = ['leftFoot', 'rightFoot'].map((bone) => bones.get(bone)).filter((node) => node !== undefined);
  if (hips !== undefined && feet.length > 0) {
    const floor = feet.reduce((sum, node) => sum + rest.position(node)[1], 0) / feet.length;
    const height = rest.position(hips)[1] - floor;
    if (Number.isFinite(height) && height > 1e-4) legLength = height;
  }
  return { bones, legLength };
}

/** The slot ids an offer lets a package list, and why a listed slot is refused (`pack.slot-known`). */
function checkSlots(
  model: ContractModel,
  offer: ContractOffer,
  manifest: PackageManifest,
  issues: Issues,
  slotKinds: readonly string[],
): void {
  for (const [slot, fill] of Object.entries(manifest.slots)) {
    const spec = model.slots[slot];
    const at = `/asset/extras/${PACKAGE_MANIFEST_KEY}/slots/${slot}`;
    if (spec === undefined || !offer.slots.includes(slot)) {
      issues.add('pack.slot-known', `'${slot}' is not a slot of ${offer.label}`, at);
    } else if (fill.mode === 'custom' && !spec.customizable) {
      issues.add(
        'pack.slot-known',
        spec.customizableFrom === null
          ? `${spec.label} takes no custom fill`
          : `${spec.label} opens with contract ${spec.customizableFrom}`,
        at,
      );
    } else if (fill.mode === 'custom' && (!slotKinds.includes(spec.kind) || !('animation' in fill))) {
      issues.add('pack.slot-known', `${spec.label} takes ${spec.kind === 'animation' ? 'a clip' : 'no clip'}`, at);
    }
  }
  if (offer.listing === 'every-customizable-slot') {
    const missing = offer.slots.filter((slot) => model.slots[slot]?.customizable === true && !(slot in manifest.slots));
    if (missing.length > 0) issues.add('pack.slot-known', `The manifest does not list ${missing.join(', ')}`);
  }
  for (const slot of offer.mustFill) {
    if (manifest.slots[slot]?.mode !== 'custom') issues.add('pack.slot-known', `${slot} must be filled`);
  }
}

/**
 * Checks a character package file against the contract its manifest names (§7.2). Never throws for bad input: every
 * problem is an issue of the rule it breaks.
 */
export function checkCharacterPackage(bytes: Uint8Array, opts: PackageCheckOptions): PackageReport {
  const fail = (
    issues: readonly PackageIssue[],
    manifest: PackageManifest | null = null,
    model: ContractModel | null = null,
  ): PackageReport => {
    const slots: Record<string, PackageSlotReport> = {};
    for (const [slot, fill] of Object.entries(manifest?.slots ?? {})) {
      slots[slot] = { mode: fill.mode, verdict: 'skipped', issues: [], measured: {} };
    }
    return { bytes: bytes.byteLength, manifest, contract: model, issues, slots, ok: false };
  };
  const pre = new Issues(ALWAYS);
  let json: GltfJson;
  let jsonBytes: number;
  let bin: Uint8Array | null;
  try {
    const parsed = parseGlbSync(bytes);
    json = parsed.json;
    jsonBytes = parsed.jsonByteLength;
    bin = parsed.bin;
  } catch (error) {
    pre.add('pack.manifest', error instanceof Error ? error.message : 'Not a glTF binary', null, 'error');
    return fail(pre.list);
  }
  const asset = (json as unknown as Readonly<Record<string, unknown>>)['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  const raw = isRecord(extras) ? extras[PACKAGE_MANIFEST_KEY] : undefined;
  const manifestAt = `/asset/extras/${PACKAGE_MANIFEST_KEY}`;
  if (raw === undefined) {
    pre.add('pack.manifest', `The file has no ${PACKAGE_MANIFEST_KEY} manifest`, '/asset/extras', 'error');
    return fail(pre.list);
  }
  let manifest: PackageManifest;
  try {
    manifest = readPackageManifest(raw);
  } catch (error) {
    pre.add('pack.manifest', error instanceof EkzaError ? error.message : String(error), manifestAt, 'error');
    return fail(pre.list);
  }
  const model = opts.contract(manifest.contract.revision);
  if (model === undefined || model.game !== manifest.contract.game) {
    pre.add(
      'pack.contract',
      model === undefined
        ? `Contract ${manifest.contract.revision.slice(0, 15)}… is not known`
        : `The contract is ${model.game}'s, not ${manifest.contract.game}'s`,
      `${manifestAt}/contract`,
      'error',
    );
    return fail(pre.list, manifest);
  }
  if (opts.retired?.(manifest.contract.revision) === true) {
    pre.add('pack.contract', 'The contract revision was retired', `${manifestAt}/contract`, 'error');
    return fail(pre.list, manifest, model);
  }
  const rules = new Map(model.rules.map((rule) => [rule.id, rule]));
  const rule = (id: string): ContractRuleSpec | undefined => rules.get(id);
  const issues = new Issues(rule);

  // pack.target
  const target = model.targets.find((entry) => entry.id === manifest.target.id);
  const offer = target?.accepts.find((entry) => entry.requirementId === manifest.target.requirementId);
  if (target === undefined) issues.add('pack.target', `'${manifest.target.id}' is not a target of the contract`);
  else if (offer === undefined || offer.package !== manifest.kind) {
    issues.add(
      'pack.target',
      offer === undefined
        ? `'${manifest.target.requirementId}' is not an offer of ${target.name}`
        : `${offer.requirementId} takes ${offer.package} packages, not ${manifest.kind}`,
      `${manifestAt}/target`,
    );
  } else if (manifest.kind !== 'character' || characterOffer(target) === undefined) {
    issues.add('pack.target', `Studio checks character packages only (${manifest.kind})`, `${manifestAt}/kind`);
  }
  if (issues.errors || offer === undefined || target === undefined) return fail(issues.list, manifest, model);
  const packaging = model.packaging[manifest.kind];

  // pack.bytes (checked before the slots)
  const animations = animationsOf(json);
  const custom = Object.entries(manifest.slots).filter(([, fill]) => fill.mode === 'custom');
  if (packaging !== undefined) {
    if (bytes.byteLength > packaging.maxBytes) {
      issues.add('pack.bytes', `The file is ${bytes.byteLength} bytes (≤ ${packaging.maxBytes})`);
    }
    if (jsonBytes > packaging.maxJsonBytes) {
      issues.add('pack.bytes', `The JSON chunk is ${jsonBytes} bytes (≤ ${packaging.maxJsonBytes})`);
    }
    if (custom.length > packaging.maxFills) {
      issues.add('pack.bytes', `${custom.length} custom slots (≤ ${packaging.maxFills})`, manifestAt);
    }
  }
  const maxAnimationBytes = num(rule('pack.bytes')?.params['maxAnimationBytes'], Number.POSITIVE_INFINITY);
  const referenced = new Set<number>();
  for (const [, fill] of custom) if ('animation' in fill) referenced.add(fill.animation);
  const counted = new Set<number>();
  let animationBytes = 0;
  for (const index of referenced) {
    const animation = animations[index];
    for (const sampler of listField(animation?.samplers)) {
      for (const accessor of [sampler.input, sampler.output]) {
        if (!isIndex(accessor) || counted.has(accessor)) continue;
        counted.add(accessor);
        animationBytes += accessorBytes(json, accessor);
      }
    }
  }
  if (animationBytes > maxAnimationBytes) {
    issues.add('pack.bytes', `The custom clips hold ${animationBytes} bytes of keys (≤ ${maxAnimationBytes})`);
  }
  if (issues.errors) return fail(issues.list, manifest, model);

  // pack.slot-known, pack.ref, pack.unreferenced, rig.humanoid
  checkSlots(model, offer, manifest, issues, packaging?.slotKinds ?? ['animation']);
  const nameEqualsSlot = rule('pack.ref')?.params['animationNameEqualsSlot'] !== false;
  const referencing = new Map<number, string[]>();
  for (const [slot, fill] of custom) {
    if (!('animation' in fill)) continue;
    if (fill.animation >= animations.length) {
      issues.add('pack.ref', `${slot} names animation ${fill.animation} of ${animations.length}`, manifestAt);
      continue;
    }
    referencing.set(fill.animation, [...(referencing.get(fill.animation) ?? []), slot]);
  }
  for (const [index, slots] of referencing) {
    const name = String(animations[index]?.name ?? '');
    if (nameEqualsSlot && !slots.includes(name)) {
      issues.add(
        'pack.ref',
        `Animation ${index} is named '${name}', not ${slots.join(' or ')}`,
        `/animations/${index}`,
      );
    }
  }
  const names = new Map<string, number>();
  animations.forEach((animation, index) => {
    const name = String(animation.name ?? '');
    const first = names.get(name);
    if (first !== undefined) issues.add('pack.ref', `Animations ${first} and ${index} are both named '${name}'`);
    else names.set(name, index);
  });
  animations.forEach((animation, index) => {
    if (!referenced.has(index)) {
      issues.add('pack.unreferenced', `No slot uses animation ${index} ('${String(animation.name ?? '')}')`);
    }
  });
  const rest = new Rest(nodesOf(json));
  const rig =
    model.rigs[model.slots[custom[0]?.[0] ?? '']?.animation?.rig ?? 'humanoid'] ?? Object.values(model.rigs)[0];
  const { bones, legLength } = checkRig(json, rest, rig, packaging?.containers ?? ['vrm1', 'vrm0'], issues);
  if (issues.errors) return fail(issues.list, manifest, model);

  // the custom slots, each on its own
  const reader = new GltfReader(json, bin);
  const meta = clipMetaByIndex(json);
  const ctx: SlotContext = { model, rig, rest, bones, legLength, meta };
  const read = new Map<number, Channel[] | string>();
  const slots: Record<string, PackageSlotReport> = {};
  let ok = true;
  for (const [slot, fill] of Object.entries(manifest.slots)) {
    const spec = model.slots[slot];
    if (fill.mode === 'default' || spec === undefined || !('animation' in fill)) {
      slots[slot] = { mode: fill.mode, verdict: 'pass', issues: [], measured: {} };
      continue;
    }
    let channels = read.get(fill.animation);
    if (channels === undefined) {
      channels = channelsOf(reader, animations[fill.animation] as GltfAnimationDef, fill.animation);
      read.set(fill.animation, channels);
    }
    const slotIssues = new Issues(rule);
    let measured: Record<string, MeasuredValue> = {};
    if (typeof channels === 'string') slotIssues.add('clip.sampler', channels, `/animations/${fill.animation}`);
    else measured = checkAnimationSlot(ctx, spec, fill.markers, fill.animation, channels, slotIssues, rule);
    const failed = slotIssues.errors;
    if (failed) ok = false;
    slots[slot] = { mode: 'custom', verdict: failed ? 'fail' : 'pass', issues: slotIssues.list, measured };
  }
  return { bytes: bytes.byteLength, manifest, contract: model, issues: issues.list, slots, ok };
}

/** The verdict shape of the conformance fixtures (`expected/<case>.json`, CC Appendix D). */
export interface GateVerdict {
  readonly pack: 'ok' | readonly string[];
  readonly warnings: readonly string[];
  readonly slots: Readonly<Record<string, 'pass' | readonly string[]>>;
  readonly slotWarnings: Readonly<Record<string, readonly string[]>>;
}

const ruleIds = (issues: readonly PackageIssue[], severity: ContractRuleSeverity): string[] => [
  ...new Set(issues.filter((issue) => issue.severity === severity).map((issue) => issue.rule)),
];

/**
 * A report as a gate verdict: the package's error rules (or `ok`), its warnings (none when it fails), and per custom
 * slot `pass` or its error rules, plus the slots' warnings.
 */
export function gateVerdict(report: PackageReport): GateVerdict {
  const errors = ruleIds(report.issues, 'error');
  if (errors.length > 0) return { pack: errors, warnings: [], slots: {}, slotWarnings: {} };
  const slots: Record<string, 'pass' | readonly string[]> = {};
  const slotWarnings: Record<string, readonly string[]> = {};
  for (const [slot, entry] of Object.entries(report.slots)) {
    if (entry.mode !== 'custom') continue;
    const failed = ruleIds(entry.issues, 'error');
    slots[slot] = failed.length === 0 ? 'pass' : failed;
    const warned = ruleIds(entry.issues, 'warning');
    if (warned.length > 0) slotWarnings[slot] = warned;
  }
  return { pack: 'ok', warnings: ruleIds(report.issues, 'warning'), slots, slotWarnings };
}

/**
 * `ekza.validation-report.v1` of a report (GAME-PROTOCOL-SPEC §7.5, Appendix C) for stage `tool`, or null when the
 * manifest or its contract could not be read (the report names both).
 */
export function validationReport(
  report: PackageReport,
  input: { readonly sha256: string; readonly validator: { readonly name: string; readonly version: string } },
): Readonly<Record<string, unknown>> | null {
  const { manifest, contract } = report;
  if (manifest === null || contract === null) return null;
  const issue = (entry: PackageIssue) => ({
    rule: entry.rule,
    severity: entry.severity,
    message: entry.message.slice(0, 500),
    path: entry.path,
  });
  const slots: Record<string, unknown> = {};
  for (const [slot, entry] of Object.entries(report.slots)) {
    slots[slot] = {
      mode: entry.mode,
      verdict: entry.verdict,
      issues: entry.issues.slice(0, 64).map(issue),
      measured: { ...entry.measured },
    };
  }
  return {
    schema: 'ekza.validation-report.v1',
    schemaVersion: '1.0',
    package: { sha256: input.sha256, bytes: report.bytes, kind: manifest.kind },
    contract: { game: contract.game, revision: contract.revision },
    stage: 'tool',
    validator: { name: input.validator.name, version: input.validator.version, rules: contract.rules.map((r) => r.id) },
    verdict: report.ok ? 'pass' : 'fail',
    issues: report.issues.slice(0, 256).map(issue),
    slots,
  };
}
