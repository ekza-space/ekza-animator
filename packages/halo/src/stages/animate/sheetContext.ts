// The Thread's nouns in the T6b shape (STUDIO-TOUCH-SPEC §6.2; T7): an animation, a key dot, the band, the playhead —
// nouns the grammar's selection resolver does not see. The frame opens More and Numbers over them through its sheet
// slot (`sheetNoun`).
import type { NounKind } from '../../manifest/types';
import type { Noun } from '../../verbs/nouns';

/** A noun of the Thread or the Animations row. */
export function threadNoun(kind: NounKind, id: string | null, label: string, character: string | null): Noun {
  return { kind, id, ids: id === null ? [] : [id], label, count: 1, character };
}
