// The clip metadata round-trip (CHARACTER-CONTRACT-SPEC §8.14, ADR 0010 rev. 3; C2): a clip in a file Ekza Studio
// wrote (`asset.extras.ekza_animation_v1`, provenance tool `ekza-animator`) comes back with what Studio recorded — its
// slot (when no other clip of the character holds it), contact frame, root motion, tags, display label (a package clip
// is named by its slot: the label is the clip's name) and named markers (into `ekza.clipMarkers` when the target chunk
// registered the table). Other tools' files keep the import's own defaults. Part of the lazy import path.
import type { Frame } from '@ekza-studio/anim-core';
import { type ClipRecord, getTableDef, type Tx } from '@ekza-studio/doc';
import type { GlbContainer } from '@ekza-studio/io';
import type { ClipWritePlan } from './clipWrite';
import { sanitizeClipName } from './names';
import { ekzaClipEntry } from './provenance';

const SLOT = /^[a-z][a-z0-9_-]{0,47}(\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$/;
const TAG = /^[a-z0-9_-]{1,32}$/;
const MARKER = /^[a-z][a-z0-9_]{0,31}$/;
const MARKERS_TABLE = 'ekza.clipMarkers';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A display label as a clip name: "Shockline (W) — release" → "Shockline W - release" (`[A-Za-z0-9 _.-]`). */
export function readableClipName(label: string): string {
  return sanitizeClipName(
    label
      .replace(/[()[\]]/g, '')
      .replace(/[–—]/g, '-')
      .replace(/[^A-Za-z0-9 _.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export interface RestoredClip {
  readonly slot: string | null;
  readonly contactSeconds: number | null;
  readonly rootMotion: ClipRecord['rootMotion'] | null;
  readonly tags: readonly string[];
  readonly label: string | null;
  readonly markers: Readonly<Record<string, number>>;
}

/** What Studio recorded for glTF animation `index` of a file it wrote, or null (another tool's file, no entry). */
export function embeddedClipSettings(container: GlbContainer, index?: number): RestoredClip | null {
  const extras = container.json.asset.extras;
  const meta = isRecord(extras) ? extras['ekza_animation_v1'] : undefined;
  const provenance = isRecord(meta) ? meta['provenance'] : undefined;
  if (!isRecord(provenance) || provenance['tool'] !== 'ekza-animator') return null;
  const clip = ekzaClipEntry(container, index);
  if (!isRecord(clip)) return null;
  const finite = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const markers: Record<string, number> = {};
  if (isRecord(clip['markers'])) {
    for (const [name, value] of Object.entries(clip['markers'])) {
      const at = finite(value);
      if (MARKER.test(name) && name !== 'contact' && at !== null) markers[name] = at;
    }
  }
  const slot = clip['slot'];
  const rootMotion = clip['rootMotion'];
  const label = clip['label'];
  return {
    slot: typeof slot === 'string' && SLOT.test(slot) ? slot : null,
    contactSeconds: finite(clip['contactSeconds']),
    rootMotion: rootMotion === 'hips' || rootMotion === 'in-place' ? rootMotion : null,
    tags: Array.isArray(clip['tags'])
      ? (clip['tags'] as readonly unknown[]).filter((tag): tag is string => typeof tag === 'string' && TAG.test(tag))
      : [],
    label: typeof label === 'string' && label.trim() !== '' ? label : null,
    markers,
  };
}

/** A clip plan with the recorded settings applied (frames from seconds at the clip's fps, inside its range). */
export function withRestoredSettings(
  plan: ClipWritePlan,
  restored: RestoredClip | null,
): ClipWritePlan & { readonly markers?: Readonly<Record<string, Frame>> } {
  if (restored === null) return plan;
  const { clip } = plan;
  const rate = clip.fps.num / clip.fps.den;
  const frame = (secs: number): Frame =>
    Math.min(Math.max(clip.range.start + Math.round(secs * rate), clip.range.start), clip.range.end);
  const markers: Record<string, Frame> = {};
  for (const [name, secs] of Object.entries(restored.markers)) markers[name] = frame(secs);
  return {
    ...plan,
    clip: {
      ...clip,
      ...(restored.label === null ? {} : { name: readableClipName(restored.label) }),
      slot: restored.slot ?? clip.slot,
      contact: restored.contactSeconds === null ? clip.contact : frame(restored.contactSeconds),
      rootMotion: restored.rootMotion ?? clip.rootMotion,
      tags: restored.tags.length === 0 ? clip.tags : restored.tags.slice(0, 8),
    },
    ...(Object.keys(markers).length === 0 ? {} : { markers }),
  };
}

/** After the clip is written: its named markers (when the markers table is registered). */
export function writeRestoredMarkers(
  tx: Tx,
  clip: Pick<ClipRecord, 'id' | 'character'>,
  markers: Readonly<Record<string, Frame>> | undefined,
): void {
  if (markers === undefined || getTableDef(MARKERS_TABLE) === undefined) return;
  (tx as unknown as { put(table: string, record: unknown): void }).put(MARKERS_TABLE, {
    id: `mk:${clip.id}`,
    clip: clip.id,
    character: clip.character,
    markers,
    deleted: null,
  });
}
