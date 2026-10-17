// Records the last exported file for the e2e test API (`lastExport()`, MVP-SPEC §4.8). Downloads are seen first
// (the export operator downloads before it returns); the operator's artifacts then fill in lints and read-back.
import type { ExportArtifact } from '@ekza-animator/io';
import { sha256Hex } from '../services/assets';
import type { ExportRecorder, LastExport } from './types';

export function createExportRecorder(enabled: boolean): ExportRecorder {
  let last: LastExport | null = null;
  return {
    recordDownload(record): void {
      if (!enabled) return;
      const entry: LastExport = { ...record, sha256: '', lints: [], readBack: null };
      last = entry;
      void sha256Hex(record.bytes).then((sha256) => {
        if (last === entry) last = { ...entry, sha256 };
      });
    },
    recordArtifacts(artifacts: readonly ExportArtifact[]): void {
      if (!enabled) return;
      const artifact = artifacts.at(-1);
      if (artifact === undefined) return;
      last = {
        fileName: artifact.fileName,
        mime: artifact.mime,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        lints: [...artifact.lints],
        readBack: artifact.readBack,
      };
    },
    last: () => last,
  };
}

/** Narrows an operator result value to export artifacts (`file.export` returns `ExportArtifact[]`). */
export function asArtifacts(value: unknown): readonly ExportArtifact[] | null {
  if (!Array.isArray(value)) return null;
  const items = value as unknown[];
  return items.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Partial<ExportArtifact>).fileName === 'string' &&
      (item as Partial<ExportArtifact>).bytes instanceof Uint8Array,
  )
    ? (items as ExportArtifact[])
    : null;
}
