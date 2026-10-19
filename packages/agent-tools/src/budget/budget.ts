// Token budgets (MCP-SPEC §5.5): 3.5 characters of minified JSON per token. The runtime enforces the hard cap: an
// over-long `data` list is cut, `truncated: true` is set in `data`, and `next` explains how to page.
export const CHARS_PER_TOKEN = 3.5;
/** At most this many warnings, each at most this long (§5.3). */
export const MAX_WARNINGS = 10;
export const WARNING_MAX_CHARS = 200;
export const TRUNCATED_NEXT =
  'The result was cut to fit the budget: narrow it (rangeFrames, targets, bodyParts, limit) or page with cursor.';

/** Estimated tokens of a JSON value (minified). */
export function tokensOf(value: unknown): number {
  return Math.ceil((JSON.stringify(value) ?? '').length / CHARS_PER_TOKEN);
}

interface ArrayRef {
  readonly owner: unknown[] | Record<string, unknown>;
  readonly key: number | string;
  readonly array: unknown[];
  readonly size: number;
}

/** Every array inside `value` with its serialised size, largest first. */
function arraysOf(value: unknown, out: ArrayRef[]): void {
  if (value === null || typeof value !== 'object') return;
  const entries: [number | string, unknown][] = Array.isArray(value)
    ? value.map((item, i) => [i, item])
    : Object.entries(value as Record<string, unknown>);
  for (const [key, inner] of entries) {
    if (Array.isArray(inner)) {
      out.push({
        owner: value as unknown[] | Record<string, unknown>,
        key,
        array: inner,
        size: (JSON.stringify(inner) ?? '').length,
      });
    }
    arraysOf(inner, out);
  }
}

/**
 * Cuts the largest lists of `data` (a deep copy) until it fits `maxTokens`; returns the data and whether it was cut.
 * Objects get `truncated: true`. A result that cannot be cut below the cap is returned cut as far as possible.
 */
export function enforceBudget(
  data: unknown,
  maxTokens: number,
): { readonly data: unknown; readonly truncated: boolean } {
  if (tokensOf(data) <= maxTokens) return { data, truncated: false };
  const copy: unknown = JSON.parse(JSON.stringify(data) ?? 'null');
  for (let guard = 0; guard < 10_000 && tokensOf(copy) > maxTokens; guard++) {
    const arrays: ArrayRef[] = [];
    arraysOf(copy, arrays);
    const largest = arrays.filter((ref) => ref.array.length > 0).sort((a, b) => b.size - a.size)[0];
    if (largest === undefined) break;
    const keep = Math.floor(largest.array.length / 2);
    const cut = largest.array.slice(0, keep);
    if (Array.isArray(largest.owner)) largest.owner[largest.key as number] = cut;
    else largest.owner[largest.key as string] = cut;
  }
  if (copy !== null && typeof copy === 'object' && !Array.isArray(copy)) {
    (copy as Record<string, unknown>)['truncated'] = true;
  }
  return { data: copy, truncated: true };
}
