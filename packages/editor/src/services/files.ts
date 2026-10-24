// The browser's FileService (MVP-SPEC §4.5; STUDIO-TOUCH-SPEC S9, §20.4): `download` and `save`. Everywhere but iOS
// a download is immediate, through a temporary object URL. On iOS WebKit the tap that asked for a file (an export, a
// project) has lost its user activation by the time the bytes are ready, so `download` turns into a SaveTicket that
// waits for the page's save prompt; a fresh tap there shares the file to Files (or downloads it). Exports of every
// shell, MCP-triggered exports and project saves call `download`, so they all go through it. `save` hands the ticket
// to the caller, which delivers it from its own button (Halo's Share sheet).
import type { FileService } from '@ekza-studio/editor-core';
import { isIosWebKit } from './fileTypes';
import {
  browserSavePlatform,
  createSaveTicket,
  pageSaveQueue,
  type SaveFile,
  type SavePlatform,
  type SaveQueue,
  type SaveTicket,
} from './saveTicket';

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

export interface DownloadServiceOptions {
  /** Default: the browser's (share on iOS WebKit, download elsewhere). */
  readonly platform?: SavePlatform;
  /** Default: the page's save queue. */
  readonly queue?: SaveQueue;
  /** Shows a save prompt for `queue` when a ticket waits and none is attached (default: the host's lazy one). */
  readonly showPrompt?: (queue: SaveQueue) => Promise<void>;
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
  const platform = opts.platform ?? browserSavePlatform(() => isIosWebKit());
  const queue = opts.queue ?? pageSaveQueue();
  const showPrompt = opts.showPrompt ?? showHostPrompt;
  return {
    download(fileName: string, bytes: Uint8Array, mime: string): void {
      onDownload?.({ fileName, bytes, mime });
      if (!platform.prefersShare()) {
        platform.download(fileName, bytes, mime);
        return;
      }
      const ticket = createSaveTicket({ name: fileName, mime, bytes }, platform);
      queue.offer(ticket);
      if (queue.attached > 0) return;
      // Without a prompt the file would wait for a tap that cannot come: it downloads instead.
      showPrompt(queue).catch((error: unknown) => {
        console.error('Ekza Studio: the save prompt could not be shown', error);
        if (!queue.tickets.includes(ticket)) return;
        queue.dismiss(ticket);
        platform.download(fileName, bytes, mime);
      });
    },
    save(file: SaveFile): SaveTicket {
      return createSaveTicket(file, platform, {
        onBytes: (bytes) => onDownload?.({ fileName: file.name, bytes, mime: file.mime }),
      });
    },
  };
}
