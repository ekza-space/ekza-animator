// The skin worker (M6B-SPEC §2.1, §5.9; C0 entry, C4 implements it): runs mesh-core's pure `bindSkin` off the main
// thread for `SkinService.bind`. A lazy entry of its own — `../services/skinWorker.ts` creates it with `new Worker(new
// URL('../workers/skin.worker.ts', import.meta.url), { type: 'module' })` on the first bind — whose code never enters
// the editor route: `SKIN_WORKER_MARKER` is the check-size marker of the `skin-worker` boundary (≤ 120 kB gzip).
//
// Protocol (`editor-core/src/rig/skinService.ts`): a request `{type: 'bind', id, job}` with the job's typed arrays
// transferred; the response `{id, skin, report}` (arrays transferred back) or `{id, error: {code, message}}`. One job
// at a time; the client supersedes a job by terminating the worker.
import {
  type BindReport,
  bindSkin,
  type SkinBindArgs,
  type SkinGeometry,
  type SkinSkeleton,
  type SkinWeights,
} from '@ekza-studio/mesh-core';

/** `SkinWorkerRequest` of `editor-core/src/rig/skinService.ts`, restated (workers import no editor-core, §3). */
export interface SkinWorkerRequest {
  readonly type: 'bind';
  readonly id: number;
  readonly job: {
    readonly geometry: SkinGeometry;
    readonly skeleton: SkinSkeleton;
    readonly args: SkinBindArgs & { readonly symmetrize: boolean };
    readonly previous: SkinWeights | null;
  };
}
/** `SkinWorkerResponse` of `editor-core/src/rig/skinService.ts`, restated. */
export type SkinWorkerResponse =
  | { readonly id: number; readonly skin: SkinWeights; readonly report: BindReport }
  | { readonly id: number; readonly error: { readonly code: string; readonly message: string } };

/** `check-size` marker of the skin worker (§2.1). */
export const SKIN_WORKER_MARKER = 'ekza-skin-worker' as const;

/** Answers one request (pure: the same function the main thread runs without a worker). */
export function handleSkinRequest(request: SkinWorkerRequest): {
  readonly response: SkinWorkerResponse;
  readonly transfer: ArrayBuffer[];
} {
  const id = typeof request?.id === 'number' ? request.id : -1;
  if (request?.type !== 'bind') {
    return {
      response: { id, error: { code: 'invalid-input', message: `${SKIN_WORKER_MARKER}: unknown request` } },
      transfer: [],
    };
  }
  try {
    const { geometry, skeleton, args, previous } = request.job;
    const { skin, report } = bindSkin(geometry, skeleton, args, previous);
    const transfer: ArrayBuffer[] = [];
    for (const array of [skin.joints, skin.weights, report.unreachable]) {
      if (array.buffer instanceof ArrayBuffer && !transfer.includes(array.buffer)) transfer.push(array.buffer);
    }
    return { response: { id, skin, report }, transfer };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'internal';
    return {
      response: { id, error: { code, message: error instanceof Error ? error.message : String(error) } },
      transfer: [],
    };
  }
}

interface WorkerScope {
  onmessage: ((event: { readonly data: SkinWorkerRequest }) => void) | null;
  postMessage(message: SkinWorkerResponse, transfer: ArrayBuffer[]): void;
}

// Installed only inside a worker (Node tests import `handleSkinRequest` alone).
const scope = globalThis as unknown as Partial<WorkerScope>;
if ('WorkerGlobalScope' in globalThis && typeof scope.postMessage === 'function') {
  const worker = scope as WorkerScope;
  worker.onmessage = (event) => {
    const { response, transfer } = handleSkinRequest(event.data);
    worker.postMessage(response, transfer);
  };
}
