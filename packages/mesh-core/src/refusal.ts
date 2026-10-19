// Refusals (M6A-SPEC §4.3, §5.1): an op either returns a valid result or a `Refusal` with a human sentence; codes are
// `<op>.<reason>`. Eager-safe.
import type { Refusal } from './types';

export function refuse(code: string, reason: string): Refusal {
  return Object.freeze({ refused: true, code, reason });
}

export function isRefusal(x: unknown): x is Refusal {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { readonly refused?: unknown }).refused === true &&
    typeof (x as { readonly code?: unknown }).code === 'string' &&
    typeof (x as { readonly reason?: unknown }).reason === 'string'
  );
}
