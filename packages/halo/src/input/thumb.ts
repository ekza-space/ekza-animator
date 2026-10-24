// The Thumb key's controller (STUDIO-TOUCH-SPEC §5.5, §20.3 item 3): what it means now (`modifierMap`), its latch
// (the kit's reducer, in the shell's store) and the virtual modifiers it feeds the viewport
// (`ViewportManager.setModifierSource`). Meanings are split by gesture class: the arbiter's tap path asks for the tap
// meaning's modifiers right before the tool's click, a press that may become a drag for the drag meaning's. A `once`
// latch is used up by the next tap or drag; a hold lasts while the thumb is down; a lock until tapped again. A latched
// hold is handed again to a tool activated meanwhile (T1: the new tool gets the up and the down).
import type { EditorApp } from '@ekza-studio/editor-core';
import { thumbReduce } from '@ekza-studio/ui/touch';
import { createModifierSource, type ModifierSource, NO_MODIFIERS, type VirtualModifiers } from '@ekza-studio/viewport';
import type { HaloStore } from '../shell/store';
import { type Meaning, modsOf } from './modifierMap';
import { currentRow, meaningsOf } from './situation';

export interface ThumbController {
  readonly source: ModifierSource;
  /** The tap meaning's modifiers (the arbiter's tap, a mouse click). */
  forTap(): void;
  /** The drag meaning's modifiers (a buffered press that may become a drag). */
  forDrag(): void;
  /** The next tap or drag used the meaning (`once` turns off, `held` is used). */
  consume(): void;
  dispose(): void;
}

export function createThumbController(app: EditorApp, store: HaloStore): ThumbController {
  const source = createModifierSource();
  let gesture: 'tap' | 'drag' = 'tap';

  const apply = (): void => {
    const latch = store.get().thumb.latch;
    const row = currentRow(app, store);
    let next: VirtualModifiers = NO_MODIFIERS;
    if (latch !== 'off' && row !== null) {
      const meanings = meaningsOf(row, store.get().thumbPick);
      const meaning: Meaning | undefined = gesture === 'tap' ? meanings.tap : meanings.drag;
      next = modsOf(meaning);
    }
    const current = source.get();
    const same =
      current.shift === next.shift &&
      current.mod === next.mod &&
      current.alt === next.alt &&
      current.button === next.button &&
      current.held.size === next.held.size &&
      [...current.held].every((code) => next.held.has(code));
    if (!same) source.set(next);
  };

  const offStore = store.subscribe((next, previous) => {
    if (
      next.thumb !== previous.thumb ||
      next.thumbPick !== previous.thumbPick ||
      next.stage !== previous.stage ||
      next.sheet !== previous.sheet
    )
      apply();
  });
  let tool = app.session.getState().tools.viewport;
  const offSession = app.session.subscribe((state) => {
    if (state.tools.viewport !== tool) {
      tool = state.tools.viewport;
      // a latched hold reaches the tool activated meanwhile: release it, then hold it again (T1 note)
      const held = source.get();
      if (held.held.size > 0) {
        source.set({ ...held, held: new Set() });
        source.set(held);
      }
    }
    apply();
  });

  return {
    source,
    forTap() {
      gesture = 'tap';
      apply();
    },
    forDrag() {
      gesture = 'drag';
      apply();
    },
    consume() {
      const thumb = store.get().thumb;
      if (thumb.latch === 'off' || thumb.latch === 'locked') return;
      store.set({ thumb: thumbReduce(thumb, { type: 'consume' }) });
    },
    dispose() {
      offStore();
      offSession();
      source.set(NO_MODIFIERS);
    },
  };
}
