// Meshy adapter (OpenAPI under api.meshy.ai/openapi; docs read 2026-10-24, research 15 addendum A). Default provider
// for props (Q-GEN-2): Smart Topology `meshy-t2.5` (100–30,000 triangles), remesh of an existing or uploaded mesh
// (triangles or quads, 100–300,000), and its own humanoid rig. The deprecated `lowpoly` model type (retired
// 2026-10-30) is never sent. Webhooks are unsigned: a callback is only a hint to re-fetch the task.
import type { GenCapabilities, GenOp, GenRequest, GenTerms } from '@ekza-studio/gen-core';
import { ApiError } from '../http.ts';
import {
  CREATE_TIMEOUT_MS,
  callJson,
  dataUri,
  type ErrorMapper,
  inRange,
  isObj,
  num,
  retryAfterMs,
  STATUS_TIMEOUT_MS,
  str,
} from './common.ts';
import {
  type Plan,
  type PlanInfo,
  type ProviderAdapter,
  ProviderError,
  type ProviderState,
  type ProviderStatus,
  type SubmitContext,
  type TaskContext,
} from './types.ts';

export const MESHY_MODELS = {
  smartTopology: 'meshy-t2.5',
  remesh: 'remesh-v1',
  rigging: 'rigging-v1',
} as const;

const RANGES = { t25: [100, 30_000], remesh: [100, 300_000] } as const satisfies Record<
  string,
  readonly [number, number]
>;

/** Credits (pricing doc, 2026-10-24). */
const CREDITS = {
  t25Mesh: 5, // text preview or image mesh-only
  t25ImageTextured: 15, // image-to-3D with a 2K texture
  refine: 10, // text-to-3D texture stage, 2K/4K
  remesh: 5,
  rig: 5,
} as const;

/** The API needs a paid plan; Pro credits cost $0.02 (Premium $0.0133, Ultra $0.0125): quotes use the Pro price. */
export const MESHY_USD_PER_CREDIT = 0.02;

const capabilities: GenCapabilities = {
  ops: ['text-to-model', 'image-to-model', 'retopology', 'rig'],
  maxImages: 1,
  imageMimes: ['image/png', 'image/jpeg', 'image/webp'],
  lowPoly: { native: true, tris: RANGES.t25, quads: null },
  retopology: { tris: RANGES.remesh, quads: true, fromUpload: true },
  texture: ['none', 'color', 'pbr'],
  restPose: ['t', 'a'],
  rig: { skeletons: ['native'], fromUpload: true },
  forward: '+z',
  typicalSeconds: { 'text-to-model': 70, 'image-to-model': 60, retopology: 120, rig: 40 },
};

const terms: GenTerms = {
  outputLicense: 'LicenseRef-Meshy-Paid-Output',
  termsUrl: 'https://www.meshy.ai/terms-of-use',
  checkedOn: '2026-10-24',
  ownership: 'user',
  freeTierOwnership: 'provider-cc-by',
  trainsOnInputs: true,
  retentionDays: 3,
  attribution: null,
  territoryExcluded: [],
  restrictions: ['keep-ai-marks', 'no-resale', 'no-competing-models'],
};

const mapError: ErrorMapper = (status, body) => {
  const message = isObj(body) ? (str(body['message']) ?? '') : '';
  const say = (m: string): string => (message === '' ? m : `${m} (${message})`);
  if (status === 401 || status === 403)
    return { code: 'auth', message: say('Meshy refused the API key or this address.'), retryable: false };
  if (status === 402)
    return {
      code: 'insufficient-credits',
      message: say('The Meshy account has no credits, or is on the Free plan (the API needs a paid plan).'),
      retryable: false,
    };
  if (status === 429)
    return { code: 'rate-limited', message: say('Meshy is limiting requests or queued tasks.'), retryable: true };
  if (status === 400 || status === 422)
    return { code: 'invalid-input', message: say('Meshy refused the input.'), retryable: false };
  return null;
};

