// A library clip converted onto a character's rig (M6B-SPEC §0.4.7; C12): the shipped VRMA import path of
// `file.importAnimation` (`prepareVrmaImport`, loaded through the import chunk — the clip-library chunk never imports
// io's readers or glTF Transform itself), so preview and Use Clip read the same bytes with the same options into the
// same keys. The preview keeps the plan in memory: its curves are compiled with the app's curve engine and nothing is
// written (the plan's clip partition, opened by the import path, is closed again; it holds no records).
import type { AnimCurve } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { StarterPackClip } from '@ekza-studio/io';
import { internalsOf } from '../app/internals';
import type { PreviewChannel, PreviewClip } from '../evaluation/previewSource';
import type { EditorApp } from '../types';
import type { ClipImportPlan } from '../workflows/importAnimation';
import { loadImportPath } from '../workflows/importLoader';

/** `prepareVrmaImport` of a library clip's verified bytes onto a character (the Use Clip plan). */
export async function prepareLibraryImport(
  app: EditorApp,
  character: CharacterId,
  clip: StarterPackClip,
  bytes: Uint8Array,
): Promise<ClipImportPlan> {
  const pipelines = await loadImportPath();
  return pipelines.prepareVrmaImport(app, { fileName: clip.file, bytes, character });
}

/** The preview of a library clip on a character: the Use Clip plan's curves, compiled, never written. */
export async function previewClipOf(
  app: EditorApp,
  character: CharacterId,
  clip: StarterPackClip,
  bytes: Uint8Array,
): Promise<PreviewClip> {
  const plan = await prepareLibraryImport(app, character, clip, bytes);
  const write = plan.clips[0];
  if (write === undefined) throw new Error(`${clip.file} has no clip`);
  app.store.close(`clip:${write.clip.id}`);
  const engine = internalsOf(app).deps.curves.engine;
  const channels: PreviewChannel[] = [];
  for (const { curve, keys } of write.curves) {
    if (keys.length === 0) {
      // A key-less curve holds its static value; without one the channel keeps its default (the provider's base).
      if (curve.staticValue !== null) {
        channels.push({ control: curve.control, channel: curve.channel, curve: null, value: curve.staticValue });
      }
      continue;
    }
    const anim: AnimCurve = {
      keys: [...keys].sort((a, b) => a.t - b.t),
      weighted: curve.weighted,
      pre: curve.pre,
      post: curve.post,
    };
    channels.push({ control: curve.control, channel: curve.channel, curve: engine.compile(anim), value: 0 });
  }
  const fps = write.clip.fps.num / write.clip.fps.den;
  return {
    character,
    clip: clip.id,
    fps,
    start: write.clip.range.start,
    end: write.clip.range.end,
    loop: clip.loop,
    channels,
  };
}
