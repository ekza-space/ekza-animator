// SaveTicket (STUDIO-TOUCH-SPEC S9, S24, §13.3, §20.4; ST-21): a file that leaves the page on a tap. On iPadOS
// `<a download>` lands in Downloads and the share sheet (the way to Files) needs a fresh user activation, but an export
// or a project zip is ready long after the tap that asked for it. A ticket holds the file (`ready` once its bytes are
// there); `deliver()`, called from a tap, shares it through `navigator.share({files})` where the platform prefers
// sharing and `canShare` accepts the file, else downloads it. A share that has not settled within ~10 s falls back to
// the download (some iOS versions never settle it after *Save to Files*, WebKit 234187); a dismissed share sheet
// leaves the ticket ready for another tap. Elsewhere delivery is a plain download.
//
// The page's save queue (`pageSaveQueue`) holds the tickets that wait for the host's save prompt (`SavePrompt`).
// This module is a lazy chunk: only iOS pages and callers of `FileService.save()` load it (`files.ts`).
import { anchorDownload, blobPart, sharePreferred } from './files';

/** A file to save: its bytes, or the promise of them (an export still baking). */
export interface SaveFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array | Promise<Uint8Array>;
}

export type SaveTicketState = 'preparing' | 'ready' | 'delivered' | 'failed';
/** How a delivery ended: through the share sheet, as a download, or with the share sheet dismissed. */
export type SaveDelivery = 'shared' | 'downloaded' | 'cancelled';

