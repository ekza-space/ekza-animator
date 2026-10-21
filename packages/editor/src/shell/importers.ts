// Importer resolution for opened and dropped files (ADR 0008 importer registry): by extension (longest match, so
// `.ekzanim.json` beats `.json`), then content sniffing when several importers claim the extension.
import type { ImporterDef, Registry } from '@ekza-studio/editor-core';

export function extensionMatch(name: string, extension: string): boolean {
  return name.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
}

/** The importers whose longest matching extension claims `name` (several only when content sniffing decides). */
export function importerCandidates(importers: Registry<ImporterDef>, name: string): ImporterDef[] {
  let bestLength = -1;
  let candidates: ImporterDef[] = [];
  for (const importer of importers.list()) {
    for (const extension of importer.extensions) {
      if (!extensionMatch(name, extension)) continue;
      if (extension.length > bestLength) {
        bestLength = extension.length;
        candidates = [importer];
      } else if (extension.length === bestLength && !candidates.includes(importer)) {
        candidates.push(importer);
      }
    }
  }
  return candidates;
}

export function resolveImporter(importers: Registry<ImporterDef>, name: string, bytes: Uint8Array): ImporterDef | null {
  const candidates = importerCandidates(importers, name);
  if (candidates.length <= 1) return candidates[0] ?? null;
  for (const importer of candidates) {
    try {
      if (importer.sniff?.(name, bytes) === true) return importer;
    } catch {
      // A failing sniffer does not claim the file.
    }
  }
  return candidates.find((importer) => importer.sniff === undefined) ?? candidates[0] ?? null;
}

/** All extensions the registered importers accept, for the file picker's `accept` attribute. */
export function acceptAttribute(importers: Registry<ImporterDef>): string {
  const extensions = new Set<string>();
  for (const importer of importers.list())
    for (const ext of importer.extensions) extensions.add(`.${ext.toLowerCase()}`);
  return [...extensions].sort().join(',');
}

/** The import options dialog is shown for model importers (glTF / VRM) unless the caller asks for an automatic import. */
export const MODEL_IMPORT_OP = 'file.importModel';
export const PROJECT_OPEN_OP = 'file.openProject';

/**
 * Where a dropped or picked file goes in the open order: projects first (they replace the document), then models,
 * then everything else (animations need the character), then files no importer claims. Decided by name alone, so the
 * files can be read one at a time; an extension several importers share ranks as its earliest claimant.
 */
export function openOrderRank(importers: Registry<ImporterDef>, name: string): number {
  const candidates = importerCandidates(importers, name);
  if (candidates.length === 0) return 3;
  return Math.min(
    ...candidates.map((importer) => (importer.op === PROJECT_OPEN_OP ? 0 : importer.op === MODEL_IMPORT_OP ? 1 : 2)),
  );
}
