// Record factories with the documented defaults (MVP-SPEC §4.2, §4.9 `clip.new`, §4.11.1 key defaults, Q-TIME-1,
// Q-ANIM-1, Q-VP-2). Every factory validates its result and throws `EkzaError('invalid-record')` for invalid input.
import { type AnimCurve, EkzaError } from '@ekza-animator/anim-core';
import { newId } from '../ids/generate';
import type {
  BuiltinTableName,
  CameraRecord,
  ClipRecord,
  CurveRecord,
  CurveWithKeys,
  KeyRecord,
  LayerRecord,
  ProjectRecord,
} from '../records';
import { SCHEMA_VERSION } from '../snapshot/version';
import { compareStrings } from '../store/diff';
import { validateBuiltin } from './validate';

/** Scene clock and new-clip default (Q-TIME-1). */
export const DEFAULT_FPS = { num: 30, den: 1 } as const;
/** Default scene range and new-clip range, in frames (§4.9 `clip.new`). */
export const DEFAULT_RANGE = { start: 0, end: 60 } as const;
/** Vertical field of view of a 50 mm lens on a 24 mm-high full-frame sensor: 2·atan(12/50) (Q-VP-2). */
export const DEFAULT_SHOT_FOV_Y = 2 * Math.atan(12 / 50);
/** First fractional index (`fractionalIndex(null, null)`). */
export const FIRST_ORDER = 'a0';

function checked<T>(table: BuiltinTableName, record: T): T {
  const problems = validateBuiltin(table, record);
  if (problems.length > 0) {
    throw new EkzaError('invalid-record', `Invalid ${table} record: ${problems.join('; ')}`, { table, problems });
  }
  return record;
}

/** Removes top-level fields whose value is `undefined` (explicitly passed optional fields). */
function defined<T extends object>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record)) if (value !== undefined) out[name] = value;
  return out as T;
}

export function makeProject(fields?: Partial<ProjectRecord>): ProjectRecord {
  return checked(
    'project',
    defined<ProjectRecord>({
      id: 'project',
      name: 'Untitled',
      schemaVersion: SCHEMA_VERSION,
      minWriterVersion: SCHEMA_VERSION,
      sceneFps: DEFAULT_FPS,
      sceneRange: DEFAULT_RANGE,
      units: 'm',
      upAxis: 'Y',
      ...fields,
    }),
  );
}

/** The base layer of a clip by default ('Base', override, weight 1). */
export function makeLayer(fields: Pick<LayerRecord, 'clip'> & Partial<LayerRecord>): LayerRecord {
  return checked(
    'layers',
    defined<LayerRecord>({
      id: newId('layer'),
      name: 'Base',
      mode: 'override',
      weight: 1,
      mute: false,
      solo: false,
      owner: null,
      order: FIRST_ORDER,
      deleted: null,
      ...fields,
    }),
  );
}

/** Defaults of `clip.new`: range 0–60, sceneStart 0, no loop, root motion `hips`, authored from scratch. */
export function makeClip(fields: Pick<ClipRecord, 'character' | 'name' | 'fps'> & Partial<ClipRecord>): ClipRecord {
  return checked(
    'clips',
    defined<ClipRecord>({
      id: newId('clip'),
      slot: null,
      range: DEFAULT_RANGE,
      sceneStart: 0,
      loop: false,
      rootMotion: 'hips',
      contact: null,
      tags: [],
      provenance: { derivedFrom: [], redistributable: 'yes' },
      source: { kind: 'new' },
      order: FIRST_ORDER,
      deleted: null,
      ...fields,
    }),
  );
}

/** Defaults of `ensureCurve` (§4.11.0): not weighted, constant infinities, no static value. */
export function makeCurve(
  fields: Pick<CurveRecord, 'clip' | 'layer' | 'control' | 'channel'> & Partial<CurveRecord>,
): CurveRecord {
  return checked(
    'curves',
    defined<CurveRecord>({
      id: newId('curve'),
      weighted: false,
      pre: 'constant',
      post: 'constant',
      staticValue: null,
      locked: false,
      muted: false,
      deleted: null,
      ...fields,
    }),
  );
}

/** Defaults of `key.set` (§4.11.1): auto tangents, zero handles, unified, weights locked. */
export function makeKey(fields: Pick<KeyRecord, 'clip' | 'curve' | 't' | 'v'> & Partial<KeyRecord>): KeyRecord {
  return checked(
    'keys',
    defined<KeyRecord>({
      id: newId('key'),
      inType: 'auto',
      outType: 'auto',
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
      ...fields,
    }),
  );
}

/** A perspective shot camera with a 50 mm lens by default; unlocked unless `locked` is given. */
export function makeCamera(fields: Pick<CameraRecord, 'name' | 'transform'> & Partial<CameraRecord>): CameraRecord {
  return checked(
    'cameras',
    defined<CameraRecord>({
      id: newId('camera'),
      projection: 'perspective',
      fovY: DEFAULT_SHOT_FOV_Y,
      orthoHeight: 2,
      near: 0.01,
      far: 1000,
      target: [0, 0, 0],
      aspect: null,
      locked: false,
      order: FIRST_ORDER,
      deleted: null,
      ...fields,
    }),
  );
}

/**
 * A curve record and its keys as an `AnimCurve` (a `CurveWithKeys`). Keys must belong to one channel; they are sorted
 * by time and duplicate times are resolved like the store's projection (the greatest KeyId wins). Already projected
 * input (e.g. `query.keysOfCurve`) is used as is.
 */
export function toAnimCurve(curve: CurveRecord, keys: readonly KeyRecord[]): AnimCurve {
  const result: CurveWithKeys = {
    curve,
    keys: projectKeys(keys),
    weighted: curve.weighted,
    pre: curve.pre,
    post: curve.post,
  };
  return result;
}

function projectKeys(keys: readonly KeyRecord[]): readonly KeyRecord[] {
  let sorted = true;
  for (let i = 1; i < keys.length && sorted; i++) sorted = (keys[i - 1] as KeyRecord).t < (keys[i] as KeyRecord).t;
  if (sorted) return keys;
  const ordered = [...keys].sort((a, b) => a.t - b.t || compareStrings(b.id, a.id));
  const out: KeyRecord[] = [];
  for (const key of ordered) if (out.at(-1)?.t !== key.t) out.push(key);
  return out;
}
