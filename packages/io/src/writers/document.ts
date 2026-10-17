// glTF Transform helpers for the fresh documents of the animation-only GLB and VRMA writers (ADR 0005 §7–8). glTF
// Transform writes documents we create; the user's original file is only ever changed by the surgeon.
import { type Accessor, type Animation, type Buffer, Document, Logger, type Node, WebIO } from '@gltf-transform/core';
import type { BakedClip, BakedTrack } from '../types';
import { VRMCVrmAnimation } from '../vrma/extension';

export function newDocument(generator: string, extras: Readonly<Record<string, unknown>>): Document {
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const asset = doc.getRoot().getAsset();
  asset.generator = generator;
  asset.extras = { ...extras };
  return doc;
}

/** Accessors for identical time arrays are shared (one input accessor per distinct array). */
export class InputAccessors {
  private readonly buckets = new Map<string, { readonly times: Float32Array; readonly accessor: Accessor }[]>();

  constructor(
    private readonly doc: Document,
    private readonly buffer: Buffer,
  ) {}

  get(times: Float32Array): Accessor {
    const key = `${times.length}:${times[0] ?? 0}:${times[times.length - 1] ?? 0}`;
    const bucket = this.buckets.get(key) ?? [];
    const found = bucket.find((entry) => sameArray(entry.times, times));
    if (found !== undefined) return found.accessor;
    const accessor = this.doc.createAccessor().setType('SCALAR').setArray(times.slice()).setBuffer(this.buffer);
    bucket.push({ times, accessor });
    this.buckets.set(key, bucket);
    return accessor;
  }
}

export function sameArray(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Adds one glTF animation for a baked clip. Tracks without a target node are returned as skipped. */
export function addAnimation(
  doc: Document,
  buffer: Buffer,
  inputs: InputAccessors,
  clip: BakedClip,
  targetOf: (track: BakedTrack) => Node | null,
): { readonly animation: Animation; readonly channels: number; readonly keys: number; readonly skipped: BakedTrack[] } {
  const animation = doc.createAnimation(clip.name);
  const skipped: BakedTrack[] = [];
  let channels = 0;
  let keys = 0;
  for (const track of clip.tracks) {
    const node = targetOf(track);
    if (node === null) {
      skipped.push(track);
      continue;
    }
    const output = doc
      .createAccessor()
      .setType(track.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(track.values.slice())
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(inputs.get(track.times))
      .setOutput(output)
      .setInterpolation(track.interpolation);
    animation.addSampler(sampler);
    animation.addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(track.path).setSampler(sampler),
    );
    channels++;
    keys += track.times.length;
  }
  return { animation, channels, keys, skipped };
}

/** Serializes a fresh document to GLB bytes (deterministic for identical documents). */
export async function writeDocument(doc: Document): Promise<Uint8Array> {
  const io = new WebIO().registerExtensions([VRMCVrmAnimation]);
  return io.writeBinary(doc);
}
