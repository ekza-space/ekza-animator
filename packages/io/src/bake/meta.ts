// Clip timing and `ekza_animation_v1` clip metadata helpers shared by the bake, the writers and the editor's export
// preflight. Kept apart from the bake so the editor's initial route does not load the bake (M2A-SPEC §5.21.2).
import type { Frame } from '@ekza-animator/anim-core';
import type { DerivedFrom } from '@ekza-animator/doc';
import type { EkzaClipMetaV1 } from '../types';

export function clipFramesToSeconds(frames: Frame, fps: { readonly num: number; readonly den: number }): number {
  return (frames * fps.den) / fps.num;
}

/** Clip metadata with a fixed key order (deterministic JSON) and lowercase-hex hashes. */
export function normalizeClipMeta(meta: EkzaClipMetaV1): EkzaClipMetaV1 {
  return {
    index: meta.index,
    name: meta.name,
    slot: meta.slot,
    loop: meta.loop,
    fps: meta.fps,
    durationSeconds: meta.durationSeconds,
    rootMotion: meta.rootMotion,
    contactSeconds: meta.contactSeconds,
    tags: [...meta.tags],
    derivedFrom: meta.derivedFrom.map(normalizeDerivedFrom),
    redistributable: meta.redistributable,
  };
}

function normalizeDerivedFrom(d: DerivedFrom): DerivedFrom {
  return {
    title: d.title,
    author: d.author,
    license: d.license,
    sourceSha256: d.sourceSha256 === null ? null : d.sourceSha256.toLowerCase(),
  };
}
