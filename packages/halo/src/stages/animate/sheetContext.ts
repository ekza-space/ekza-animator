// What a sheet gets from the Animate stage (STUDIO-TOUCH-SPEC §20.2, the T6b sheet contract `HaloSheetContext`): the
// host, the stage, the noun the sheet is about (an animation, a key dot, the band, the playhead — the Thread's nouns
// that the grammar's selection resolver does not see), the destination, where sheets dock, and one way to run an
// operator. Built from the shell's controller; the Library sheet and a docked noun's ⋯ More render through it.
import type { HaloSheetContext } from '../../manifest/sheets';
import type { NounKind } from '../../manifest/types';
import type { DestinationId } from '../../path/destinations';
import type { HaloController } from '../../shell/controller';
import type { Noun } from '../../verbs/nouns';

/** A noun of the Thread or the Animations row, in the T6b shape. */
export function threadNoun(kind: NounKind, id: string | null, label: string, character: string | null): Noun {
  return { kind, id, ids: id === null ? [] : [id], label, count: 1, character };
}

export function sheetContextOf(
  controller: HaloController,
  noun: Noun | null,
  side: 'right' | 'bottom',
  close: () => void,
): HaloSheetContext & { readonly touch: () => void } {
  const { ctx } = controller;
  const { store } = ctx;
  return {
    host: ctx.host,
    stage: store.get().stage,
    noun,
    destination: store.get().destination as DestinationId,
    side,
    close,
    open: (sheet) => store.set({ sheet, halo: null }),
    setStage: (stage) => void controller.enterStage(stage),
    setDestination: (destination) => store.set({ destination }),
    run: (op, args) => ctx.run(op, args),
    openPro: () => controller.proLayout(true),
    hideUi: () => store.set({ hideUi: true, sheet: null, halo: null }),
    // the journeys' touch counter (§9; P-T7-2 proposes it for the sheet contract)
    touch: () => store.set((s) => ({ touches: s.touches + 1 })),
  };
}
