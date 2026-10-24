// `ConstraintRecord.params` typed (M6B-SPEC §4.3; C0 working baseline, C8a keeps it). Never throws: missing or partial
// params read as the defaults, each malformed field falls back to its default on its own, and an unknown `v` returns
// null (the compiler then disables the op with `unsupported-op`). Writers preserve unknown fields (they spread the
// stored object), so this reader never strips them.
import type { Axes, ConstraintRecord, ControlId, SpaceTarget } from '@ekza-studio/doc';
import type { ConstraintParams, ConstraintWeights, WorldUp } from '../types';

type Obj = Readonly<Record<string, unknown>>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const NONE: Axes = [false, false, false];

function axes(value: unknown): Axes {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'boolean')
    ? [value[0] as boolean, value[1] as boolean, value[2] as boolean]
    : NONE;
}

function vec3(value: unknown, fallback: readonly [number, number, number]): readonly [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    value.some((item) => item !== 0)
    ? [value[0] as number, value[1] as number, value[2] as number]
    : fallback;
}

function spaceTarget(value: unknown): SpaceTarget | null {
  if (!isObj(value)) return null;
  if (value['kind'] === 'world') return { kind: 'world' };
  if (value['kind'] === 'control' && typeof value['id'] === 'string')
    return { kind: 'control', id: value['id'] as ControlId };
  if (value['kind'] === 'bone' && isObj(value['bone'])) return value as unknown as SpaceTarget;
  return null;
}

/** The standard aim-constraint defaults (§5.18.5): aim (1, 0, 0), up (0, 1, 0), world up vector (0, 1, 0). */
const DEFAULT_WORLD_UP: WorldUp = { type: 'vector', vector: [0, 1, 0] };

function worldUp(value: unknown): WorldUp {
  if (!isObj(value)) return DEFAULT_WORLD_UP;
  switch (value['type']) {
    case 'scene':
      return { type: 'scene' };
    case 'none':
      return { type: 'none' };
    case 'vector':
      return { type: 'vector', vector: vec3(value['vector'], [0, 1, 0]) };
    case 'object': {
      const target = spaceTarget(value['target']);
      return target === null ? DEFAULT_WORLD_UP : { type: 'object', target };
    }
    case 'objectRotation': {
      const target = spaceTarget(value['target']);
      return target === null
        ? DEFAULT_WORLD_UP
        : { type: 'objectRotation', target, vector: vec3(value['vector'], [0, 1, 0]) };
    }
    default:
      return DEFAULT_WORLD_UP;
  }
}

function weights(value: unknown): ConstraintWeights {
  if (!isObj(value)) return { mode: 'static' };
  if (value['mode'] === 'attrs') return { mode: 'attrs' };
  if (value['mode'] === 'select') {
    const order = value['order'];
    if (Array.isArray(order) && order.every((item) => typeof item === 'string')) {
      return { mode: 'select', order };
    }
  }
  return { mode: 'static' };
}

/** Never throws: missing or partial params read as {v:1, key: type, holder: null, weights: static, blend: false, skip:
 *  none, interp: 'average', aim: the standard aim defaults, else null}; an unknown `v` returns null (the op is disabled
 *  with `unsupported-op`). Unknown fields are preserved by writers. C0 working baseline. */
export function parseConstraintParams(record: ConstraintRecord): ConstraintParams | null {
  const raw: Obj = isObj(record.params) ? record.params : {};
  if (raw['v'] !== undefined && raw['v'] !== 1) return null;
  const key = typeof raw['key'] === 'string' && KEY.test(raw['key']) ? raw['key'] : record.type;
  const skip = isObj(raw['skip']) ? raw['skip'] : {};
  const aim = isObj(raw['aim']) ? raw['aim'] : {};
  return {
    v: 1,
    key,
    holder: typeof raw['holder'] === 'string' && raw['holder'].length > 0 ? (raw['holder'] as ControlId) : null,
    weights: weights(raw['weights']),
    blend: raw['blend'] === true,
    skip: { t: axes(skip['t']), r: axes(skip['r']) },
    interp: raw['interp'] === 'shortest' ? 'shortest' : 'average',
    aim:
      record.type === 'aim'
        ? {
            aimAxis: vec3(aim['aimAxis'], [1, 0, 0]),
            upAxis: vec3(aim['upAxis'], [0, 1, 0]),
            worldUp: worldUp(aim['worldUp']),
          }
        : null,
  };
}
