// Tripo adapter (international API v3; docs read 2026-10-24, research 15 addendum A). Default provider for
// characters (Q-GEN-2): native low-poly P1, a VRM-named rig (rig model v3.0, `spec: "vrm"`), retopology of an existing
// or uploaded mesh, HMAC-signed webhooks, and no training on paid users' data.
import type { GenCapabilities, GenRequest, GenTerms } from '@ekza-studio/gen-core';
import { ApiError } from '../http.ts';
import {
  CREATE_TIMEOUT_MS,
  callJson,
  type ErrorMapper,
  hmacSha256Verify,
  inRange,
  isObj,
  num,
  STATUS_TIMEOUT_MS,
  str,
  UPLOAD_TIMEOUT_MS,
} from './common.ts';
import {
  type AdapterContext,
  type Params,
  type Plan,
  type PlanInfo,
  ProviderError,
  type ProviderAdapter,
  type ProviderState,
  type ProviderStatus,
  type SubmitContext,
  type TaskContext,
} from './types.ts';

/** Pinned model versions (D10): never `latest`, never an implicit default. */
export const TRIPO_MODELS = {
  p1: 'P1-20260311', // native low-poly, 50–20,000 faces
  p2: 'P2-20260801', // preview: native quads 48–25,000 (triangles 48–50,000)
  h31: 'v3.1-20260211', // high-detail H3.1
  rig: 'v3.0-20260909', // rig v3.0: spec 'vrm' names bones by VRM 1.0 humanoid convention
  retopology: 'v3.0', // /mesh/decimate v3.0: triangles 500–20,000, quads 500–10,000
} as const;

const RANGES = {
  p1: [50, 20_000],
  p2Tris: [48, 50_000],
  p2Quads: [48, 25_000],
  h31: [500, 1_500_000],
  retopoTris: [500, 20_000],
  retopoQuads: [500, 10_000],
} as const satisfies Record<string, readonly [number, number]>;

/** Credits per request (pricing page, 2026-10-24; 1 credit = $0.01). [no texture, standard texture]. */
const CREDITS = {
  p1Text: [30, 40],
  p1Image: [40, 50],
  p2: [100, 110],
  h31Text: [10, 20],
  h31Image: [20, 30],
  rig: 25,
  retopoTris: 35,
  retopoQuads: 40,
} as const;

const capabilities: GenCapabilities = {
  ops: ['text-to-model', 'image-to-model', 'retopology', 'rig'],
  maxImages: 1,
  imageMimes: ['image/png', 'image/jpeg'],
  lowPoly: { native: true, tris: RANGES.p1, quads: RANGES.p2Quads },
  retopology: { tris: RANGES.retopoTris, quads: true, fromUpload: true },
  texture: ['none', 'color', 'pbr'],
  restPose: [],
  rig: { skeletons: ['vrm', 'native'], fromUpload: true },
  forward: '+x',
  typicalSeconds: { 'text-to-model': 60, 'image-to-model': 60, retopology: 60, rig: 30 },
};

const terms: GenTerms = {
  outputLicense: 'LicenseRef-Tripo-Paid-Output',
  termsUrl: 'https://developers.tripo3d.ai/en/terms',
  checkedOn: '2026-10-24',
  ownership: 'user',
  freeTierOwnership: 'provider',
  trainsOnInputs: false,
  retentionDays: null,
  attribution: null,
  territoryExcluded: [],
  restrictions: ['no-key-transfer', 'no-competing-models'],
};

