// Clip naming and metadata rules (MVP-SPEC §4.2 `ClipRecord`, ADR 0010 §5): display names are ≤ 64 characters of
// `[A-Za-z0-9 _.-]`, unique per character ignoring case; slots come from vocabulary v1 (`tpose` reserved); tags are
// lowercase `[a-z0-9_-]`, at most 8.

export const CLIP_NAME_MAX = 64;
const CLIP_NAME = /^[A-Za-z0-9 _.-]+$/;

/** Ekza clip slot vocabulary v1 (ADR 0010 §5). */
export const SLOT_VOCABULARY: readonly string[] = [
  'idle',
  'walk',
  'run',
  'attack',
  'cast',
  'death',
  'jump',
  'hit',
  'stagger',
  'crouch',
  'fly',
  'climb',
  'swim',
  'dance',
  'wave',
  'emote',
  'celebrate',
];
export const MAX_TAGS = 8;
const TAG = /^[a-z0-9_-]{1,32}$/;

/** Why `name` is not a valid clip display name, or null. */
export function clipNameProblem(name: unknown): string | null {
  if (typeof name !== 'string') return 'A clip name must be a string';
  const trimmed = name.trim();
  if (trimmed === '') return 'A clip name must not be empty';
  if (name !== trimmed) return 'A clip name must not start or end with a space';
  if (name.length > CLIP_NAME_MAX) return `A clip name has at most ${CLIP_NAME_MAX} characters`;
  if (!CLIP_NAME.test(name)) return 'A clip name may use only letters, digits, spaces and . _ -';
  return null;
}

/** Same name after `trim()`, ignoring case (ADR 0010 `ekza.unique-names`). */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A valid clip name derived from any text (invalid characters become `_`); 'clip' when nothing is left. */
export function sanitizeClipName(raw: string): string {
  const name = raw
    .replace(/[^A-Za-z0-9 _.-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLIP_NAME_MAX)
    .trim();
  return name === '' ? 'clip' : name;
}

/** `base` when free, else `base 2`, `base 3`, … (kept within the length limit). Comparison ignores case. */
export function uniqueName(base: string, taken: Iterable<string>, limit: number = CLIP_NAME_MAX): string {
  const used = new Set<string>();
  for (const name of taken) used.add(nameKey(name));
  if (!used.has(nameKey(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, limit - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** The first free `<prefix><n>` (n = 1, 2, …), e.g. `clip1`. */
export function numberedName(prefix: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(nameKey(name));
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** Why `slot` is not an exportable Ekza slot, or null (null = no slot is always valid). */
export function slotProblem(slot: unknown): string | null {
  if (slot === null) return null;
  if (typeof slot !== 'string') return 'A slot must be a string or null';
  if (slot === 'tpose') return "'tpose' is reserved and never exported";
  if (!SLOT_VOCABULARY.includes(slot)) return `Unknown slot '${slot}' (vocabulary v1: ${SLOT_VOCABULARY.join(', ')})`;
  return null;
}

/** Why `tags` is not a valid tag list, or null. */
export function tagsProblem(tags: unknown): string | null {
  if (!Array.isArray(tags)) return 'Tags must be a list';
  const list = tags as readonly unknown[];
  if (list.length > MAX_TAGS) return `At most ${MAX_TAGS} tags`;
  for (const tag of list) {
    if (typeof tag !== 'string' || !TAG.test(tag)) return `Invalid tag '${String(tag)}' (lowercase a-z 0-9 _ -)`;
  }
  if (new Set(list).size !== list.length) return 'Tags must be unique';
  return null;
}

/**
 * A modelling tool's default object name — common DCC defaults such as `pCube12`, `polySurface3`, `Cube.001`,
 * `Mesh.003`, `Box001`, glTF's unnamed `Mesh 0` — after a namespace prefix (`Tema_lowpoly_v0_14:pCube10`). A model
 * named by one says nothing about itself; its file name does (AR-D10-8).
 */
const GENERIC_NAME =
  /^(?:p(?:cube|sphere|cylinder|cone|plane|torus|pipe|prism|pyramid|helix|disc|platonic)|polysurface|mesh|cube|sphere|uvsphere|icosphere|cylinder|cone|plane|circle|torus|box|object|geometry|geo|shape|node|primitive|default|untitled)(?:[\s._-]*\d+)*$/i;
export function isGenericMeshName(name: string): boolean {
  const leaf = (name.split(':').pop() ?? '').trim();
  return leaf === '' || GENERIC_NAME.test(leaf);
}

/** File name without directories and the given extensions (`seed-san.vrm` → `seed-san`). */
export function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = leaf.toLowerCase().endsWith('.ekzanim.json')
    ? leaf.length - '.ekzanim.json'.length
    : leaf.lastIndexOf('.');
  const base = dot > 0 ? leaf.slice(0, dot) : leaf;
  return base.trim() === '' ? 'untitled' : base.trim();
}

/** Lowercase extension without the dot (`'Seed-San.VRM'` → `'vrm'`), '' when there is none. */
export function extensionOf(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName;
  if (leaf.toLowerCase().endsWith('.ekzanim.json')) return 'ekzanim.json';
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
}
