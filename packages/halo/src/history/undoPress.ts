// ↶ and its long-press (STUDIO-TOUCH-SPEC §4.1, §4.8, §12.5; P-T6A-4, T10): a tap undoes one step (the toast names it
// and offers Redo); a long-press — a right-click with a mouse — opens the History ribbon, which holds Redo and every
// step. The keyboard's Enter or Space on the button undoes. Each is one counted touch (§9).
import { type LongPressHandlers, useLongPress } from '@ekza-studio/ui/touch';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { HaloController } from '../shell/controller';

export function useUndoPress(
  controller: HaloController,
): LongPressHandlers & { readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void } {
  const { store } = controller.ctx;
  const undo = (): void => {
    store.set((s) => ({ touches: s.touches + 1 }));
    controller.grammar.undo();
  };
  const handlers = useLongPress({
    onTap: undo,
    onLongPress: () =>
      store.set((s) => ({ sheet: 'history', sheetArgs: null, sheetNoun: null, halo: null, touches: s.touches + 1 })),
  });
  return {
    ...handlers,
    // pointers go through the press recogniser; a click without one (Enter, Space) is the keyboard's
    onClick: (event) => {
      if (event.detail === 0) undo();
    },
  };
}
