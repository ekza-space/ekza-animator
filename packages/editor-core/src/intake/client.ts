// The intake worker client (MODELING-PLAN §7.2 G-a; the skin worker's pattern, M6B-SPEC §5.9): a job runs in the host's
// intake worker (`editor/src/workers/intake.worker.ts`, installed on `app.meshes` by `editor/src/services/
// intakeWorker.ts`) when there is one, else on this thread through the lazy mesh-wasm chunk — the same function
// either way, so both give the same bytes. One job at a time per app: a later job supersedes an earlier one
// (EkzaError('cancelled')) and restarts the worker. A worker that fails to load makes every later job run inline.
import { EkzaError } from '@ekza-studio/anim-core';
import type { IntakeJob, IntakeResult, IntakeWorkerRequest, IntakeWorkerResponse } from '@ekza-studio/mesh-wasm';
import type { EditorApp } from '../types';
import { loadMeshWasm } from './load';

/** The part of a DOM `Worker` the client uses (editor-core has no DOM types). */
export interface IntakeWorkerPort {
  postMessage(message: IntakeWorkerRequest, transfer: ArrayBuffer[]): void;
  onmessage: ((event: { readonly data: IntakeWorkerResponse }) => void) | null;
  onerror: ((event: { readonly message?: string; preventDefault?(): void }) => void) | null;
  terminate(): void;
}

/** Set by the host on `app.meshes` (`editor/src/services/intakeWorker.ts`): creates the intake worker on first use. */
export interface IntakeWorkerHost {
  intakeWorker?: (() => IntakeWorkerPort) | null;
}

export interface IntakeRun {
  readonly result: IntakeResult;
  /** True when the job ran in the worker. */
  readonly worker: boolean;
}

interface Client {
  worker: IntakeWorkerPort | null;
  failed: boolean;
  nextId: number;
  pending: {
    readonly id: number;
    readonly job: IntakeJob;
    readonly resolve: (run: IntakeRun) => void;
    readonly reject: (error: unknown) => void;
  } | null;
}

const clients = new WeakMap<EditorApp, Client>();

function clientOf(app: EditorApp): Client {
  let client = clients.get(app);
  if (client === undefined) {
    client = { worker: null, failed: false, nextId: 1, pending: null };
    clients.set(app, client);
  }
  return client;
}

async function runInline(job: IntakeJob): Promise<IntakeRun> {
  const wasm = await loadMeshWasm();
  return { result: await wasm.runIntakeJob(job), worker: false };
}

/**
 * Runs an intake job (see the module comment). The job's arrays are copied before they are transferred, so the
 * caller's (the document's) data never detaches.
 */
export async function runIntake(app: EditorApp, job: IntakeJob): Promise<IntakeRun> {
  const client = clientOf(app);
  const earlier = client.pending;
  if (earlier !== null) {
    client.pending = null;
    earlier.reject(new EkzaError('cancelled', 'The intake job was superseded by a newer one'));
    client.worker?.terminate();
    client.worker = null;
  }
  const create = client.failed ? null : ((app.meshes as unknown as IntakeWorkerHost).intakeWorker ?? null);
  if (create === null) return runInline(job);
  const wasm = await loadMeshWasm();
  const copy: IntakeJob = { ...job, meshes: job.meshes.map((mesh) => ({ ...mesh, data: wasm.cloneMeshData(mesh.data) })) };
  return new Promise<IntakeRun>((resolve, reject) => {
    const id = client.nextId++;
    client.pending = { id, job, resolve, reject };
    const fallBack = (): void => {
      // The worker did not load or crashed: the same chain on this thread; later jobs skip the worker.
      client.failed = true;
      client.worker?.terminate();
      client.worker = null;
      const pending = client.pending;
      client.pending = null;
      if (pending !== null) runInline(pending.job).then(pending.resolve, pending.reject);
    };
    try {
      if (client.worker === null) {
        const worker = create();
        worker.onmessage = (event) => {
          const response = event.data;
          const pending = client.pending;
          if (pending === null || pending.id !== response.id) return;
          client.pending = null;
          if ('error' in response) pending.reject(new EkzaError(response.error.code, response.error.message));
          else pending.resolve({ result: response.result, worker: true });
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          fallBack();
        };
        client.worker = worker;
      }
      client.worker.postMessage({ type: 'intake', id, job: copy }, wasm.transferablesOf(copy));
    } catch {
      fallBack();
    }
  });
}
