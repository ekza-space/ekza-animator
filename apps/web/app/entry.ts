// The remembered entry choice (AUTORIG-SPEC §3.3, D2): `localStorage['ekza-studio:entry:v1'] =
// {"choice": "autorig" | "studio", "at": <ms>}`. Written when a chooser card is followed with *Remember* ticked (and by
// Studio's first-run dialog and Preferences › Start in, which keep their own copy of these few lines in
// `packages/editor/src/dialogs/entryChoice.ts`; `test/entry-contract.test.ts` holds the two to one key and record);
// cleared by unticking *Remember* on `/?chooser=1` or by Start in: Ask.
// Every storage access is wrapped in try/catch: storage that is blocked, full or throwing on access means "Ask".
//
// `/` applies the choice with `REDIRECT_SCRIPT`, an inline script that runs while the page is parsed (before the first
// paint where the browser allows): with a remembered choice and no `?chooser=1` it replaces the location with
// `/autorig` or `/editor`, keeping the rest of the query. The chooser is rendered underneath, so a blocked script (or
// no JavaScript at all) still shows it. A back/forward visit of `/` never redirects (no history trap). Deep links
// (`/autorig`, `/editor`) never redirect: only `/` carries the script.

/** The storage key (a new `ekza-studio:` key; the shipped `ekza-animator:` keys keep their names, GLOSSARY). */
export const ENTRY_KEY = 'ekza-studio:entry:v1';

export type EntryChoice = 'autorig' | 'studio';

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
export const ENTRY_ROUTES: Readonly<Record<EntryChoice, string>> = { autorig: '/autorig', studio: '/editor' };

/** The query parameter that shows the chooser even with a remembered choice (`/?chooser=1`, "Switch mode…"). */
export const CHOOSER_PARAM = 'chooser';

const isChoice = (value: unknown): value is EntryChoice => value === 'autorig' || value === 'studio';

/** The choice in a stored value, or null (absent, malformed, unknown). */
export function parseChoice(raw: string | null): EntryChoice | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const choice = (value as { choice?: unknown }).choice;
    return isChoice(choice) ? choice : null;
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
export function readChoice(storage: EntryStorage | null = browserStorage()): EntryChoice | null {
  try {
    return storage === null ? null : parseChoice(storage.getItem(ENTRY_KEY));
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
 * when `?chooser=1` asks for the chooser, or on a back/forward visit.
 */
export function redirectHref(search: string, choice: EntryChoice | null, backForward = false): string | null {
  if (choice === null || backForward) return null;
  if (new URLSearchParams(search).get(CHOOSER_PARAM) === '1') return null;
  return entryHref(choice, search);
}

/**
 * The inline script of `/` (the same rule as `redirectHref` over `readChoice`, written without helpers so it runs on
 * its own; `test/entry-redirect.test.ts` runs it against the function over the same cases). ES5, no globals left.
 */
export const REDIRECT_SCRIPT = `(function(){try{var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];if(n&&n.type==='back_forward')return;var q=new URLSearchParams(location.search);if(q.get('${CHOOSER_PARAM}')==='1')return;var v=JSON.parse(localStorage.getItem('${ENTRY_KEY}')||'null');var c=v&&v.choice;var r=c==='autorig'?'${ENTRY_ROUTES.autorig}':c==='studio'?'${ENTRY_ROUTES.studio}':'';if(!r)return;q.delete('${CHOOSER_PARAM}');var s=q.toString();location.replace(r+(s?'?'+s:''))}catch(e){}})();`;
