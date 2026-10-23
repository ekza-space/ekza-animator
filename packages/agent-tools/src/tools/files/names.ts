// File names of the file tools (MCP-SPEC §5.17.3 "Derived file names", §5.18), shared by the tab, the headless host
// and the server's re-validation of tab writes (§5.10): names built from document strings are sanitised to
// `[A-Za-z0-9 _.-]`, separators and leading dots removed, reserved device names prefixed with `_`, the stem cut to 64
// characters, and the extension forced to the tool's kind.

/** Readable kinds (§5.17.3). */
export const READ_EXTENSIONS = ['.ekzanim', '.ekzanim.json', '.vrm', '.glb', '.vrma'] as const;
/** Writable kinds (`.zip`: the OMOBA local test kit of `project_export {kind: 'omoba_kit'}`, MCP-SPEC §0.4.4). */
export const WRITE_EXTENSIONS = ['.ekzanim', '.ekzanim.json', '.vrma', '.glb', '.vrm', '.zip'] as const;
/** Exports default to `exports/<fileName>` (§5.17.3). */
export const EXPORTS_DIR = 'exports';
/** Derived names: the stem is cut to this many characters before the extension. */
export const DERIVED_STEM_MAX = 64;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** The extension of a file name in the allow-list form (`.ekzanim.json` before `.json`), lower case; '' when none. */
export function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ekzanim.json')) return '.ekzanim.json';
  const base = lower.split(/[\\/]/).pop() ?? lower;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/** True for a reserved Windows device name (`CON`, `nul.txt`, `COM1`). */
export function isReservedName(name: string): boolean {
  return RESERVED.test(name);
}

/** A safe file name derived from a document string, with the extension forced (§5.17.3). */
export function deriveFileName(name: string, extension: string): string {
  let stem = name.split(/[\\/]/).pop() ?? '';
  const lower = stem.toLowerCase();
  for (const ext of [extension, ...WRITE_EXTENSIONS, '.json']) {
    if (ext !== '' && lower.endsWith(ext)) {
      stem = stem.slice(0, -ext.length);
      break;
    }
  }
  stem = stem
    .normalize('NFC')
    .replace(/[^A-Za-z0-9 _.-]/g, '_')
    .replace(/^[.\s]+/, '')
    .slice(0, DERIVED_STEM_MAX)
    .replace(/[ .]+$/, '');
  if (stem === '') stem = 'untitled';
  if (isReservedName(stem)) stem = `_${stem}`;
  return `${stem}${extension}`;
}

/** The base name of a workspace path (`exports/wave.vrma` → `wave.vrma`). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
