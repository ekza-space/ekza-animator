// Named clip markers (GAME-PROTOCOL-SPEC §4.5 `markers`; CHARACTER-CONTRACT-SPEC §8.8; C2): the times a game uses in a
// clip besides the impact — `release` (a thrown object leaves the hand), `fire` (a shot leaves the muzzle),
// `footstep_l`, `footstep_r`, `land`, or a profile's own. The contact stays `ClipRecord.contact` (the field every
// writer already exports as `contactSeconds`); the others live in the extension table `ekza.clipMarkers`, one record
// per clip (`mk:<clipId>`, partition `char:<character>`), so `SCHEMA_VERSION` 4 stays and older builds keep the rows
// untouched (CC-17's pattern). Registered with the target chunk. Times are clip frames, like `contact`.
import type { Frame } from '@ekza-studio/anim-core';
import {
  type CharacterId,
  type ClipId,
  type ClipRecord,
  getTableDef,
  type Partition,
  type ReadView,
  registerTable,
  type TableDef,
  type Tombstone,
  type Tx,
} from '@ekza-studio/doc';

export const MARKERS_TABLE = 'ekza.clipMarkers';
/** The marker kept on the clip record itself. */
export const CONTACT_MARKER = 'contact';
const MARKER = /^[a-z][a-z0-9_]{0,31}$/;

export interface ClipMarkersRecord {
  readonly id: string;
  readonly clip: ClipId;
  readonly character: CharacterId;
  /** Marker name → clip frame. */
  readonly markers: Readonly<Record<string, Frame>>;
  readonly deleted: Tombstone;
}

export const markersIdOf = (clip: ClipId): string => `mk:${clip}`;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Problems of a markers record ([] = valid). */
export function validateMarkers(value: unknown): readonly string[] {
  if (!isObject(value)) return ['expected a record object'];
  const problems: string[] = [];
  for (const key of ['id', 'clip', 'character']) {
    if (typeof value[key] !== 'string' || value[key] === '') problems.push(`${key}: expected text`);
  }
  const markers = value['markers'];
  if (
    !isObject(markers) ||
    Object.entries(markers).some(
      ([name, frame]) => !MARKER.test(name) || name === CONTACT_MARKER || typeof frame !== 'number',
    )
  ) {
    problems.push('markers: expected { name: frame } (not the contact)');
  }
  if (value['deleted'] !== null && !isObject(value['deleted'])) problems.push('deleted: expected null or a tombstone');
  return problems;
}

export const MARKERS_TABLE_DEF: TableDef = {
  name: MARKERS_TABLE,
  version: 1,
  mergeUnit: 'field',
  softDelete: true,
  partition: (record): Partition => {
    const character = (record as Partial<ClipMarkersRecord>).character;
    return typeof character === 'string' && character.length > 0 ? `char:${character}` : 'scene';
  },
  validate: validateMarkers,
  migrations: [],
};

/** Registers `ekza.clipMarkers` once. */
export function ensureMarkersTable(): void {
  if (getTableDef(MARKERS_TABLE) === undefined) registerTable(MARKERS_TABLE_DEF);
}

interface AnyView {
  get(table: string, id: string): unknown;
}
interface AnyTx extends AnyView {
  getIncludingDeleted(table: string, id: string): unknown;
  restore(table: string, id: string): void;
  put(table: string, record: unknown): void;
  patch(table: string, id: string, fields: unknown): void;
}

/** Every marker of a clip in clip frames: the contact (when set) and the named ones. */
export function clipMarkers(view: ReadView, clip: Pick<ClipRecord, 'id' | 'contact'>): Readonly<Record<string, Frame>> {
  const record = (view as unknown as AnyView).get(MARKERS_TABLE, markersIdOf(clip.id)) as ClipMarkersRecord | undefined;
  const named = record === undefined || record.deleted !== null ? {} : record.markers;
  return clip.contact === null ? { ...named } : { ...named, [CONTACT_MARKER]: clip.contact };
}

/** The named markers of a clip (not the contact), or {}. */
export function namedMarkers(view: ReadView, clip: ClipId): Readonly<Record<string, Frame>> {
  const record = (view as unknown as AnyView).get(MARKERS_TABLE, markersIdOf(clip)) as ClipMarkersRecord | undefined;
  return record === undefined || record.deleted !== null ? {} : record.markers;
}

/** Sets (or, with null, removes) a marker of a clip; the contact goes to the clip record, clamped into its range. */
export function setClipMarker(tx: Tx, clip: ClipRecord, name: string, frame: Frame | null): void {
  const clamped = frame === null ? null : Math.min(Math.max(frame, clip.range.start), clip.range.end);
  if (name === CONTACT_MARKER) {
    if (clamped !== clip.contact) tx.patch('clips', clip.id, { contact: clamped });
    return;
  }
  const any = tx as unknown as AnyTx;
  const id = markersIdOf(clip.id);
  const existing = any.getIncludingDeleted(MARKERS_TABLE, id) as ClipMarkersRecord | undefined;
  const markers: Record<string, Frame> = { ...(existing?.deleted === null ? existing.markers : {}) };
  if (clamped === null) delete markers[name];
  else markers[name] = clamped;
  if (existing === undefined) {
    any.put(MARKERS_TABLE, { id, clip: clip.id, character: clip.character, markers, deleted: null });
    return;
  }
  if (existing.deleted !== null) any.restore(MARKERS_TABLE, id);
  any.patch(MARKERS_TABLE, id, { markers });
}

/** Scales every named marker of a clip about `pivot` (Fit timing), rounded to frames and kept in `range`. */
export function scaleClipMarkers(
  tx: Tx,
  clip: ClipRecord,
  pivot: Frame,
  factor: number,
  range: { readonly start: Frame; readonly end: Frame },
): void {
  const named = namedMarkers(tx, clip.id);
  if (Object.keys(named).length === 0) return;
  const markers: Record<string, Frame> = {};
  for (const [name, frame] of Object.entries(named)) {
    markers[name] = Math.min(Math.max(Math.round(pivot + (frame - pivot) * factor), range.start), range.end);
  }
  (tx as unknown as AnyTx).patch(MARKERS_TABLE, markersIdOf(clip.id), { markers });
}
