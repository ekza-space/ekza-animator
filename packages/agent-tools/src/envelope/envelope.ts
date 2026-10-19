// The result envelope (MCP-SPEC §5.3): every outgoing string through the one sanitiser, `warnings` capped (≤ 10,
// ≤ 200 characters each), `data` cut to the tool's hard token cap (§5.5). Used by the runtime for every result and by
// the server again on every tab result (§5.10).
import { MAX_WARNINGS, TRUNCATED_NEXT, WARNING_MAX_CHARS, enforceBudget } from '../budget/budget';
import { NAME_MAX_CHARS, PROSE_MAX_CHARS, sanitizeDeep, sanitizeText } from '../sanitize/sanitize';
import type { AgentToolError, AgentToolResult, ClipInfo, UndoInfo } from '../types';

/** At most this many candidates in an error (§4.4). */
export const MAX_CANDIDATES = 5;

const name = (text: string): string => sanitizeText(text, { maxChars: NAME_MAX_CHARS, kind: 'name' });
const prose = (text: string, max = PROSE_MAX_CHARS): string => sanitizeText(text, { maxChars: max, kind: 'prose' });

function sanitizeClip(clip: ClipInfo): ClipInfo {
  return {
    character: name(clip.character),
    name: name(clip.name),
    fps: clip.fps,
    rangeFrames: [clip.rangeFrames[0], clip.rangeFrames[1]],
    loop: clip.loop,
    revision: clip.revision,
  };
}

function sanitizeUndo(undo: UndoInfo): UndoInfo {
  return { step: undo.step, label: name(undo.label) };
}

/** The error part of an envelope, sanitised (message and hint as prose, candidates as names, ≤ 5). */
export function sanitizeError(error: AgentToolError): AgentToolError {
  return {
    code: error.code,
    message: prose(error.message),
    hint: prose(error.hint),
    ...(error.candidates === undefined ? {} : { candidates: error.candidates.slice(0, MAX_CANDIDATES).map(name) }),
    retryable: error.retryable,
    ...(error.detail === undefined
      ? {}
      : {
          detail: sanitizeDeep(error.detail, { maxChars: PROSE_MAX_CHARS, kind: 'prose' }) as Record<string, unknown>,
        }),
  };
}

/**
 * Sanitises a result and enforces the hard cap on its `data` (§5.3, §5.5). `maxTokens` null leaves the size alone
 * (the server's re-validation passes the tool's own cap).
 */
export function finishResult(result: AgentToolResult<unknown>, maxTokens: number | null): AgentToolResult<unknown> {
  if (!result.ok) return { ok: false, error: sanitizeError(result.error) };
  const clean = sanitizeDeep(result.data, { maxChars: PROSE_MAX_CHARS, kind: 'prose' });
  const budgeted = maxTokens === null ? { data: clean, truncated: false } : enforceBudget(clean, maxTokens);
  const warnings = (result.warnings ?? []).slice(0, MAX_WARNINGS).map((w) => prose(w, WARNING_MAX_CHARS));
  const next = result.next ?? (budgeted.truncated ? TRUNCATED_NEXT : undefined);
  return {
    ok: true,
    data: budgeted.data,
    ...(result.clip === undefined ? {} : { clip: sanitizeClip(result.clip) }),
    ...(result.undo === undefined ? {} : { undo: sanitizeUndo(result.undo) }),
    ...(result.images === undefined ? {} : { images: result.images }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(next === undefined ? {} : { next: prose(next) }),
  };
}
