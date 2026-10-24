// The intake worker's request handler (MODELING-PLAN §7.2 G-a): `@ekza-studio/editor`'s worker entry
// (`editor/src/workers/intake.worker.ts`) answers each message with it; editor-core's client runs the same function on
// its own thread in hosts without workers, so both paths give the same bytes.
//
// Protocol: a request `{type: 'intake', id, job}` with the job's buffers transferred; the response `{id, result}`
// (buffers transferred back) or `{id, error: {code, message}}`. One job at a time; the client supersedes a job by
// terminating the worker.
import { runIntakeJob, transferablesOf } from './chain';
import { MESH_WASM_MARKER } from './simplifier';
import type { IntakeJob, IntakeResult } from './types';

export interface IntakeWorkerRequest {
  readonly type: 'intake';
  readonly id: number;
  readonly job: IntakeJob;
}

export type IntakeWorkerResponse =
  | { readonly id: number; readonly result: IntakeResult }
  | { readonly id: number; readonly error: { readonly code: string; readonly message: string } };

/** Answers one request (with the transfer list of its result). */
export async function handleIntakeRequest(
  request: IntakeWorkerRequest,
): Promise<{ readonly response: IntakeWorkerResponse; readonly transfer: ArrayBuffer[] }> {
  const id = typeof request?.id === 'number' ? request.id : -1;
  if (request?.type !== 'intake') {
    return {
      response: { id, error: { code: 'invalid-input', message: `${MESH_WASM_MARKER}: unknown request` } },
      transfer: [],
    };
  }
  try {
    const result = await runIntakeJob(request.job);
    return { response: { id, result }, transfer: transferablesOf(result) };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'intake-failed';
    return {
      response: { id, error: { code, message: error instanceof Error ? error.message : String(error) } },
      transfer: [],
    };
  }
}

export { MESH_WASM_MARKER };
