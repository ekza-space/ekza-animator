// Error mapping of the tool runtime (MCP-SPEC §5.4): thrown `AgentToolFailure`s become error envelopes; operator
// results that did not finish map to `cancelled` (the agent's signal), `busy` (the user's drag: the runner's "gesture
// in progress"), `poll_failed` (a refused poll) or the `EkzaError` code of a failed run; everything else is
// `internal` — messages never contain stack traces, paths (`scrubPaths`) or tokens.
import { EkzaError } from '@ekza-animator/anim-core';
import { CANCELLED_BY_AGENT, GESTURE_IN_PROGRESS, type OperatorResult } from '@ekza-animator/editor-core';
import { AgentToolFailure, type AgentErrorCode } from '../types';

/** `EkzaError` codes with a tool error of their own (§5.4); every other code is `internal`. */
const EKZA_CODES: Readonly<Record<string, AgentErrorCode>> = {
  'invalid-record': 'invalid_args',
  'asset-missing': 'io_error',
  'read-only': 'read_only',
};

const INTERNAL_HINT = 'report this; the document was rolled back';

/**
 * An absolute path inside error text: POSIX (`/Users/…`, not preceded by a word character or a slash, so `30/1`,
 * `and/or` and `https://host/x` stay), a Windows drive or UNC path, or a `file:` URL.
 */
const ABSOLUTE_PATH =
  /(?<![\w.~/\\-])(?:file:\/{2,3}[^\s'"`<>()]*|[A-Za-z]:[\\/][^\s'"`<>()]*|\\\\[^\s'"`<>()]+|\/(?:[^\s'"`<>()/]+\/)*[^\s'"`<>()/]+\/?)/g;

/**
 * Error text with every absolute path replaced by its base name (§5.4: messages never contain paths outside the
 * workspace). Operator and host errors (a Node fs error, a runner `internal` carrying a `TypeError` text) pass here.
 */
export function scrubPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (path) => {
    const parts = path.split(/[\\/]/).filter((part) => part !== '');
    return parts.at(-1) ?? '';
  });
}

/** The tool error for an `EkzaError` thrown by an operator or a tool (absolute paths reduced to base names). */
export function failureFromEkza(error: EkzaError, operator?: string): AgentToolFailure {
  const code = EKZA_CODES[error.code] ?? 'internal';
  const where = operator === undefined ? '' : `${operator}: `;
  const message = `${where}${scrubPaths(error.message)}`;
  if (code === 'internal') {
    return new AgentToolFailure('internal', message, INTERNAL_HINT, {
      retryable: false,
      detail: { ekzaCode: error.code },
    });
  }
  const hint =
    code === 'invalid_args'
      ? 'check the arguments against the tool schema'
      : code === 'io_error'
        ? 'check the file and its size'
        : 'this project was saved by a newer editor; ask the user';
  return new AgentToolFailure(code, message, hint, { detail: { ekzaCode: error.code } });
}

/** The tool error for anything a tool threw: failures pass, `EkzaError`s map, the rest is `internal`. */
export function failureFrom(error: unknown): AgentToolFailure {
  if (error instanceof AgentToolFailure) return error;
  if (error instanceof EkzaError) return failureFromEkza(error);
  return new AgentToolFailure('internal', 'The tool failed unexpectedly.', INTERNAL_HINT, { retryable: false });
}

/**
 * Throws the tool error of an operator result that did not finish (§5.4): the agent's signal → `cancelled`, the
 * user's drag ("gesture in progress", runner rule 9) → `busy`, a refused poll → `poll_failed` with the reason, a
 * failed run → its `EkzaError` code. Returns the value of a finished run.
 */
export function finishedValue(operator: string, result: OperatorResult<unknown>): unknown {
  if (result.status === 'finished') return result.value;
  if (result.status === 'cancelled') {
    if (result.reason === CANCELLED_BY_AGENT) {
      throw new AgentToolFailure('cancelled', `${operator} was cancelled before it applied.`, 'nothing changed');
    }
    if (result.reason === GESTURE_IN_PROGRESS) {
      throw new AgentToolFailure('busy', 'The user is dragging; the edit did not run.', 'retry in a moment', {
        retryable: true,
      });
    }
    throw new AgentToolFailure('poll_failed', `${operator} refused: ${result.reason}.`, 'fix what the reason names', {
      detail: { operatorReason: result.reason },
    });
  }
  throw failureFromEkza(new EkzaError(result.error.code, result.error.message), operator);
}