/** The task collection of an op and stage (status, cancel). */
function collection(op: GenOp): string {
  switch (op) {
    case 'text-to-model':
      return '/v2/text-to-3d';
    case 'image-to-model':
      return '/v1/image-to-3d';
    case 'retopology':
      return '/v1/remesh';
    case 'rig':
      return '/v1/rigging';
    case 'multiview-to-model':
      return '/v1/multi-image-to-3d';
    default: {
      const never: never = op;
      throw new Error(`unknown op ${String(never)}`);
    }
  }
}

const POSE = { t: 't-pose', a: 'a-pose' } as const;

function plan(req: GenRequest, info: PlanInfo): Plan {
  const p = req.params;
  const texture = p.texture ?? 'color';
  switch (req.op) {
    case 'text-to-model':
    case 'image-to-model': {
      if (req.prompt !== undefined && req.prompt.length > 800)
        throw new ApiError('invalid-request', 'Meshy takes prompts of at most 800 characters.');
      if (p.quad === true)
        throw new ApiError('invalid-request', 'Smart Topology makes triangles; use retopology with quads afterwards.');
      if (p.lowPoly === false)
        throw new ApiError(
          'unsupported',
          'This Meshy adapter pins Smart Topology (low-poly); high-poly is not offered.',
        );
      if (p.skeleton !== undefined || p.heightMeters !== undefined)
        throw new ApiError('invalid-request', 'Skeleton and height apply to the rig op only.');
      if (req.op === 'image-to-model' && info.imageMimes.length !== 1)
        throw new ApiError('invalid-request', 'Meshy image-to-3D takes one image.');
      inRange('faceLimit', p.faceLimit, RANGES.t25);
      const textured = texture !== 'none';
      const params: Record<string, string | number | boolean> = {
        model_type: 'smart-topology',
        ai_model: MESHY_MODELS.smartTopology,
        moderation: true,
        ...(p.faceLimit === undefined ? {} : { target_polycount: p.faceLimit }),
        ...(p.restPose === undefined ? {} : { pose_mode: POSE[p.restPose] }),
        ...(req.op === 'image-to-model' ? { should_texture: textured } : {}),
        ...(textured ? { enable_pbr: texture === 'pbr', texture_resolution: '2k' } : {}),
      };
      if (req.op === 'text-to-model') {
        const stages = textured ? ['preview', 'refine'] : ['preview'];
        const credits = CREDITS.t25Mesh + (textured ? CREDITS.refine : 0);
        return {
          model: MESHY_MODELS.smartTopology,
          stages,
          params,
          credits,
          items: [
            { label: 'Smart Topology mesh', credits: CREDITS.t25Mesh },
            ...(textured ? [{ label: '2K texture (refine)', credits: CREDITS.refine }] : []),
          ],
          exact: true,
          typicalSeconds: textured ? 70 : 10,
          digitalSourceType: 'trainedAlgorithmicMedia',
        };
      }
      const credits = textured ? CREDITS.t25ImageTextured : CREDITS.t25Mesh;
      return {
        model: MESHY_MODELS.smartTopology,
        stages: ['create'],
        params,
        credits,
        items: [{ label: `Smart Topology mesh${textured ? ' + 2K texture' : ''}`, credits }],
        exact: true,
        typicalSeconds: textured ? 60 : 10,
        digitalSourceType: 'trainedAlgorithmicMedia',
      };
    }
    case 'retopology': {
      inRange('faceLimit', p.faceLimit, RANGES.remesh);
      return {
        model: MESHY_MODELS.remesh,
        stages: ['remesh'],
        params: {
          topology: p.quad === true ? 'quad' : 'triangle',
          ...(p.faceLimit === undefined ? {} : { target_polycount: p.faceLimit }),
        },
        credits: CREDITS.remesh,
        items: [{ label: `remesh (${p.quad === true ? 'quads' : 'triangles'})`, credits: CREDITS.remesh }],
        exact: true,
        typicalSeconds: 120,
        digitalSourceType: 'compositeWithTrainedAlgorithmicMedia',
      };
    }
    case 'rig': {
      if (p.skeleton === 'vrm')
        throw new ApiError('unsupported', "Meshy's rig does not use VRM bone names; rig with Tripo or in the editor.");
      return {
        model: MESHY_MODELS.rigging,
        stages: ['rigging'],
        params: { height_meters: p.heightMeters ?? 1.7 },
        credits: CREDITS.rig,
        items: [{ label: 'humanoid rig', credits: CREDITS.rig }],
        exact: true,
        typicalSeconds: 40,
        digitalSourceType: 'compositeWithTrainedAlgorithmicMedia',
      };
    }
    case 'multiview-to-model':
      throw new ApiError('unsupported', 'Smart Topology has no multi-image mode at Meshy.');
    default: {
      const never: never = req.op;
      throw new ApiError('unsupported', `Unknown op ${String(never)}.`);
    }
  }
}

