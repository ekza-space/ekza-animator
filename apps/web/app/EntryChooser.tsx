'use client';

// The chooser's client part (AUTORIG-SPEC §3.2, §3.3; D2; ≤ 1.5 kB gzip): the *Remember my choice on this device* box
// and the card clicks it applies to. The cards themselves are the server page's plain links (`a[data-entry]`), so the
// chooser works without JavaScript; this island only adds the memory. Once hydrated it ticks the box when a choice is
// remembered (the visitor came by `/?chooser=1`) and lets the cards carry the page's query (e2e switches); unticking
// it forgets the choice at once (Ask); following a card with the box ticked remembers that card. Blocked storage
// leaves the box working and remembers nothing. STUDIO-TOUCH-SPEC §1.2 (T2): with `HALO_ENTRY` the Ekza Studio row
// (`data-entry="halo"`) is a choice too.
import { type JSX, useEffect, useState, useSyncExternalStore } from 'react';
import { type EntryChoice, entryHref, isChoice, readChoice, writeChoice } from './entry';

const choiceOf = (target: EventTarget | null): EntryChoice | null => {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-entry]') : null;
  const choice = link?.dataset.entry;
  return isChoice(choice) ? choice : null;
};

/** Nothing to subscribe to: storage is read on the client render; the server render is "not hydrated, Ask". */
const subscribe = (): (() => void) => () => {};

export function EntryChooser(): JSX.Element {
  // Disabled until hydrated: without JavaScript the box could remember nothing.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => readChoice() !== null,
    () => false,
  );
  const [ticked, setTicked] = useState<boolean | null>(null);
  const remember = ticked ?? stored;

  // The cards carry the page's query (e2e switches), `chooser` dropped.
  useEffect(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-entry]')) {
      const choice = choiceOf(link);
      if (choice !== null) link.href = entryHref(choice, location.search);
    }
  }, []);

  // Primary and middle clicks (a new tab is a choice too); capture, so the write happens before the page leaves.
  useEffect(() => {
    if (!remember) return undefined;
    const follow = (event: MouseEvent): void => {
      const choice = choiceOf(event.target);
      if (choice !== null) writeChoice(choice);
    };
    document.addEventListener('click', follow, true);
    document.addEventListener('auxclick', follow, true);
    return () => {
      document.removeEventListener('click', follow, true);
      document.removeEventListener('auxclick', follow, true);
    };
  }, [remember]);

  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-fg-2 has-[:disabled]:cursor-default">
      <input
        type="checkbox"
        className="size-4 accent-[var(--accent-fill)]"
        checked={remember}
        disabled={!hydrated}
        data-testid="entry-remember"
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setTicked(next);
          if (!next) writeChoice(null);
        }}
      />
      <span>
        Remember my choice on this device <span className="text-fg-3">(switch any time from the app)</span>
      </span>
    </label>
  );
}