/** Tripo's error envelope `{code, message}` (docs: error-handling, rate-limits). */
const mapError: ErrorMapper = (status, body) => {
  const code = isObj(body) ? num(body['code']) : null;
  const message = isObj(body) ? (str(body['message']) ?? '') : '';
  const say = (m: string): string => (message === '' ? m : `${m} (${message})`);
  switch (code) {
    case 2:
    case 1000:
    case 1001:
      return { code: 'auth', message: say('Tripo refused the API key.'), retryable: false };
    case 2010:
      return { code: 'insufficient-credits', message: say('The Tripo account has not enough credits.'), retryable: false };
    case 1007:
    case 2000:
      return { code: 'rate-limited', message: say('Tripo is limiting requests.'), retryable: true };
    case 2008:
      return { code: 'moderation', message: say('Tripo blocked the request under its content policy.'), retryable: false };
    case 2015:
      return {
        code: 'invalid-input',
        message: say('Tripo retired the pinned model version; the adapter needs an update.'),
        retryable: false,
      };
    case 1004:
    case 2002:
    case 2003:
    case 2004:
    case 2018:
      return { code: 'invalid-input', message: say('Tripo refused the input.'), retryable: false };
    default:
      return status === 429 ? { code: 'rate-limited', message: say('Tripo is limiting requests.'), retryable: true } : null;
  }
};

function textureFlags(req: GenRequest): { texture: boolean; pbr: boolean } {
  const t = req.params.texture ?? 'color';
  return { texture: t !== 'none', pbr: t === 'pbr' };
}

function plan(req: GenRequest, info: PlanInfo): Plan {
  const p = req.params;
  switch (req.op) {
    case 'text-to-model':
    case 'image-to-model': {
      if (req.prompt !== undefined && req.prompt.length > 1024)
        throw new ApiError('invalid-request', 'Tripo takes prompts of at most 1,024 characters.');
      if (req.op === 'image-to-model' && info.imageMimes.some((m) => m !== 'image/png' && m !== 'image/jpeg'))
        throw new ApiError('invalid-request', 'Tripo takes PNG or JPEG images.');
      if (p.skeleton !== undefined || p.heightMeters !== undefined || p.restPose !== undefined)
        throw new ApiError('invalid-request', 'Rest pose, skeleton and height do not apply to Tripo generation.');
      const { texture, pbr } = textureFlags(req);
      const tex = texture ? 1 : 0;
      const image = req.op === 'image-to-model';
      let model: string;
      let credits: number;
      if (p.quad === true) {
        inRange('faceLimit', p.faceLimit, RANGES.p2Quads);
        model = TRIPO_MODELS.p2;
        credits = CREDITS.p2[tex];
      } else if (p.lowPoly === false) {
        inRange('faceLimit', p.faceLimit, RANGES.h31);
        model = TRIPO_MODELS.h31;
        credits = (image ? CREDITS.h31Image : CREDITS.h31Text)[tex];
      } else {
        inRange('faceLimit', p.faceLimit, RANGES.p1);
        model = TRIPO_MODELS.p1;
        credits = (image ? CREDITS.p1Image : CREDITS.p1Text)[tex];
      }
      const params: Record<string, string | number | boolean> = {
        model,
        texture,
        pbr,
        ...(texture ? { texture_quality: 'standard' } : {}),
        ...(p.faceLimit === undefined ? {} : { face_limit: p.faceLimit }),
        ...(p.quad === true ? { quad: true } : {}),
        ...(p.seed === undefined ? {} : { model_seed: p.seed }),
      };
      return {
        model,
        stages: ['create'],
        params,
        credits,
        items: [{ label: `${model}${texture ? ' + texture' : ''}`, credits }],
        exact: !pbr,
        typicalSeconds: 60,
        digitalSourceType: 'trainedAlgorithmicMedia',
      };
    }
    case 'retopology': {
      const quad = p.quad === true;
      inRange('faceLimit', p.faceLimit, quad ? RANGES.retopoQuads : RANGES.retopoTris);
      const credits = quad ? CREDITS.retopoQuads : CREDITS.retopoTris;
      return {
        model: TRIPO_MODELS.retopology,
        stages: ['decimate'],
        params: {
          model: TRIPO_MODELS.retopology,
          quad,
          bake: true,
          ...(p.faceLimit === undefined ? {} : { face_limit: p.faceLimit }),
        },
        credits,
        items: [{ label: `retopology ${quad ? 'quads' : 'triangles'}`, credits }],
        exact: true,
        typicalSeconds: 60,
        digitalSourceType: 'compositeWithTrainedAlgorithmicMedia',
      };
    }
    case 'rig': {
      const spec = p.skeleton === 'native' ? 'tripo' : 'vrm';
      return {
        model: TRIPO_MODELS.rig,
        stages: ['rig'],
        params: { model: TRIPO_MODELS.rig, rig_type: 'biped', spec, out_format: 'glb' },
        credits: CREDITS.rig,
        items: [{ label: `rig (${spec} skeleton)`, credits: CREDITS.rig }],
        exact: true,
        typicalSeconds: 30,
        digitalSourceType: 'compositeWithTrainedAlgorithmicMedia',
      };
    }
    case 'multiview-to-model':
      throw new ApiError('unsupported', 'This Tripo adapter does not do multiview yet.');
    default: {
      const never: never = req.op;
      throw new ApiError('unsupported', `Unknown op ${String(never)}.`);
    }
  }
}

