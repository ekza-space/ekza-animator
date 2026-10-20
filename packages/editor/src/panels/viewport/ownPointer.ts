// B13's interactive pane overlay cards (the Model start card, Getting started; lazy chunks) keep their presses.
import { type RefObject, useEffect } from 'react';

/**
 * Keeps presses on an interactive overlay card to the card: the pane's surface takes every native `pointerdown`
 * (navigation, picking, pointer capture, which would retarget the click), and React's handlers run too late to stop
 * it, so the card stops the native event itself (as B11's Last-op card does).
 */
export function useOwnPointer(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const stop = (event: Event): void => event.stopPropagation();
    element.addEventListener('pointerdown', stop);
    element.addEventListener('wheel', stop, { passive: true });
    return () => {
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('wheel', stop);
    };
  }, [ref]);
}
