// Strict parsing of a `GenRequest` from untrusted JSON. The gateway runs it on every quote and job; the client runs it
// before sending. Unknown keys are refused, so a typo never silently falls back to a provider default.
import {
  GEN_LIMITS,
  GEN_OPS,
  type GenAttestation,
  type GenOp,
  type GenParams,
  type GenRequest,
  type GenSource,
  type View,
} from './types.ts';

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;
const VIEWS: readonly View[] = ['front', 'back', 'left', 'right'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function onlyKeys(v: Obj, allowed: readonly string[], path: string, errors: string[]): void {
  for (const k of Object.keys(v)) if (!allowed.includes(k)) errors.push(`${path}.${k}: unknown field`);
}

function parseParams(v: unknown, errors: string[]): GenParams {
  if (!isObj(v)) {
    errors.push('params: expected an object');
    return {};
  }
  onlyKeys(
    v,
    [
      'faceLimit',
      'lowPoly',
      'quad',
      'texture',
      'textureSize',
      'restPose',
      'seed',
      'symmetric',
      'skeleton',
      'heightMeters',
    ],
    'params',
    errors,
  );
  const out: { -readonly [K in keyof GenParams]: GenParams[K] } = {};
  const int = (k: 'faceLimit' | 'seed', min: number, max: number): void => {
    const x = v[k];
    if (x === undefined) return;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
      errors.push(`params.${k}: expected an integer ${min}…${max}`);
    else out[k] = x;
  };
  const bool = (k: 'lowPoly' | 'quad' | 'symmetric'): void => {
    const x = v[k];
    if (x === undefined) return;
    if (typeof x !== 'boolean') errors.push(`params.${k}: expected a boolean`);
    else out[k] = x;
  };
  int('faceLimit', 48, 2_000_000);
  int('seed', 0, 2_147_483_647);
  bool('lowPoly');
  bool('quad');
  bool('symmetric');
  if (v['texture'] !== undefined) {
    const t = v['texture'];
    if (t === 'none' || t === 'color' || t === 'pbr') out.texture = t;
    else errors.push("params.texture: expected 'none', 'color' or 'pbr'");
  }
  if (v['textureSize'] !== undefined) {
    const t = v['textureSize'];
    if (t === 1024 || t === 2048 || t === 4096) out.textureSize = t;
    else errors.push('params.textureSize: expected 1024, 2048 or 4096');
  }
  if (v['restPose'] !== undefined) {
    const t = v['restPose'];
    if (t === 't' || t === 'a') out.restPose = t;
    else errors.push("params.restPose: expected 't' or 'a'");
  }
  if (v['skeleton'] !== undefined) {
    const t = v['skeleton'];
    if (t === 'vrm' || t === 'native') out.skeleton = t;
    else errors.push("params.skeleton: expected 'vrm' or 'native'");
  }
  if (v['heightMeters'] !== undefined) {
    const h = v['heightMeters'];
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0.05 || h > 50)
      errors.push('params.heightMeters: expected 0.05…50');
    else out.heightMeters = h;
  }
  return out;
}

function parseAttestation(v: unknown, errors: string[]): GenAttestation {
  if (!isObj(v)) {
    errors.push('attestation: expected an object');
    return { tier: 'unknown' };
  }
  onlyKeys(v, ['tier', 'realPersonPhoto'], 'attestation', errors);
  const tier = v['tier'];
  if (tier !== 'paid' && tier !== 'free' && tier !== 'unknown')
    errors.push("attestation.tier: expected 'paid', 'free' or 'unknown'");
  const rp = v['realPersonPhoto'];
  if (rp !== undefined && typeof rp !== 'boolean') errors.push('attestation.realPersonPhoto: expected a boolean');
  const t = tier === 'paid' || tier === 'free' ? tier : 'unknown';
  return rp === undefined ? { tier: t } : { tier: t, realPersonPhoto: rp === true };
}

function parseSource(v: unknown, errors: string[]): GenSource | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    errors.push('source: expected { job } or { upload }');
    return undefined;
  }
  const keys = Object.keys(v);
  if (keys.length === 1 && typeof v['job'] === 'string' && ID.test(v['job'])) return { job: v['job'] };
  if (keys.length === 1 && typeof v['upload'] === 'string' && ID.test(v['upload'])) return { upload: v['upload'] };
  errors.push('source: expected exactly one of { job: id } or { upload: id }');
  return undefined;
}

