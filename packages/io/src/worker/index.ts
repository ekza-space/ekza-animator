// '@ekza-studio/io/worker': the in-app glTF-Validator worker protocol (M1-stretch, MVP-SPEC §1.2). io never
// imports gltf-validator: the editor's worker entry imports it and calls `serveGltfValidator(self, module)`; the
// main thread wraps the Worker with `createValidatorClient(worker)`. The bundler-specific `new Worker(new URL(...))`
// call belongs to the host. Both ends take a minimal message endpoint (a Worker, a worker's global scope or a
// MessagePort), so this module needs neither the DOM nor the WebWorker library at runtime.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ValidationIssue, ValidationReport } from '../types';
import { type GltfValidatorModule, validateWith } from '../validate/validate';

export type { GltfValidatorModule } from '../validate/validate';

/** Message tag; requests and responses with another tag are ignored, so the channel can carry other traffic. */
export const VALIDATOR_PROTOCOL = 'ekza-studio-validator/v1';

export interface ValidatorRequest {
  readonly protocol: typeof VALIDATOR_PROTOCOL;
  readonly id: number;
  readonly bytes: Uint8Array;
  /** 0 = unlimited (what `compareValidation` needs). */
  readonly maxIssues: number;
}

export type ValidatorResponse =
  | {
      readonly protocol: typeof VALIDATOR_PROTOCOL;
      readonly id: number;
      readonly ok: true;
      readonly report: ValidationReport;
    }
  | {
      readonly protocol: typeof VALIDATOR_PROTOCOL;
      readonly id: number;
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

type MessageListener = (event: { readonly data: unknown }) => void;

/** The part of a Worker, DedicatedWorkerGlobalScope or MessagePort the protocol uses. */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: 'message', listener: MessageListener): void;
}

/**
 * Worker side: answers every validator request on `endpoint` with `validator` (the `gltf-validator` module).
 * Requests are independent and may complete out of order. Returns a function that stops serving.
 */
export function serveGltfValidator(endpoint: MessageEndpoint, validator: GltfValidatorModule): () => void {
  const listener: MessageListener = (event) => {
    const request = event.data;
    if (!isRequest(request)) return;
    validateWith(validator, request.bytes, { maxIssues: request.maxIssues }).then(
      (report) => endpoint.postMessage({ protocol: VALIDATOR_PROTOCOL, id: request.id, ok: true, report }, []),
      (error: unknown) =>
        endpoint.postMessage(
          {
            protocol: VALIDATOR_PROTOCOL,
            id: request.id,
            ok: false,
            code: error instanceof EkzaError ? error.code : 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
          [],
        ),
    );
  };
  endpoint.addEventListener('message', listener);
  return () => endpoint.removeEventListener('message', listener);
}

export interface ValidatorClient {
  /** The validator's report of a GLB; the caller keeps `bytes` (a copy is transferred to the worker). */
  validate(bytes: Uint8Array, opts?: { readonly maxIssues?: number }): Promise<ValidationReport>;
  /** Stops listening; pending and later calls reject with EkzaError('unsupported'). Does not terminate a Worker. */
  dispose(): void;
}

/** Main-thread side of the protocol over a Worker (or any endpoint served by `serveGltfValidator`). */
export function createValidatorClient(endpoint: MessageEndpoint): ValidatorClient {
  let nextId = 1;
  let disposed = false;
  const pending = new Map<
    number,
    { readonly resolve: (report: ValidationReport) => void; readonly reject: (error: EkzaError) => void }
  >();
  const listener: MessageListener = (event) => {
    const response = event.data;
    if (!isResponse(response)) return;
    const call = pending.get(response.id);
    if (call === undefined) return;
    pending.delete(response.id);
    if (response.ok) call.resolve(response.report);
    else call.reject(new EkzaError(response.code, response.message));
  };
  endpoint.addEventListener('message', listener);
  const closed = (): EkzaError => new EkzaError('unsupported', 'The glTF-Validator client was disposed');

  return {
    validate(bytes, opts) {
      if (disposed) return Promise.reject(closed());
      const id = nextId++;
      // A copy keeps the caller's bytes (the download) intact; its buffer is transferred, not cloned again.
      const copy = bytes.slice();
      const request: ValidatorRequest = {
        protocol: VALIDATOR_PROTOCOL,
        id,
        bytes: copy,
        maxIssues: opts?.maxIssues ?? 0,
      };
      return new Promise<ValidationReport>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        endpoint.postMessage(request, [copy.buffer]);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      endpoint.removeEventListener('message', listener);
      for (const call of pending.values()) call.reject(closed());
      pending.clear();
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isRequest(value: unknown): value is ValidatorRequest {
  return (
    isRecord(value) &&
    value['protocol'] === VALIDATOR_PROTOCOL &&
    typeof value['id'] === 'number' &&
    value['bytes'] instanceof Uint8Array &&
    typeof value['maxIssues'] === 'number'
  );
}

function isResponse(value: unknown): value is ValidatorResponse {
  if (!isRecord(value) || value['protocol'] !== VALIDATOR_PROTOCOL || typeof value['id'] !== 'number') return false;
  if (value['ok'] === true) return isReport(value['report']);
  return value['ok'] === false && typeof value['code'] === 'string' && typeof value['message'] === 'string';
}

function isReport(value: unknown): value is ValidationReport {
  return (
    isRecord(value) &&
    typeof value['errors'] === 'number' &&
    typeof value['warnings'] === 'number' &&
    typeof value['infos'] === 'number' &&
    Array.isArray(value['issues']) &&
    (value['issues'] as unknown[]).every(isIssue)
  );
}

function isIssue(value: unknown): value is ValidationIssue {
  return isRecord(value) && typeof value['code'] === 'string' && typeof value['severity'] === 'number';
}