export interface SaveTicket {
  readonly fileName: string;
  readonly mime: string;
  readonly state: SaveTicketState;
  /** Resolves once the bytes are there; rejects when they fail. */
  readonly ready: Promise<void>;
  /** How the file left, once it has; null before. */
  readonly delivered: 'shared' | 'downloaded' | null;
  /** Shares or downloads the file; call it from a fresh user activation on iOS. A delivery in flight is shared, a
   *  finished one returns its result again, a dismissed share sheet ('cancelled') leaves the ticket ready. */
  deliver(): Promise<SaveDelivery>;
  /** Called on every state change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** The platform seams of delivery (fakes in tests; `browserSavePlatform()` in pages). */
export interface SavePlatform {
  /** True where files leave through the share sheet: iPadOS / iOS WebKit with Web Share for files. */
  prefersShare(): boolean;
  canShare(file: File): boolean;
  share(file: File): Promise<void>;
  download(name: string, bytes: Uint8Array, mime: string): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SaveTicketOptions {
  /** How long a share may stay unsettled before the download fallback (default `SHARE_TIMEOUT_MS`). */
  readonly shareTimeoutMs?: number;
  /** Called once with the bytes when they are there (the e2e export recorder). */
  readonly onBytes?: (bytes: Uint8Array) => void;
}

export const SHARE_TIMEOUT_MS = 10_000;

/** The browser's delivery: the share sheet where `sharePreferred()` (iOS WebKit with Web Share), else downloads. */
export function browserSavePlatform(): SavePlatform {
  return {
    prefersShare: sharePreferred,
    canShare: (file) => {
      try {
        return navigator.canShare({ files: [file] });
      } catch {
        return false;
      }
    },
    share: (file) => navigator.share({ files: [file] }),
    download: anchorDownload,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** A ticket for `file`; nothing leaves the page until `deliver()`. */
export function createSaveTicket(file: SaveFile, platform: SavePlatform, opts: SaveTicketOptions = {}): SaveTicket {
  const timeout = opts.shareTimeoutMs ?? SHARE_TIMEOUT_MS;
  const listeners = new Set<() => void>();
  let state: SaveTicketState = 'preparing';
  let bytes: Uint8Array | null = null;
  let failure: Error | null = null;
  let delivered: 'shared' | 'downloaded' | null = null;
  let inFlight: Promise<SaveDelivery> | null = null;

  const set = (next: SaveTicketState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const take = (value: Uint8Array): void => {
    bytes = value;
    opts.onBytes?.(value);
    set('ready');
  };

  let ready: Promise<void>;
  if (file.bytes instanceof Uint8Array) {
    take(file.bytes);
    ready = Promise.resolve();
  } else {
    ready = file.bytes.then(take, (error: unknown) => {
      failure = asError(error);
      set('failed');
      throw failure;
    });
    // `ready` is for whoever waits on it; an unobserved failure is the ticket's state, not an unhandled rejection.
    ready.catch(() => {});
  }

  const finish = (how: 'shared' | 'downloaded'): SaveDelivery => {
    delivered = how;
    set('delivered');
    return how;
  };
  const download = (data: Uint8Array): SaveDelivery => {
    platform.download(file.name, data, file.mime);
    return finish('downloaded');
  };

  /** Starts the delivery of ready bytes; the share (when there is one) is called before the first await. */
  const run = (data: Uint8Array): Promise<SaveDelivery> => {
    if (!platform.prefersShare()) return Promise.resolve(download(data));
    const shared = new File([blobPart(data)], file.name, { type: file.mime });
    if (!platform.canShare(shared)) return Promise.resolve(download(data));
    return new Promise<SaveDelivery>((resolve) => {
      let settled = false;
      const timer = platform.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(download(data));
      }, timeout);
      const settle = (how: () => SaveDelivery): void => {
        if (settled) return;
        settled = true;
        platform.clearTimeout(timer);
        resolve(how());
      };
      let sharing: Promise<void>;
      try {
        sharing = platform.share(shared);
      } catch (error) {
        sharing = Promise.reject(asError(error));
      }
      sharing.then(
        () => settle(() => finish('shared')),
        // Dismissed: ready for another tap. Refused (no activation, a type the sheet cannot take): Downloads.
        (error: unknown) => settle(() => (isAbort(error) ? 'cancelled' : download(data))),
      );
    });
  };

  return {
    fileName: file.name,
    mime: file.mime,
    get state() {
      return state;
    },
    ready,
    get delivered() {
      return delivered;
    },
    deliver(): Promise<SaveDelivery> {
      if (delivered !== null) return Promise.resolve(delivered);
      if (inFlight !== null) return inFlight;
      if (state === 'failed') return Promise.reject(failure ?? new Error(`${file.name} could not be prepared`));
      const started = bytes !== null ? run(bytes) : ready.then(() => run(bytes as Uint8Array));
      const current = started.finally(() => {
        if (inFlight === current) inFlight = null;
      });
      inFlight = current;
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The tickets that wait for the page's save prompt. */
export interface SaveQueue {
  /** Waiting tickets, oldest first (delivered and dismissed ones leave). */
  readonly tickets: readonly SaveTicket[];
  offer(ticket: SaveTicket): void;
  /** Takes a ticket off the queue without delivering it. */
  dismiss(ticket: SaveTicket): void;
  /** Called whenever the waiting tickets change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** A save prompt rendering this queue: while one is attached, the file service does not mount its own. */
  attach(): () => void;
  readonly attached: number;
}

export function createSaveQueue(): SaveQueue {
  let tickets: readonly SaveTicket[] = [];
  let attached = 0;
  const listeners = new Set<() => void>();
  const watching = new Map<SaveTicket, () => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const remove = (ticket: SaveTicket): void => {
    if (!tickets.includes(ticket)) return;
    watching.get(ticket)?.();
    watching.delete(ticket);
    tickets = tickets.filter((other) => other !== ticket);
    notify();
  };
  return {
    get tickets() {
      return tickets;
    },
    offer(ticket) {
      if (tickets.includes(ticket) || ticket.state === 'delivered' || ticket.state === 'failed') return;
      tickets = [...tickets, ticket];
      watching.set(
        ticket,
        ticket.subscribe(() => {
          if (ticket.state === 'delivered' || ticket.state === 'failed') remove(ticket);
          else notify();
        }),
      );
      notify();
    },
    dismiss: remove,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach() {
      attached++;
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        attached--;
      };
    },
    get attached() {
      return attached;
    },
  };
}

let pageQueue: SaveQueue | null = null;

/** The page's save queue (one per page load, shared by its file service and its save prompt). */
export function pageSaveQueue(): SaveQueue {
  pageQueue ??= createSaveQueue();
  return pageQueue;
}
