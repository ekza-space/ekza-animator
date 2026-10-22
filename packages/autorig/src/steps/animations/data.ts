// ④ Animations data (AUTORIG-SPEC §5.5.1, §5.5.4; D5): the category table and the search synonyms over the starter
// pack's ids (unknown ids fall into "Other", so a manifest that grows never breaks the grid), the search itself, the
// Ekza slot vocabulary (ADR 0010 §5, the list Studio's clip settings offer) and the reader of the `ar-*` clip tags
// that `library.useClip` writes (editor-core `library/params.ts`; the same examples pin both in their tests). Pure.
import type { ClipParams } from '../../types';

export type ClipCategory = 'move' | 'combat' | 'react' | 'fun' | 'other';

/** The filter chips in order (`all` first). */
export const CATEGORIES: readonly ('all' | ClipCategory)[] = ['all', 'move', 'combat', 'react', 'fun', 'other'];

const BY_ID: Readonly<Record<string, ClipCategory>> = {
  idle: 'move',
  walk: 'move',
  run: 'move',
  jog: 'move',
  'sword-attack': 'combat',
  punch: 'combat',
  cast: 'combat',
  'pistol-shoot': 'combat',
  hit: 'react',
  death: 'react',
  dance: 'fun',
};

/** The category of a library clip id (§5.5.1): the table, `jump-*` is Move, everything else Other. */
export function categoryOf(id: string): ClipCategory {
  return BY_ID[id] ?? (id.startsWith('jump-') ? 'move' : 'other');
}

/** Search synonyms (§5.5.1): a typed word also matches these words. i18n-ready: English words for v1. */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  attack: ['sword', 'punch'],
  stand: ['idle'],
  rest: ['idle'],
  shoot: ['pistol'],
  gun: ['pistol'],
  fight: ['sword', 'punch'],
  magic: ['cast'],
  spell: ['cast'],
  die: ['death'],
  dead: ['death'],
  hurt: ['hit'],
  sprint: ['run'],
  hop: ['jump'],
  party: ['dance'],
};

/** What the search looks at for one clip: its label, id and source name. */
export interface SearchableClip {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

/**
 * Whether a clip matches the query (§5.5.1): every word of the query (case-insensitive) is a substring of the label,
 * the id or the source name, or one of its synonyms is. An empty query matches everything.
 */
export function matchesQuery(clip: SearchableClip, query: string): boolean {
  const haystack = `${clip.label} ${clip.id} ${clip.source}`.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  return words.every((word) => {
    if (haystack.includes(word)) return true;
    return Object.entries(SYNONYMS).some(
      ([key, alternatives]) => key.startsWith(word) && alternatives.some((alt) => haystack.includes(alt)),
    );
  });
}

/** The clips of a manifest a filter and a query keep, in manifest order. */
export function filterClips<T extends SearchableClip>(
  clips: readonly T[],
  category: 'all' | ClipCategory,
  query: string,
): T[] {
  return clips.filter((clip) => (category === 'all' || categoryOf(clip.id) === category) && matchesQuery(clip, query));
}

/** Ekza clip slot vocabulary v1 (ADR 0010 §5; Studio's `SLOT_VOCABULARY`); `tpose` is reserved and never offered. */
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

/** The identity parameters (§4.3). */
export const IDENTITY: ClipParams = Object.freeze({ speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 });

/** True for the identity parameters (no trim). */
export const isIdentity = (params: ClipParams): boolean =>
  params.speed === 1 && params.trim === null && !params.mirror && !params.inPlace && params.armSpace === 0;

/**
 * The library clip and the parameters an `ar-*` tag set records (§5.5.4: `ar-<id>`, `ar-speed-<percent>`,
 * `ar-trim-<startMs>-<endMs>`, `ar-mirror`, `ar-inplace`, `ar-arms-<deg>` with `m` for minus); null without `ar-<id>`.
 */
export function paramsFromTags(tags: readonly string[]): { readonly clip: string; readonly params: ClipParams } | null {
  let clip: string | null = null;
  let speed = 1;
  let trim: ClipParams['trim'] = null;
  let mirror = false;
  let inPlace = false;
  let armSpace = 0;
  for (const tag of tags) {
    if (!tag.startsWith('ar-')) continue;
    const body = tag.slice(3);
    const speedTag = /^speed-(\d+)$/.exec(body);
    const trimTag = /^trim-(\d+)-(\d+)$/.exec(body);
    const armsTag = /^arms-(m?)(\d+)$/.exec(body);
    if (speedTag !== null) speed = Number(speedTag[1]) / 100;
    else if (trimTag !== null) trim = { start: Number(trimTag[1]) / 1000, end: Number(trimTag[2]) / 1000 };
    else if (body === 'mirror') mirror = true;
    else if (body === 'inplace') inPlace = true;
    else if (armsTag !== null) armSpace = (armsTag[1] === 'm' ? -1 : 1) * Number(armsTag[2]);
    else if (clip === null) clip = body;
  }
  return clip === null ? null : { clip, params: { speed, trim, mirror, inPlace, armSpace } };
}

/** "×1.2" for a speed other than 1, else null (the row and the preview badge). */
export function speedText(speed: number): string | null {
  return speed === 1 ? null : `×${Number(speed.toFixed(2))}`;
}
