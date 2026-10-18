// File download through a temporary object URL (FileService, MVP-SPEC §4.5).
import type { FileService } from '@ekza-animator/editor-core';

export interface DownloadRecord {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** `onDownload` sees every download (the e2e test API records the last export through it). */
export function createDownloadService(onDownload?: (record: DownloadRecord) => void): FileService {
  return {
    download(fileName: string, bytes: Uint8Array, mime: string): void {
      onDownload?.({ fileName, bytes, mime });
      const part = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
      const url = URL.createObjectURL(new Blob([part], { type: mime }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Some browsers read the URL after click() returns; revoke once the download has started.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  };
}
