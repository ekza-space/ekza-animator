// Exported clip and file names (MVP-SPEC §4.11.10 step 6, ADR 0010 §5).
import type { ClipRecord } from '@ekza-studio/doc';
import { normalizeClipMeta } from '../bake/meta';
import type { BakedClip, EkzaAnimationV1, EkzaClipMetaV1 } from '../types';

/** Clip names match after trim(), case-insensitively (renderer merge rule, §4.11.11 rule 6). */
export function clipNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Exported glTF animation name: the Ekza slot when set, else the sanitized clip name. */
export function clipExportName(clip: Pick<ClipRecord, 'name' | 'slot'>): string {
  if (clip.slot !== null && clip.slot.trim() !== '') return clip.slot.trim();
  const name = clip.name
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return name === '' ? 'clip' : name;
}

/** Fills `{character}`, `{clip}` and `{fps}`, sanitizes to `[A-Za-z0-9._-]` and appends the extension. */
export function exportFileName(
  pattern: string,
  tokens: { readonly character: string; readonly clip: string; readonly fps: number },
  ext: string,
): string {
  const fps = Number.isInteger(tokens.fps) ? String(tokens.fps) : String(Number(tokens.fps.toFixed(3)));
  const filled = pattern.replace(/\{(character|clip|fps)\}/g, (_, token: 'character' | 'clip' | 'fps') =>
    token === 'fps' ? fps : tokens[token],
  );
  const base =
    filled
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '') || 'export';
  const extension = ext.replace(/^\.+/, '').replace(/[^A-Za-z0-9]+/g, '') || 'glb';
  return `${base}.${extension}`;
}

/**
 * `ekza_animation_v1` of an output file: the given metadata's clips re-indexed to the animation index each clip got,
 * plus `kept` entries for animations that stay in the file, and the provenance union recomputed.
 */
export function outputMeta(
  meta: EkzaAnimationV1,
  written: readonly { readonly clip: BakedClip; readonly index: number }[],
  kept: readonly EkzaClipMetaV1[] = [],
): EkzaAnimationV1 {
  const byName = new Map(meta.clips.map((clip) => [clipNameKey(clip.name), clip]));
  const clips = [
    ...kept.map((clip) => normalizeClipMeta(clip)),
    ...written.map(({ clip, index }) =>
      normalizeClipMeta({ ...(byName.get(clipNameKey(clip.name)) ?? clip.meta), name: clip.name, index }),
    ),
  ].sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  // The provenance union covers exactly the clips this file holds (a VRMA holds one of the exported clips).
  const derivedFrom = clips
    .flatMap((clip) => clip.derivedFrom)
    .filter((d) => {
      const key = JSON.stringify(d);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    schema: 1,
    rig: meta.rig,
    clips,
    provenance: {
      tool: 'ekza-animator',
      toolVersion: meta.provenance.toolVersion,
      projectSha256: meta.provenance.projectSha256,
      baseSha256: meta.provenance.baseSha256,
      derivedFrom,
    },
  };
}