/** Uploads bytes (multipart `POST /files`) and returns the file token. Free, so a failure is safe to retry. */
async function uploadFile(ctx: AdapterContext, bytes: Uint8Array, mime: string, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), name);
  try {
    const { body } = await callJson(ctx, '/files', { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS }, mapError);
    const token = isObj(body) && isObj(body['data']) ? str(body['data']['file_token']) : null;
    if (token === null) throw new ProviderError('provider-failed', 'Tripo returned no file token.', { sent: 'no', retryable: true });
    return token;
  } catch (err) {
    if (err instanceof ProviderError && err.sent !== 'no')
      throw new ProviderError(err.code, err.message, { status: err.status, retryable: true, sent: 'no' });
    throw err;
  }
}

async function create(ctx: SubmitContext, path: string, body: Record<string, unknown>): Promise<{ taskId: string }> {
  const { body: res } = await callJson(
    ctx,
    path,
    { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, timeoutMs: CREATE_TIMEOUT_MS },
    mapError,
  );
  const taskId = isObj(res) && isObj(res['data']) ? str(res['data']['task_id']) : null;
  if (taskId === null) throw new ProviderError('provider-failed', 'Tripo returned no task id.', { sent: 'yes' });
  return { taskId };
}

async function submit(stage: number, ctx: SubmitContext): Promise<{ taskId: string }> {
  if (stage !== 0 || ctx.input === null) throw new ProviderError('gateway', 'Tripo jobs have one stage.', { sent: 'no' });
  const { request, images, source } = ctx.input;
  const params: Params = ctx.params;
  const sourceInput = async (): Promise<string> => {
    if (source === null) throw new ProviderError('invalid-input', 'No source model.', { sent: 'no' });
    return source.taskId ?? uploadFile(ctx, source.bytes, 'model/gltf-binary', 'source.glb');
  };
  switch (request.op) {
    case 'text-to-model':
      return create(ctx, '/generation/text-to-model', { prompt: request.prompt, ...params });
    case 'image-to-model': {
      const image = images[0];
      if (image === undefined) throw new ProviderError('invalid-input', 'No image.', { sent: 'no' });
      const token = await uploadFile(ctx, image.bytes, image.mime, image.mime === 'image/png' ? 'input.png' : 'input.jpg');
      return create(ctx, '/generation/image-to-model', { input: token, ...params });
    }
    case 'retopology':
      return create(ctx, '/mesh/decimate', { input: await sourceInput(), ...params });
    case 'rig':
      return create(ctx, '/animations/rig', { input: await sourceInput(), ...params });
    case 'multiview-to-model':
      throw new ProviderError('invalid-input', 'Multiview is not supported.', { sent: 'no' });
    default: {
      const never: never = request.op;
      throw new ProviderError('invalid-input', `Unknown op ${String(never)}.`, { sent: 'no' });
    }
  }
}

const STATES: Readonly<Record<string, ProviderState>> = {
  queued: 'queued',
  running: 'running',
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  banned: 'blocked',
  expired: 'expired',
};

