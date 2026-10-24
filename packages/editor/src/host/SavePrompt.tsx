// The page's save prompt (STUDIO-TOUCH-SPEC S9, S24, §13.3, §20.3 item 15; ST-21): on iOS a file a tap asked for (an
// export, a project) is ready only after that tap's user activation has gone, so it waits in the page's save queue
// as a SaveTicket until a tap here delivers it — the share sheet (Save to Files), or Downloads when sharing is refused
// or never settles. One card at the bottom centre, above the home indicator, for the oldest waiting file; ✕ discards
// it. After a delivery the card says where the file went for a few seconds: iPadOS never confirms where a shared
// file landed, and says so.
//
// A shell or host can render `<SavePrompt queue>` in its tree (it attaches to the queue); without one, the file
// service mounts it in a root of its own on `<body>` (`mountSavePrompt`, a lazy chunk, once per page).
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { SaveDelivery, SaveQueue, SaveTicket } from '../services/saveTicket';

/** How long the delivery note stays (ms). */
export const SAVE_NOTE_MS = 4000;

/** Touch targets of at least 44 × 44 pt and 16 px text (§4.1), whatever the page's styles. */
const TARGET = { minHeight: 44, minWidth: 44, fontSize: 16 } as const;

/** The note after a delivery (`device`: "iPad" or "iPhone"). */
export function deliveryNote(how: Exclude<SaveDelivery, 'cancelled'>, device: string): string {
  return how === 'shared' ? `Shared · ${device} does not confirm where it went` : 'Saved to Downloads';
}

function deviceName(): string {
  return typeof navigator !== 'undefined' && /\biPhone\b/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
}

/** The oldest waiting ticket, re-read whenever the queue or that ticket changes. */
function useFirstTicket(queue: SaveQueue): { readonly ticket: SaveTicket | null; readonly state: string | null } {
  const ticket = useSyncExternalStore(
    (onChange) => queue.subscribe(onChange),
    () => queue.tickets[0] ?? null,
  );
  const state = useSyncExternalStore(
    (onChange) => (ticket === null ? () => {} : ticket.subscribe(onChange)),
    () => ticket?.state ?? null,
  );
  return { ticket, state };
}

export function SavePrompt(props: { readonly queue: SaveQueue }): JSX.Element | null {
  const { queue } = props;
  useEffect(() => queue.attach(), [queue]);
  const { ticket, state } = useFirstTicket(queue);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (note === null) return undefined;
    const timer = setTimeout(() => setNote(null), SAVE_NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  if (ticket === null && note === null) return null;

  const deliver = (target: SaveTicket): void => {
    setBusy(true);
    // Called in the tap's handler: the share starts before the first await, while the activation is fresh.
    target
      .deliver()
      .then((how) => {
        if (how !== 'cancelled') setNote(deliveryNote(how, deviceName()));
      })
      .catch((error: unknown) => {
        console.error('Ekza Studio: the file could not be saved', error);
        setNote(`${target.fileName} could not be saved`);
        queue.dismiss(target);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-(--z-toast) flex justify-center px-3',
        'pointer-events-none',
      )}
    >
      <section
        aria-label="Save file"
        aria-live="polite"
        className={cn(
          'pointer-events-auto flex max-w-full items-center gap-3 rounded-dialog border border-line-strong',
          'bg-panel py-2 pr-2 pl-4 text-base text-fg shadow-popover',
        )}
        data-testid="save-prompt"
        data-state={ticket === null ? 'note' : (state ?? 'ready')}
      >
        {ticket === null ? (
          <span data-testid="save-prompt-note">{note}</span>
        ) : (
          <>
            <span className="min-w-0 truncate" data-testid="save-prompt-file">
              {state === 'preparing' ? `Preparing ${ticket.fileName}…` : `${ticket.fileName} is ready`}
            </span>
            <button
              type="button"
              className={cn(buttonClass('primary'), 'px-4')}
              style={TARGET}
              disabled={state !== 'ready' || busy}
              onClick={() => deliver(ticket)}
              data-testid="save-prompt-deliver"
            >
              Save to Files
            </button>
            <button
              type="button"
              aria-label={`Discard ${ticket.fileName}`}
              className={buttonClass('ghost')}
              style={TARGET}
              disabled={busy}
              onClick={() => queue.dismiss(ticket)}
              data-testid="save-prompt-dismiss"
            >
              ✕
            </button>
          </>
        )}
      </section>
    </div>
  );
}

const mounted = new WeakSet<SaveQueue>();

/** Renders `<SavePrompt queue>` in a root of its own on `<body>`, once per queue (the page's host has none in its tree). */
export function mountSavePrompt(queue: SaveQueue): void {
  if (mounted.has(queue) || queue.attached > 0) return;
  mounted.add(queue);
  const container = document.createElement('div');
  container.dataset['ekzaSavePrompt'] = '';
  document.body.append(container);
  createRoot(container).render(<SavePrompt queue={queue} />);
}