async function create(ctx: SubmitContext, path: string, body: Record<string, unknown>): Promise<{ taskId: string }> {
  const { body: res } = await callJson(
    ctx,
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      timeoutMs: CREATE_TIMEOUT_MS,
    },
    mapError,
  );
  const taskId = isObj(res) ? str(res['result']) : null;
  if (taskId === null) throw new ProviderError('provider-failed', 'Meshy returned no task id.', { sent: 'yes' });
  return { taskId };
}

const GLB_ONLY = { target_formats: ['glb'] };

async function submit(stage: number, ctx: SubmitContext): Promise<{ taskId: string }> {
  const params = ctx.params;
  if (ctx.op === 'text-to-model' && stage === 1) {
    if (ctx.previousTaskId === null) throw new ProviderError('gateway', 'No preview task.', { sent: 'no' });
    return create(ctx, '/v2/text-to-3d', {
      mode: 'refine',
      preview_task_id: ctx.previousTaskId,
      enable_pbr: params['enable_pbr'] === true,
      texture_resolution: params['texture_resolution'] ?? '2k',
      moderation: true,
      ...GLB_ONLY,
    });
  }
  if (stage !== 0 || ctx.input === null) throw new ProviderError('gateway', 'Unexpected Meshy stage.', { sent: 'no' });
  const { request, images, source } = ctx.input;
  const modelInput = (): Record<string, string> => {
    if (source === null) throw new ProviderError('invalid-input', 'No source model.', { sent: 'no' });
    return source.taskId !== null
      ? { input_task_id: source.taskId }
      : { model_url: dataUri('application/octet-stream', source.bytes) };
  };
  switch (request.op) {
    case 'text-to-model': {
      const { enable_pbr: _p, texture_resolution: _r, ...preview } = params;
      return create(ctx, '/v2/text-to-3d', { mode: 'preview', prompt: request.prompt, ...preview, ...GLB_ONLY });
    }
    case 'image-to-model': {
      const image = images[0];
      if (image === undefined) throw new ProviderError('invalid-input', 'No image.', { sent: 'no' });
      return create(ctx, '/v1/image-to-3d', { image_url: dataUri(image.mime, image.bytes), ...params, ...GLB_ONLY });
    }
    case 'retopology':
      return create(ctx, '/v1/remesh', { ...modelInput(), ...params, ...GLB_ONLY });
    case 'rig':
      return create(ctx, '/v1/rigging', { ...modelInput(), ...params });
    case 'multiview-to-model':
      throw new ProviderError('invalid-input', 'Multiview is not supported.', { sent: 'no' });
    default: {
      const never: never = request.op;
      throw new ProviderError('invalid-input', `Unknown op ${String(never)}.`, { sent: 'no' });
    }
  }
}

