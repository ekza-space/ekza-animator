// File types on every platform (STUDIO-TOUCH-SPEC S10, S12, §20.3 item 15; ST-21): what a picked or dropped file
// is, read from its bytes (`sniffFileKind`), the name it opens under (`nameForKind`), and the file pickers' `accept`
// policy (`pickerAccept`). The Files picker of iPadOS greys out files whose type it cannot map from a custom
// extension (WebKit 190982): `.vrm`, `.vrma` and `.ekzanim` could not be picked. iOS pickers therefore get no
// `accept` at all and the bytes decide; anything that is not glTF, a project or JSON gets a plain error.
//
// `isIosWebKit` is the device class the platform services share (pickers, the save prompt, the memory profile,
// autosave): iPhone and iPad user agents, and a "Macintosh" that reports touch points — iPadOS Safari asks for the
// desktop site and reports MacIntel (S15), while real Macs report none. Input routing never uses it (§5.1).

/** What a file is by content. `project` is the `.ekzanim` zip, `projectJson` its `.ekzanim.json` debug variant. */
export type FileKind = 'vrm' | 'vrma' | 'glb' | 'gltf' | 'project' | 'projectJson' | 'zip' | 'json' | 'unknown';

/** The extension a file of each kind opens under (the importers resolve by name); null: no importer takes it. */
export const KIND_EXTENSION: Readonly<Record<FileKind, string | null>> = {
  vrm: 'vrm',
  vrma: 'vrma',
  glb: 'glb',
  gltf: 'gltf',
  project: 'ekzanim',
  projectJson: 'ekzanim.json',
  zip: null,
  json: null,
  unknown: null,
};

/** Extensions a name may already carry for each kind (the importer of the first one also takes the others). */
const COMPATIBLE: Readonly<Record<FileKind, readonly string[]>> = {
  vrm: ['vrm', 'glb'],
  vrma: ['vrma', 'glb'],
  glb: ['glb', 'vrm'],
  gltf: ['gltf'],
  project: ['ekzanim'],
  projectJson: ['ekzanim.json', 'json'],
  zip: [],
  json: [],
  unknown: [],
};

/** Every extension `nameForKind` recognises at the end of a name, longest first. */
const KNOWN_EXTENSIONS = ['ekzanim.json', 'ekzanim', 'gltf', 'vrma', 'json', 'glb', 'vrm', 'zip', 'bin'];

/** The plain error for a file that is none of the kinds Ekza Studio opens. */
export const UNSUPPORTED_FILE_TEXT =
  'This file is not a 3D model or an Ekza Studio project. Open a .glb, .vrm, .vrma or .ekzanim file.';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
/** Larger JSON files are classified from their first bytes instead of a full parse. */
const JSON_PARSE_LIMIT = 32 * 1024 * 1024;
const PROJECT_MANIFEST = 'manifest.json';
const DOC_FORMAT = 'ekza-animator-doc';

/** The JSON chunk of a GLB as an object, or null when it is unreadable. */
function glbJson(bytes: Uint8Array, view: DataView): Readonly<Record<string, unknown>> | null {
  if (bytes.byteLength < 20 || view.getUint32(16, true) !== JSON_CHUNK) return null;
  const length = view.getUint32(12, true);
  if (length > bytes.byteLength - 20) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    return isRecord(json) ? json : null;
  } catch {
    return null;
  }
}

function usesExtension(json: Readonly<Record<string, unknown>>, name: string): boolean {
  const declared = json['extensions'];
  const used = json['extensionsUsed'];
  return (isRecord(declared) && name in declared) || (Array.isArray(used) && used.includes(name));
}

/** The kind of a GLB: a VRM animation, a VRM (0.x or 1.0) or any other glTF binary. */
function glbKind(bytes: Uint8Array, view: DataView): FileKind {
  const json = glbJson(bytes, view);
  if (json === null) return 'glb';
  if (usesExtension(json, 'VRMC_vrm_animation')) return 'vrma';
  if (usesExtension(json, 'VRMC_vrm') || usesExtension(json, 'VRM')) return 'vrm';
  return 'glb';
}

