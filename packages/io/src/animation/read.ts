// readAnimations (MVP-SPEC §4.11.6 step 4): raw glTF animation data per channel, targets mapped to SkeletonDesc
// node indices. Times are made strictly increasing (keys at or before the previous time are dropped together with
// their values); channels whose data is inconsistent are truncated to the keys both accessors hold. Meshopt-compressed
// animation data cannot be decoded headlessly and throws EkzaError('compressed-animation').
import { EkzaError } from '@ekza-animator/anim-core';
import type { AnimPath, RawChannel, RawClip, SkeletonDesc } from '@ekza-animator/rig';
import { GltfReader } from '../gltf/accessor';
import { animationsOf, type GltfAnimationDef, isIndex, isRecord, listField, pointer } from '../gltf/schema';
import type { GlbContainer } from '../types';

type Interpolation = RawChannel['interpolation'];
type Skipped = RawClip['skipped'][number];

const PATH_COMPONENTS: Readonly<Record<Exclude<AnimPath, 'weights'>, number>> = {
  translation: 3,
  rotation: 4,
  scale: 3,
};

export function readAnimations(c: GlbContainer, skeleton: SkeletonDesc): RawClip[] {
  const reader = new GltfReader(c.json, c.bin);
  const animations = animationsOf(c.json);
  assertUncompressed(reader, animations);
  const nodeOf = new Map(skeleton.nodes.map((node) => [node.gltfIndex, node.index]));
  return animations.map((animation, index) => readClip(reader, animation, index, nodeOf));
}

function assertUncompressed(reader: GltfReader, animations: readonly GltfAnimationDef[]): void {
  animations.forEach((animation, a) => {
    const samplers = listField(animation.samplers);
    samplers.forEach((sampler, s) => {
      for (const accessor of [sampler.input, sampler.output]) {
        if (isIndex(accessor) && reader.isCompressed(accessor)) {
          throw new EkzaError(
            'compressed-animation',
            `Animation ${a} uses compressed (meshopt) data, which cannot be imported as editable curves`,
            { pointer: pointer('animations', a, 'samplers', s) },
          );
        }
      }
    });
  });
}

function readClip(
  reader: GltfReader,
  animation: GltfAnimationDef,
  index: number,
  nodeOf: ReadonlyMap<number, number>,
): RawClip {
  const channels: RawChannel[] = [];
  const skipped: Skipped[] = [];
  const samplers = listField(animation.samplers);
  const defs = listField(animation.channels);
  const times = new Map<number, Float32Array>();
  defs.forEach((def, k) => {
    const target: { readonly node?: unknown; readonly path?: unknown; readonly extensions?: unknown } = isRecord(
      def.target,
    )
      ? def.target
      : {};
    const path = target.path;
    const usesPointer =
      path === 'pointer' || (isRecord(target.extensions) && isRecord(target.extensions['KHR_animation_pointer']));
    if (usesPointer) {
      skipped.push({ reason: 'pointer', channel: k });
      return;
    }
    if (target.node === undefined) {
      skipped.push({ reason: 'no-target-node', channel: k });
      return;
    }
    if (path !== 'translation' && path !== 'rotation' && path !== 'scale' && path !== 'weights') {
      skipped.push({ reason: 'unsupported-path', channel: k });
      return;
    }
    const node = isIndex(target.node) ? nodeOf.get(target.node) : undefined;
    if (node === undefined) {
      skipped.push({ reason: 'unmatched-node', channel: k });
      return;
    }
    const sampler = isIndex(def.sampler) ? samplers[def.sampler] : undefined;
    if (sampler === undefined || !isIndex(sampler.input) || !isIndex(sampler.output)) {
      throw new EkzaError('malformed-gltf', `Channel ${k} of animation ${index} has no valid sampler`, {
        pointer: pointer('animations', index, 'channels', k),
      });
    }
    const interpolation = interpolationOf(sampler.interpolation);
    let input = times.get(sampler.input);
    if (input === undefined) {
      input = reader.readFloat(sampler.input);
      times.set(sampler.input, input);
    }
    const output = reader.readFloat(sampler.output);
    const perKey = interpolation === 'CUBICSPLINE' ? 3 : 1;
    const components =
      path === 'weights'
        ? Math.max(1, Math.round(output.length / Math.max(1, input.length * perKey)))
        : PATH_COMPONENTS[path];
    channels.push(cleanChannel(node, path, interpolation, input, output, components * perKey));
  });
  const duration = channels.reduce(
    (max, ch) => Math.max(max, ch.times.length > 0 ? (ch.times.at(-1) as number) : 0),
    0,
  );
  return {
    index,
    name: typeof animation.name === 'string' && animation.name !== '' ? animation.name : `animation_${index}`,
    duration,
    channels,
    skipped,
  };
}

function interpolationOf(value: unknown): Interpolation {
  return value === 'STEP' || value === 'CUBICSPLINE' ? value : 'LINEAR';
}

/** Truncates to the keys both arrays hold and drops keys whose time does not increase (or is not finite). */
function cleanChannel(
  node: number,
  path: AnimPath,
  interpolation: Interpolation,
  input: Float32Array,
  output: Float32Array,
  stride: number,
): RawChannel {
  const keys = Math.min(input.length, Math.floor(output.length / stride));
  const keep: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < keys; i++) {
    const t = input[i] as number;
    if (Number.isFinite(t) && t > last) {
      keep.push(i);
      last = t;
    }
  }
  if (keep.length === input.length && keys * stride === output.length) {
    return { node, path, interpolation, times: input, values: output };
  }
  const times = new Float32Array(keep.length);
  const values = new Float32Array(keep.length * stride);
  keep.forEach((src, dst) => {
    times[dst] = input[src] as number;
    values.set(output.subarray(src * stride, src * stride + stride), dst * stride);
  });
  return { node, path, interpolation, times, values };
}