const STATES: Readonly<Record<string, ProviderState>> = {
  PENDING: 'queued',
  IN_PROGRESS: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

const MODERATION = /moderat|content polic|inappropriate|nsfw|not allowed/i;

async function status(_stage: number, taskId: string, ctx: TaskContext): Promise<ProviderStatus> {
  const { body, res } = await callJson(
    ctx,
    `${collection(ctx.op)}/${encodeURIComponent(taskId)}`,
    { method: 'GET', timeoutMs: STATUS_TIMEOUT_MS },
    mapError,
  );
  const raw = isObj(body) ? str(body['status']) : null;
  const mapped = raw === null ? undefined : STATES[raw];
  if (!isObj(body) || mapped === undefined)
    throw new ProviderError('provider-failed', `Meshy returned an unknown task status (${raw ?? 'none'}).`, {
      sent: 'yes',
      retryable: true,
    });
  const err = isObj(body['task_error']) ? body['task_error'] : null;
  const errMessage = (err && str(err['message'])) ?? 'Meshy could not finish the task.';
  const blocked = mapped === 'failed' && MODERATION.test(errMessage);
  const state: ProviderState = blocked ? 'blocked' : mapped;
  const urls = isObj(body['model_urls']) ? body['model_urls'] : {};
  const result = isObj(body['result']) ? body['result'] : {};
  const glb = ctx.op === 'rig' ? str(result['rigged_character_glb_url']) : str(urls['glb']);
  const thumb = str(body['thumbnail_url']);
  return {
    state,
    progress: num(body['progress']),
    retryAfterMs: retryAfterMs(res),
    outputs:
      state === 'succeeded'
        ? [
            ...(glb
              ? [{ role: 'model' as const, url: glb, mime: 'model/gltf-binary' as const, fileName: 'model.glb' }]
              : []),
            ...(thumb
              ? [{ role: 'thumbnail' as const, url: thumb, mime: 'image/png' as const, fileName: 'thumbnail' }]
              : []),
          ]
        : [],
    credits: num(body['consumed_credits']),
    error:
      state === 'blocked'
        ? { code: 'moderation', message: errMessage, retryable: false }
        : state === 'failed'
          ? {
              code: err && str(err['type']) === 'invalid_input' ? 'invalid-input' : 'provider-failed',
              message: errMessage,
              retryable: !(err && str(err['type']) === 'invalid_input'),
            }
          : null,
  };
}

async function cancel(
  _stage: number,
  taskId: string,
  ctx: TaskContext,
): Promise<'canceled' | 'too-late' | 'unsupported'> {
  const res = await ctx.http.api(`${collection(ctx.op)}/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${ctx.key}` },
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  await res.body?.cancel().catch(() => undefined);
  if (res.ok) return 'canceled';
  return res.status === 409 ? 'too-late' : 'unsupported';
}

/** Unsigned: the task id is a hint only; dedupe on (id, status). */
async function verifyWebhook(raw: Uint8Array) {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const id = isObj(body) ? str(body['id']) : null;
  if (id === null || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const st = isObj(body) ? (str(body['status']) ?? '') : '';
  return { taskId: id, deliveryId: `${id}:${st}` };
}

export function createMeshyAdapter(opts?: { readonly usdPerCredit?: number }): ProviderAdapter {
  return {
    id: 'meshy',
    label: 'Meshy',
    version: '1.0.0',
    apiBase: 'https://api.meshy.ai/openapi',
    downloadHosts: ['.meshy.ai'],
    keyEnv: 'MESHY_API_KEY',
    baseUrlEnv: 'GEN_MESHY_BASE_URL',
    webhookSecretEnv: null,
    usdPerCredit: opts?.usdPerCredit ?? MESHY_USD_PER_CREDIT,
    capabilities,
    terms,
    models: {
      'text-to-model': MESHY_MODELS.smartTopology,
      'image-to-model': MESHY_MODELS.smartTopology,
      retopology: MESHY_MODELS.remesh,
      rig: MESHY_MODELS.rigging,
    },
    // Pro allows 10 concurrent tasks; Meshy asks to wait at least 60 minutes before giving up on a task.
    limits: { concurrency: 8, pollMs: 5_000, maxWaitMs: 65 * 60_000 },
    plan,
    submit,
    status,
    cancel,
    webhook: { signed: false, verify: verifyWebhook },
  };
}