/** A zip whose first entry is `manifest.json` is a project (`io/project/archive.ts` writes it first). */
function zipKind(bytes: Uint8Array, view: DataView): FileKind {
  if (bytes.byteLength < 30) return 'zip';
  const nameLength = view.getUint16(26, true);
  const extraStart = 30 + nameLength;
  if (extraStart > bytes.byteLength) return 'zip';
  const name = new TextDecoder().decode(bytes.subarray(30, extraStart));
  return name === PROJECT_MANIFEST ? 'project' : 'zip';
}

function jsonKind(bytes: Uint8Array, start: number): FileKind {
  if (bytes.byteLength - start > JSON_PARSE_LIMIT) {
    const head = new TextDecoder().decode(bytes.subarray(start, start + 65_536));
    if (head.includes(`"${DOC_FORMAT}"`)) return 'projectJson';
    return /"asset"\s*:\s*\{/.test(head) ? 'gltf' : 'json';
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(start)));
  } catch {
    return 'unknown';
  }
  if (!isRecord(json)) return 'json';
  if (json['format'] === DOC_FORMAT) return 'projectJson';
  const asset = json['asset'];
  return isRecord(asset) && typeof asset['version'] === 'string' ? 'gltf' : 'json';
}

/** What `bytes` are, by their content alone (glTF binary and VRM, glTF JSON, project zip or JSON, any zip or JSON). */
export function sniffFileKind(bytes: Uint8Array): FileKind {
  if (bytes.byteLength < 4) return 'unknown';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 12 && view.getUint32(0, true) === GLB_MAGIC) return glbKind(bytes, view);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return zipKind(bytes, view);
  let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0; // a UTF-8 byte order mark
  while (start < bytes.byteLength && isSpace(bytes[start] as number)) start++;
  return bytes[start] === 0x7b ? jsonKind(bytes, start) : 'unknown';
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** The known extension at the end of `name` (lower case, longest match), or null. */
function knownExtension(name: string): string | null {
  const lower = name.toLowerCase();
  return KNOWN_EXTENSIONS.find((extension) => lower.endsWith(`.${extension}`)) ?? null;
}

/**
 * The name a file of `kind` opens under: `name` itself when its extension already suits the kind (or the kind has no
 * importer), else the name with the kind's extension in place of a known one (`scan.bin` → `scan.vrm`) or added
 * (`Polybot` → `Polybot.vrm`). The importers resolve by name, so a sniffed file reaches the right one.
 */
export function nameForKind(name: string, kind: FileKind): string {
  const extension = KIND_EXTENSION[kind];
  if (extension === null) return name;
  const current = knownExtension(name);
  if (current !== null && COMPATIBLE[kind].includes(current)) return name;
  const stem = current === null ? name : name.slice(0, name.length - current.length - 1);
  return `${stem === '' ? 'file' : stem}.${extension}`;
}

/** What `isIosWebKit` reads of `navigator`. */
export interface PlatformProbe {
  readonly userAgent: string;
  readonly maxTouchPoints?: number;
}

function currentNavigator(): PlatformProbe | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** True on iPhone and iPad (every browser there is WebKit), including iPadOS Safari's desktop user agent (S15). */
export function isIosWebKit(probe: PlatformProbe | undefined = currentNavigator()): boolean {
  if (probe === undefined) return false;
  const agent = probe.userAgent;
  if (/\b(iPad|iPhone|iPod)\b/.test(agent)) return true;
  return /\bMacintosh\b/.test(agent) && (probe.maxTouchPoints ?? 0) > 1;
}

/**
 * The `accept` attribute of a file picker: the given list everywhere but iOS, where it is left out (undefined) so
 * that `.vrm`, `.vrma` and `.ekzanim` can be picked; the opened bytes are sniffed instead (S10).
 */
export function pickerAccept(accept: string, probe?: PlatformProbe): string | undefined {
  return isIosWebKit(probe) ? undefined : accept;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