/** Op-specific input rules shared by every adapter; adapters add their own (ranges, mimes, counts). */
function checkOpInputs(req: GenRequest, errors: string[]): void {
  const images = req.images?.length ?? 0;
  const hasPrompt = req.prompt !== undefined && req.prompt.trim() !== '';
  switch (req.op) {
    case 'text-to-model':
      if (!hasPrompt) errors.push('text-to-model needs a prompt');
      if (images > 0) errors.push('text-to-model takes no images');
      if (req.source) errors.push('text-to-model takes no source');
      return;
    case 'image-to-model':
      if (images !== 1) errors.push('image-to-model needs exactly one image');
      if (req.source) errors.push('image-to-model takes no source');
      return;
    case 'multiview-to-model':
      if (images < 2) errors.push('multiview-to-model needs 2–4 images');
      if (req.source) errors.push('multiview-to-model takes no source');
      return;
    case 'retopology':
    case 'rig':
      if (!req.source) errors.push(`${req.op} needs a source ({ job } or { upload })`);
      if (images > 0) errors.push(`${req.op} takes no images`);
      return;
    default: {
      const never: never = req.op;
      errors.push(`op: unknown ${String(never)}`);
    }
  }
}

export function parseGenRequest(v: unknown): Parsed<GenRequest> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['request: expected an object'] };
  onlyKeys(
    v,
    ['provider', 'op', 'prompt', 'images', 'source', 'params', 'idempotencyKey', 'maxCostUsd', 'attestation'],
    'request',
    errors,
  );
  const provider = v['provider'];
  if (typeof provider !== 'string' || !PROVIDER_ID.test(provider)) errors.push('provider: expected a provider id');
  const op = v['op'];
  if (typeof op !== 'string' || !GEN_OPS.includes(op as GenOp)) errors.push(`op: expected one of ${GEN_OPS.join(', ')}`);
  const prompt = v['prompt'];
  if (prompt !== undefined) {
    if (typeof prompt !== 'string') errors.push('prompt: expected a string');
    else if (prompt.length > GEN_LIMITS.promptMaxChars)
      errors.push(`prompt: at most ${GEN_LIMITS.promptMaxChars} characters`);
  }
  let images: { upload: string; view?: View }[] | undefined;
  if (v['images'] !== undefined) {
    const arr = v['images'];
    if (!Array.isArray(arr) || arr.length > GEN_LIMITS.maxImages)
      errors.push(`images: expected at most ${GEN_LIMITS.maxImages} entries`);
    else {
      images = [];
      arr.forEach((im: unknown, i) => {
        if (!isObj(im) || typeof im['upload'] !== 'string' || !ID.test(im['upload'])) {
          errors.push(`images[${i}]: expected { upload: id, view? }`);
          return;
        }
        onlyKeys(im, ['upload', 'view'], `images[${i}]`, errors);
        const view = im['view'];
        if (view !== undefined && !VIEWS.includes(view as View)) errors.push(`images[${i}].view: unknown view`);
        images?.push(view === undefined ? { upload: im['upload'] } : { upload: im['upload'], view: view as View });
      });
    }
  }
  const source = parseSource(v['source'], errors);
  const params = parseParams(v['params'] ?? {}, errors);
  const key = v['idempotencyKey'];
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key))
    errors.push('idempotencyKey: expected 16–128 characters of [A-Za-z0-9_-]');
  const max = v['maxCostUsd'];
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0 || max > 1000)
    errors.push('maxCostUsd: expected a number in (0, 1000]');
  const attestation = parseAttestation(v['attestation'], errors);
  if (errors.length > 0) return { ok: false, errors };
  const req: GenRequest = {
    provider: provider as string,
    op: op as GenOp,
    ...(typeof prompt === 'string' ? { prompt } : {}),
    ...(images ? { images } : {}),
    ...(source ? { source } : {}),
    params,
    idempotencyKey: key as string,
    maxCostUsd: max as number,
    attestation,
  };
  checkOpInputs(req, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: req };
}

/** A stable JSON form of a request (sorted keys) — the gateway compares it when an idempotency key is reused. */
export function canonicalRequest(req: GenRequest): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (isObj(x))
      return Object.fromEntries(
        Object.keys(x)
          .sort()
          .map((k) => [k, sort(x[k])]),
      );
    return x;
  };
  return JSON.stringify(sort(req));
}
