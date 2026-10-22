// The remembered entry choice of the landing page `/` (AUTORIG-SPEC §3.3, D2), as Studio's first-run dialog and
// Preferences › Start in write it. The landing's own module is `apps/web/app/entry.ts` (the app cannot be imported
// from here); `apps/web/test/entry-contract.test.ts` holds both to the same key and record. Blocked storage = Ask.

/** `localStorage` key of the remembered choice: `{"choice": "autorig" | "studio", "at": <ms>}`. */
export const ENTRY_KEY = 'ekza-studio:entry:v1';

export type EntryChoice = 'autorig' | 'studio';

/** The remembered choice; null = Ask (nothing stored, malformed, or storage blocked). */
export function readEntryChoice(): EntryChoice | null {
  try {
    const record: unknown = JSON.parse(localStorage.getItem(ENTRY_KEY) ?? 'null');
    const choice = typeof record === 'object' && record !== null ? (record as { choice?: unknown }).choice : null;
    return choice === 'autorig' || choice === 'studio' ? choice : null;
  } catch {
    return null;
  }
}

/** Remembers `choice`; null forgets it (Ask). Silently does nothing when storage is blocked. */
export function writeEntryChoice(choice: EntryChoice | null): void {
  try {
    if (choice === null) localStorage.removeItem(ENTRY_KEY);
    else localStorage.setItem(ENTRY_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    // Blocked or full storage: the landing asks again.
  }
}
