// The landing page's remembered entry choice (AUTORIG-SPEC §3.3, D2) as Studio reads and writes it: Preferences ›
// Start in (read, write, forget); the first-run dialog's "Open this mode next time" writes the same record inline (its
// chunk counts in `/editor`'s first visit, and a lazy import costs more there than the line). The landing's own module
// is `apps/web/app/entry.ts` (the app cannot be imported from here, nor the editor from the landing);
// `apps/web/test/entry-contract.test.ts` holds both to one key, one record and one `HALO_ENTRY` flag. Blocked storage
// = Ask.
//
// STUDIO-TOUCH-SPEC §1.2 (T2): the choice gains `'halo'` (Ekza Studio's Simple layout, `/app`) behind `HALO_ENTRY`.
// While the flag is false (until T12, ST-30) a stored `'halo'` reads as nothing (Ask) and Start in offers today's
// three rows, so nothing changes for users; the landing's copy follows the same flag.

/** `localStorage` key of the landing's remembered choice: `{"choice": "autorig" | "studio" | "halo", "at": <ms>}`. */
export const ENTRY_KEY = 'ekza-studio:entry:v1';

/** STUDIO-TOUCH-SPEC ST-2, ST-30: Ekza Studio (Halo) as the front door; T12 turns it on with the landing's copy. */
export const HALO_ENTRY = false;

export type EntryChoice = 'autorig' | 'studio' | 'halo';

/** The remembered choice; null = Ask (nothing stored, malformed, `'halo'` while the flag is off, or storage blocked). */
export function readEntryChoice(): EntryChoice | null {
  try {
    const record: unknown = JSON.parse(localStorage.getItem(ENTRY_KEY) ?? 'null');
    const choice = typeof record === 'object' && record !== null ? (record as { choice?: unknown }).choice : null;
    return choice === 'autorig' || choice === 'studio' || (HALO_ENTRY && choice === 'halo') ? choice : null;
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
