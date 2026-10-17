/** Joins class names, skipping falsy parts. Later classes do not override earlier ones (no tailwind-merge). */
export function cn(...parts: readonly (string | false | null | undefined)[]): string {
  let out = '';
  for (const part of parts) {
    if (part === false || part === null || part === undefined || part === '') continue;
    out = out === '' ? part : `${out} ${part}`;
  }
  return out;
}
