// Built-in importers (ADR 0008 importer registry): models (`.glb`, `.vrm`), animation-only `.glb` and VRMA clips, and
// projects. Each names the operator that receives `{ name, bytes }`; `file.open` and the shell's drop handler dispatch
// through them, sniffing the content where two importers claim `.glb`.
import type { ImporterDef, Registry } from '../../types';
import { isAnimationOnlyGlb } from '../../workflows/importAnimation';

export const BUILTIN_IMPORTERS: readonly ImporterDef[] = [
  {
    id: 'gltf-model',
    label: 'glTF / VRM model',
    extensions: ['glb', 'vrm'],
    op: 'file.importModel',
    sniff: (_name, bytes) => !isAnimationOnlyGlb(bytes),
  },
  {
    // M1-stretch (FR-IO-10): a .glb with animations and no skin adds clips to the active character.
    id: 'gltf-animation',
    label: 'Animation-only glTF',
    extensions: ['glb'],
    op: 'file.importAnimation',
    sniff: (_name, bytes) => isAnimationOnlyGlb(bytes),
  },
  { id: 'vrma', label: 'VRM animation', extensions: ['vrma'], op: 'file.importAnimation' },
  { id: 'ekzanim', label: 'Ekza Animator project', extensions: ['ekzanim', 'ekzanim.json'], op: 'file.openProject' },
];

function matches(name: string, extension: string): boolean {
  return name.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
}

/**
 * The importer for a file: the longest matching extension wins (`.ekzanim.json` over `.json`); when several
 * importers claim it, the first whose `sniff` accepts the bytes, else one without a sniffer.
 */
export function resolveImporter(importers: Registry<ImporterDef>, name: string, bytes: Uint8Array): ImporterDef | null {
  let best = -1;
  let candidates: ImporterDef[] = [];
  for (const importer of importers.list()) {
    for (const extension of importer.extensions) {
      if (!matches(name, extension)) continue;
      if (extension.length > best) {
        best = extension.length;
        candidates = [importer];
      } else if (extension.length === best && !candidates.includes(importer)) {
        candidates.push(importer);
      }
    }
  }
  if (candidates.length <= 1) return candidates[0] ?? null;
  for (const importer of candidates) {
    try {
      if (importer.sniff?.(name, bytes) === true) return importer;
    } catch {
      // A failing sniffer does not claim the file.
    }
  }
  return candidates.find((importer) => importer.sniff === undefined) ?? null;
}
