// The landing page's remembered entry choice (AUTORIG-SPEC §3.3, D2) as Studio reads and writes it: Preferences ›
// Start in (read, write, forget); the first-run dialog's "Open this mode next time" writes the same record inline (its
// chunk counts in `/editor`'s first visit, and a lazy import costs more there than the line). The landing's own module
// is `apps/web/app/entry.ts` (the app cannot be imported from here, nor the editor from the landing);
// `apps/web/test/entry-contract.test.ts` holds both to one key and record. Blocked storage = Ask.

/** `localStorage` key of the landing's remembered choice: `{"choice": "autorig" | "studio", "at": <ms>}`. */
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

/** Remembers `choice`; null forgets it (Ask). Does nothing when storage is blocked. */
export function writeEntryChoice(choice: EntryChoice | null): void {
  try {
    if (choice === null) localStorage.removeItem(ENTRY_KEY);
    else localStorage.setItem(ENTRY_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    // Blocked or full storage: the landing asks again.
  }
}
