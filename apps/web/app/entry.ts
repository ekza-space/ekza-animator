// The remembered entry choice (AUTORIG-SPEC §3.3, D2): `localStorage['ekza-studio:entry:v1'] =
// {"choice": "autorig" | "studio" | "halo", "at": <ms>}`. Written when a chooser card is followed with *Remember*
// ticked (and by Studio's first-run dialog and Preferences › Start in, which keep their own copy of these few lines in
// `packages/editor/src/dialogs/entryChoice.ts`; `test/entry-contract.test.ts` holds the two to one key and record);
// cleared by unticking *Remember* on `/?chooser=1` or by Start in: Ask.
// Every storage access is wrapped in try/catch: storage that is blocked, full or throwing on access means "Ask".
//
// `/` applies the choice with `REDIRECT_SCRIPT`, an inline script that runs while the page is parsed (before the first
// paint where the browser allows): with a remembered choice and no `?chooser=1` it replaces the location with
// `/autorig` or `/editor`, keeping the rest of the query. The chooser is rendered underneath, so a blocked script (or
// no JavaScript at all) still shows it. A back/forward visit of `/` never redirects (no history trap). Deep links
// (`/autorig`, `/editor`) never redirect: only `/` carries the script.
//
// STUDIO-TOUCH-SPEC §1.2 (T2; ST-2, ST-30): the choice gains `'halo'` (Ekza Studio's Simple layout, `/app`) and, behind
// `HALO_ENTRY`, a new default: a first visit (nothing remembered, a malformed record, blocked storage) opens `/app`
// instead of the chooser; a remembered `'studio'` or `'autorig'` still wins; `/?chooser=1` shows three rows with Ekza
// Studio first. While the flag is false (until T12) the landing is exactly today's: two cards, the same script, and a
// stored `'halo'` reads as nothing (Ask). Studio's copy of the flag (`dialogs/entryChoice.ts`) must match.

/** The storage key (a new `ekza-studio:` key; the shipped `ekza-animator:` keys keep their names, GLOSSARY). */
export const ENTRY_KEY = 'ekza-studio:entry:v1';

/** Ekza Studio (Halo) as the front door (ST-2); T12 turns it on with the "Ekza Studio Pro" title (ST-30). */
export const HALO_ENTRY: boolean = false;

export type EntryChoice = 'autorig' | 'studio' | 'halo';

/** The record stored under `ENTRY_KEY`. */
export interface EntryRecord {
  readonly choice: EntryChoice;
  readonly at: number;
}

/** What the entry code needs of `localStorage` (structural, so Node tests pass a fake). */
export interface EntryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The route each choice opens. */
export const ENTRY_ROUTES = { autorig: '/autorig', studio: '/editor', halo: '/app' } as const satisfies Readonly<
  Record<EntryChoice, string>
>;

/** The query parameter that shows the chooser even with a remembered choice (`/?chooser=1`, "Switch mode…"). */
export const CHOOSER_PARAM = 'chooser';

/** A choice the landing honours: `'halo'` only with `HALO_ENTRY` on. */
export const isChoice = (value: unknown, haloEntry: boolean = HALO_ENTRY): value is EntryChoice =>
  value === 'autorig' || value === 'studio' || (haloEntry && value === 'halo');

/** The choice in a stored value, or null (absent, malformed, unknown). */
export function parseChoice(raw: string | null, haloEntry: boolean = HALO_ENTRY): EntryChoice | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const choice = (value as { choice?: unknown }).choice;
    return isChoice(choice, haloEntry) ? choice : null;
  } catch {
    return null;
  }
}

/** The page's storage, or null when the browser refuses it (the accessor itself can throw). */
export function browserStorage(): EntryStorage | null {
  try {
    return (globalThis as { localStorage?: EntryStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The remembered choice; null = Ask (nothing stored, or storage blocked). */
export function readChoice(
  storage: EntryStorage | null = browserStorage(),
  haloEntry: boolean = HALO_ENTRY,
): EntryChoice | null {
  try {
    return storage === null ? null : parseChoice(storage.getItem(ENTRY_KEY), haloEntry);
  } catch {
    return null;
  }
}

/** Remembers `choice` (null clears it: Ask). Returns whether the storage took it. */
export function writeChoice(
  choice: EntryChoice | null,
  storage: EntryStorage | null = browserStorage(),
  now: number = Date.now(),
): boolean {
  if (storage === null) return false;
  try {
    if (choice === null) storage.removeItem(ENTRY_KEY);
    else storage.setItem(ENTRY_KEY, JSON.stringify({ choice, at: now } satisfies EntryRecord));
    return true;
  } catch {
    return false;
  }
}

/**
 * The route a card (or the redirect) opens from a page whose query is `search`: the choice's route with the page's
 * query, `chooser` dropped (e2e switches such as `e2e`, `ns`, `platform` travel on).
 */
export function entryHref(choice: EntryChoice, search: string): string {
  const query = new URLSearchParams(search);
  query.delete(CHOOSER_PARAM);
  const text = query.toString();
  return `${ENTRY_ROUTES[choice]}${text === '' ? '' : `?${text}`}`;
}

/**
 * Where `/` sends the visitor: the remembered choice's route, or null (show the chooser) when nothing is remembered,
 * when `?chooser=1` asks for the chooser, or on a back/forward visit. With `HALO_ENTRY` nothing remembered opens
 * Ekza Studio (`/app`) instead of the chooser (ST-2).
 */
export function redirectHref(
  search: string,
  choice: EntryChoice | null,
  backForward = false,
  haloEntry: boolean = HALO_ENTRY,
): string | null {
  if ((choice === null && !haloEntry) || backForward) return null;
  if (new URLSearchParams(search).get(CHOOSER_PARAM) === '1') return null;
  return entryHref(choice ?? 'halo', search);
}

/**
 * The inline script of `/` (the same rule as `redirectHref` over `readChoice`, written without helpers so it runs on
 * its own; `test/entry-redirect.test.ts` and `test/entry-contract.test.ts` run it against the function over the same
 * cases). ES5, no globals left. With `haloEntry` off it is byte for byte the script that shipped before T2; on, the
 * storage read has its own `try` (blocked storage is a first visit: `/app`) and every other value opens `/app`.
 */
export function redirectScript(haloEntry: boolean): string {
  const read = haloEntry
    ? `var c;try{var v=JSON.parse(localStorage.getItem('${ENTRY_KEY}')||'null');c=v&&v.choice}catch(e){}`
    : `var v=JSON.parse(localStorage.getItem('${ENTRY_KEY}')||'null');var c=v&&v.choice;`;
  const fallback = haloEntry ? `'${ENTRY_ROUTES.halo}';` : `'';if(!r)return;`;
  return `(function(){try{var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];if(n&&n.type==='back_forward')return;var q=new URLSearchParams(location.search);if(q.get('${CHOOSER_PARAM}')==='1')return;${read}var r=c==='autorig'?'${ENTRY_ROUTES.autorig}':c==='studio'?'${ENTRY_ROUTES.studio}':${fallback}q.delete('${CHOOSER_PARAM}');var s=q.toString();location.replace(r+(s?'?'+s:''))}catch(e){}})();`;
}

/** The inline script `/` renders (`HALO_ENTRY` decides which rule). */
export const REDIRECT_SCRIPT = redirectScript(HALO_ENTRY);
