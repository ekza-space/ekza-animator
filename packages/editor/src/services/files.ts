// The browser's FileService (MVP-SPEC §4.5; STUDIO-TOUCH-SPEC S9, §20.4): `download` and `save`. Everywhere but iOS
// a download is immediate, through a temporary object URL. On iOS WebKit the tap that asked for a file (an export, a
// project) has lost its user activation by the time the bytes are ready, so `download` turns into a SaveTicket that
// waits for the page's save prompt; a fresh tap there shares the file to Files (or downloads it). Exports of every
// shell, MCP-triggered exports and project saves call `download`, so they all go through it. `save` hands a ticket to
// the caller, which delivers it from its own button (Halo's Share).
//
// The ticket code (`./saveTicket`) and the prompt are lazy chunks: a desktop page that only downloads never loads them.
import type { FileService } from '@ekza-studio/editor-core';
import { isIosWebKit } from './fileTypes';
import type * as Tickets from './saveTicket';
import type { SaveFile, SavePlatform, SaveQueue, SaveTicket } from './saveTicket';

export interface DownloadRecord {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** The FileService with tickets (the contract's additive `save`, §20.4). */
export interface BrowserFileService extends FileService {
  /** A ticket for `file`; it leaves the page when the caller delivers it (from a tap on iOS). */
  save(file: SaveFile): SaveTicket;
}

type TicketModule = typeof Tickets;

export interface DownloadServiceOptions {
  /** Default: the browser's (share on iOS WebKit, download elsewhere). */
  readonly platform?: SavePlatform;
  /** Default: the page's save queue. */
  readonly queue?: SaveQueue;
  /** Shows a save prompt for `queue` when a ticket waits and none is attached (default: the host's lazy one). */
  readonly showPrompt?: (queue: SaveQueue) => Promise<void>;
  /** Loads the ticket code (default: the lazy chunk). */
  readonly loadTickets?: () => Promise<TicketModule>;
}

/** Exactly `bytes` over an ArrayBuffer (a Blob part cannot be a view of a SharedArrayBuffer). */
export function blobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
}

/** Downloads `bytes` through a temporary object URL and a hidden `<a download>`. */
export function anchorDownload(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([blobPart(bytes)], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers read the URL after click() returns; revoke once the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** True where files leave through the share sheet: iOS WebKit with Web Share (`canShare` checks each file). */
export function sharePreferred(): boolean {
  // Web Share is missing in some browsers whatever lib.dom says.
  const nav =
    typeof navigator === 'undefined' ? undefined : (navigator as Partial<Pick<Navigator, 'share' | 'canShare'>>);
  return typeof nav?.share === 'function' && typeof nav.canShare === 'function' && isIosWebKit();
}

/** A ticket whose code arrives with it: 'preparing' until the ticket chunk and the bytes are both there. */
function lazyTicket(file: SaveFile, real: Promise<SaveTicket>): SaveTicket {
  let ticket: SaveTicket | null = null;
  let failed = false;
  const listeners = new Map<() => void, (() => void) | null>();
  const ready = real.then(
    (loaded) => {
      ticket = loaded;
      for (const listener of listeners.keys()) {
        listeners.set(listener, loaded.subscribe(listener));
        if (loaded.state !== 'preparing') listener();
      }
      return loaded.ready;
    },
    (error: unknown) => {
      failed = true;
      for (const listener of listeners.keys()) listener();
      throw error;
    },
  );
  ready.catch(() => {});
  return {
    fileName: file.name,
    mime: file.mime,
    get state() {
      return ticket?.state ?? (failed ? 'failed' : 'preparing');
    },
    ready,
    get delivered() {
      return ticket?.delivered ?? null;
    },
    deliver: () => (ticket === null ? ready.then(() => (ticket as SaveTicket).deliver()) : ticket.deliver()),
    subscribe(listener) {
      listeners.set(listener, ticket?.subscribe(listener) ?? null);
      return () => {
        listeners.get(listener)?.();
        listeners.delete(listener);
      };
    },
  };
}

const showHostPrompt = (queue: SaveQueue): Promise<void> =>
  import('../host/SavePrompt').then((m) => m.mountSavePrompt(queue));

/** True for a FileService that hands out tickets. */
export function hasSaveTickets(files: FileService): files is BrowserFileService {
  return typeof (files as Partial<BrowserFileService>).save === 'function';
}

/** `onDownload` sees every file once its bytes are there (the e2e test API records the last export through it). */
export function createDownloadService(
  onDownload?: (record: DownloadRecord) => void,
  opts: DownloadServiceOptions = {},
): BrowserFileService {
  // The share half of the platform comes with the ticket chunk; a desktop page needs only these two.
  const { platform: given } = opts;
  const prefersShare = given === undefined ? sharePreferred : () => given.prefersShare();
  const plainDownload =
    given === undefined
      ? anchorDownload
      : (name: string, bytes: Uint8Array, mime: string) => given.download(name, bytes, mime);
  const showPrompt = opts.showPrompt ?? showHostPrompt;
  const load = opts.loadTickets ?? (() => import('./saveTicket'));
  const loadTickets = (): Promise<{ readonly tickets: TicketModule; readonly platform: SavePlatform }> =>
    load().then((tickets) => ({ tickets, platform: opts.platform ?? tickets.browserSavePlatform() }));
  return {
    download(fileName: string, bytes: Uint8Array, mime: string): void {
      onDownload?.({ fileName, bytes, mime });
      if (!prefersShare()) {
        plainDownload(fileName, bytes, mime);
        return;
      }
      // iOS: the file waits for a tap on the page's save prompt. Without a prompt (its chunk or the ticket's failed
      // to load) it would wait for a tap that cannot come, so it downloads instead.
      let queued: { readonly queue: SaveQueue; readonly ticket: SaveTicket } | null = null;
      loadTickets()
        .then(({ tickets, platform }) => {
          const queue = opts.queue ?? tickets.pageSaveQueue();
          const ticket = tickets.createSaveTicket({ name: fileName, mime, bytes }, platform);
          queue.offer(ticket);
          queued = { queue, ticket };
          return queue.attached > 0 ? undefined : showPrompt(queue);
        })
        .catch((error: unknown) => {
          console.error('Ekza Studio: the save prompt could not be shown', error);
          if (queued !== null) {
            if (!queued.queue.tickets.includes(queued.ticket)) return;
            queued.queue.dismiss(queued.ticket);
          }
          plainDownload(fileName, bytes, mime);
        });
    },
    save(file: SaveFile): SaveTicket {
      const onBytes = (bytes: Uint8Array): void => onDownload?.({ fileName: file.name, bytes, mime: file.mime });
      return lazyTicket(
        file,
        loadTickets().then(({ tickets, platform }) => tickets.createSaveTicket(file, platform, { onBytes })),
      );
    },
  };
}
