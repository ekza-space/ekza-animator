// The intake worker (MODELING-PLAN §7.2 G-a): runs `@ekza-studio/mesh-wasm`'s intake chain — normalize, the
// meshoptimizer reduce, quadrangulate, palette bake — off the main thread for the `mesh.*` intake operators. A lazy
// entry of its own: `../services/intakeWorker.ts` creates it with `new Worker(new URL('../workers/intake.worker.ts',
// import.meta.url), { type: 'module' })` on the first job, so neither mesh-wasm nor the meshoptimizer WASM ever enters
// a route's scripts (`MESH_WASM_MARKER` is the check-size marker of the `mesh-wasm` boundary).
//
// Protocol (`editor-core/src/intake/client.ts`): a request `{type: 'intake', id, job}` with the job's typed arrays
// transferred; the response `{id, result}` (arrays transferred back) or `{id, error: {code, message}}`.
import {
  handleIntakeRequest,
  type IntakeWorkerRequest,
  type IntakeWorkerResponse,
} from '@ekza-studio/mesh-wasm/worker';

interface WorkerScope {
  onmessage: ((event: { readonly data: IntakeWorkerRequest }) => void) | null;
  postMessage(message: IntakeWorkerResponse, transfer: ArrayBuffer[]): void;
}

// Installed only inside a worker (Node tests import `handleIntakeRequest` alone).
const scope = globalThis as unknown as Partial<WorkerScope>;
if ('WorkerGlobalScope' in globalThis && typeof scope.postMessage === 'function') {
  const worker = scope as WorkerScope;
  worker.onmessage = (event) => {
    void handleIntakeRequest(event.data).then(({ response, transfer }) => worker.postMessage(response, transfer));
  };
}
