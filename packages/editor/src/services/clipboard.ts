// System clipboard with an in-app fallback (ClipboardService, MVP-SPEC §4.5). Permission or focus errors never
// lose a copy: the last written text is kept and returned when the system clipboard cannot be read.
import type { ClipboardService } from '@ekza-animator/editor-core';

export function createBrowserClipboard(): ClipboardService {
  let fallback: string | null = null;
  return {
    async writeText(text: string): Promise<void> {
      fallback = text;
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // Denied permission, an unfocused document or an insecure context: the in-app copy above remains.
      }
    },
    async readText(): Promise<string | null> {
      try {
        const text = await navigator.clipboard?.readText();
        if (typeof text === 'string' && text !== '') return text;
      } catch {
        // Fall back to the last text written by the app.
      }
      return fallback;
    },
  };
}