async function status(_stage: number, taskId: string, ctx: TaskContext): Promise<ProviderStatus> {
  const { body } = await callJson(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}`,
    { method: 'GET', timeoutMs: STATUS_TIMEOUT_MS },
    mapError,
  );
  const data = isObj(body) && isObj(body['data']) ? body['data'] : null;
  const raw = data === null ? null : str(data['status']);
  const state = raw === null ? undefined : STATES[raw];
  if (data === null || state === undefined)
    throw new ProviderError('provider-failed', `Tripo returned an unknown task status (${raw ?? 'none'}).`, { sent: 'yes', retryable: true });
  const output = isObj(data['output']) ? data['output'] : {};
  const model = str(output['model_url']);
  const render = str(output['rendered_image_url']);
  const errorCode = num(data['error_code']);
  const errorMessage = str(data['error_message']) ?? 'Tripo could not finish the task.';
  return {
    state: state === 'failed' && errorCode === 2008 ? 'blocked' : state,
    progress: num(data['progress']),
    retryAfterMs: null,
    outputs:
      state === 'succeeded'
        ? [
            ...(model ? [{ role: 'model' as const, url: model, mime: 'model/gltf-binary' as const, fileName: 'model.glb' }] : []),
            ...(render ? [{ role: 'thumbnail' as const, url: render, mime: 'image/webp' as const, fileName: 'render' }] : []),
          ]
        : [],
    credits: num(data['credits_consumed']),
    error:
      state === 'failed' || state === 'blocked'
        ? errorCode === 2008
          ? { code: 'moderation', message: errorMessage, retryable: false }
          : { code: 'provider-failed', message: errorMessage, retryable: true }
        : state === 'expired'
          ? { code: 'expired', message: 'Tripo no longer has the results of this task.', retryable: false }
          : null,
  };
}

/** `Tripo-Webhook-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `t + "." + rawBody`, 5-minute window. */
export const TRIPO_WEBHOOK_WINDOW_S = 300;

async function verifyWebhook(raw: Uint8Array, headers: Headers, secret: string | null, nowMs: number) {
  if (secret === null) return null;
  const sig = headers.get('tripo-webhook-signature') ?? '';
  const parts = new Map(
    sig.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isInteger(t) || Math.abs(nowMs / 1000 - t) > TRIPO_WEBHOOK_WINDOW_S) return null;
  const message = new Uint8Array([...new TextEncoder().encode(`${t}.`), ...raw]);
  if (!(await hmacSha256Verify(secret, message, v1))) return null;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const taskId = isObj(body) && isObj(body['data']) ? str(body['data']['task_id']) : null;
  if (taskId === null) return null;
  return { taskId, deliveryId: headers.get('tripo-webhook-delivery') };
}

export function createTripoAdapter(): ProviderAdapter {
  return {
    id: 'tripo',
    label: 'Tripo',
    version: '1.0.0',
    apiBase: 'https://openapi.tripo3d.ai/v3',
    downloadHosts: ['.tripo3d.ai', '.tripo3d.com'],
    keyEnv: 'TRIPO_API_KEY',
    baseUrlEnv: 'GEN_TRIPO_BASE_URL',
    webhookSecretEnv: 'TRIPO_WEBHOOK_SECRET',
    usdPerCredit: 0.01,
    capabilities,
    terms,
    models: {
      'text-to-model': TRIPO_MODELS.p1,
      'image-to-model': TRIPO_MODELS.p1,
      retopology: TRIPO_MODELS.retopology,
      rig: TRIPO_MODELS.rig,
    },
    // P-series concurrency is 5 per account (rate-limits doc); stay below it. Tripo suggests polling every 1–2 s.
    limits: { concurrency: 4, pollMs: 3_000, maxWaitMs: 30 * 60_000 },
    plan,
    submit,
    status,
    webhook: { signed: true, verify: verifyWebhook },
  };
}
