// The Library sheet's pure parts (STUDIO-TOUCH-SPEC §10.6, §15.9; T7): the kinds of the starter pack's animations, the
// search (every word of the query in the label, id or source name, or a synonym of it), the parameters a card edits
// (`ClipParams`: speed, trim, swap sides, stay in place, arms out) and the calls a card runs — preview
// (`library.preview`) and Add (`autorig.clip.add`, one Use Clip step, the same call Auto-Rig's ④ makes through
// `editor-core/autorigFlow`) — and the starter set (Idle · Walk · Run, each with its slot).
import type { CharacterId } from '@ekza-studio/doc';
import { type ClipParams, clipAddArgs, IDENTITY_FLOW_CLIP_PARAMS } from '@ekza-studio/editor-core';
import type { OpCall } from '../../stages/animate/model';

export type LibraryKind = 'move' | 'combat' | 'react' | 'fun' | 'other';

/** The filter chips in order (`all` first). */
export const LIBRARY_KINDS: readonly ('all' | LibraryKind)[] = ['all', 'move', 'combat', 'react', 'fun', 'other'];

const BY_ID: Readonly<Record<string, LibraryKind>> = {
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

/** The kind of a library clip id: the table, `jump-*` walks and runs, the rest Other (a growing pack never breaks). */
export function kindOf(id: string): LibraryKind {
  return BY_ID[id] ?? (id.startsWith('jump') ? 'move' : 'other');
}

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  attack: ['sword', 'punch'],
  stand: ['idle'],
  rest: ['idle'],
  shoot: ['pistol'],
  gun: ['pistol'],
  fight: ['sword', 'punch'],
  magic: ['cast'],
  spell: ['cast'],
  die: ['death'],
  hurt: ['hit'],
  sprint: ['run'],
  hop: ['jump'],
  party: ['dance'],
};

export interface SearchableClip {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

export function matches(clip: SearchableClip, query: string): boolean {
  const haystack = `${clip.label} ${clip.id} ${clip.source}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every(
      (word) =>
        haystack.includes(word) ||
        Object.entries(SYNONYMS).some(
          ([key, alts]) => key.startsWith(word) && alts.some((alt) => haystack.includes(alt)),
        ),
    );
}

export function filterLibrary<T extends SearchableClip>(
  clips: readonly T[],
  kind: 'all' | LibraryKind,
  query: string,
): readonly T[] {
  return clips.filter((clip) => (kind === 'all' || kindOf(clip.id) === kind) && matches(clip, query));
}

/** The parameters of a card nobody touched (Use Clip exactly). */
export const IDENTITY_PARAMS: ClipParams = IDENTITY_FLOW_CLIP_PARAMS;

/** *Arms out*'s value when on (degrees of upper-arm abduction, inside the −10…30 range of `ClipParams.armSpace`). */
export const ARMS_OUT_DEG = 15;

/** The trim of two values in seconds on a clip of `duration` (null: the whole clip; undefined: shorter than a frame). */
export function trimOf(start: number, end: number, duration: number): ClipParams['trim'] | undefined {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(0, Math.min(end, duration));
  if (!(e - s >= 1 / 30)) return undefined;
  if (s <= 1e-6 && e >= duration - 1e-3) return null;
  const last = Math.floor(duration * 1000 + 1e-6) / 1000;
  const ms = (value: number): number => Math.min(Math.round(value * 1000) / 1000, last);
  return { start: ms(s), end: ms(e) };
}

/** Tap a card (§10.6): it plays on the character at once, with the card's parameters. */
export function previewCall(character: CharacterId, clip: string, params: ClipParams): OpCall {
  return { op: 'library.preview', args: { character, clip, params } };
}

/** *Add* (§10.6, J5): `autorig.clip.add` with the card's parameters (Use Clip, one undo step). */
export function addCall(character: CharacterId, clip: string, params: ClipParams): OpCall {
  return { op: 'autorig.clip.add', args: clipAddArgs(character, clip, params) };
}

/** The starter set (§10.6): Idle · Walk · Run, each added as it is (its slot comes from the pack). */
export const STARTER_SET = ['idle', 'walk', 'run'] as const;

export function starterCalls(character: CharacterId, available: ReadonlySet<string>): readonly OpCall[] {
  return STARTER_SET.filter((id) => available.has(id)).map((id) => addCall(character, id, IDENTITY_PARAMS));
}

/** "Loop · 1.0 s" / "Once · 0.7 s" (a card's line). */
export function cardLine(loop: boolean, duration: number, words: { loop: string; once: string }): string {
  return `${loop ? words.loop : words.once} · ${duration.toFixed(1)} s`;
}
