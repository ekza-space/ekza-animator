// Popover placement for the timeline. The panel is two rows high and its dock clips overflow, so popovers render
// in a portal with fixed positions: above their anchor (the timeline usually sits at the bottom of the window),
// below when there is no room above, always inside the viewport. Nested menus flip sides the same way. Positions
// are written to the element in a layout effect (before paint), so placing never re-renders React.
import { type RefObject, useLayoutEffect } from 'react';

const MARGIN = 4;

/**
 * Places the fixed-position `popover` next to `anchor`: above it when it fits, else below; left-aligned with it and
 * inside the viewport. Render the popover with `visibility: hidden`; this makes it visible once placed. `key`
 * re-places it when it opens again or its content changes size.
 */
export function useAnchoredPlacement(
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  key: unknown,
): void {
  useLayoutEffect(() => {
    const a = anchor.current;
    const p = popover.current;
    if (a === null || p === null) return;
    const view = a.ownerDocument.defaultView;
    const width = view?.innerWidth ?? Number.POSITIVE_INFINITY;
    const height = view?.innerHeight ?? Number.POSITIVE_INFINITY;
    const box = a.getBoundingClientRect();
    const size = p.getBoundingClientRect();
    const above = box.top - MARGIN - size.height;
    const top = above >= MARGIN ? above : Math.min(box.bottom + MARGIN, height - size.height - MARGIN);
    p.style.setProperty('left', `${Math.max(MARGIN, Math.min(box.left, width - size.width - MARGIN))}px`);
    p.style.setProperty('top', `${Math.max(MARGIN, top)}px`);
    p.style.setProperty('visibility', 'visible');
  }, [anchor, popover, key]);
}

/**
 * A nested menu positioned `bottom: 0; left: 100%` against its row: moves it to `top: 0` when it would cross the top
 * of the viewport and to `right: 100%` when it would cross the right edge.
 */
export function useNestedPlacement(popover: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const p = popover.current;
    if (p === null) return;
    const view = p.ownerDocument.defaultView;
    const rect = p.getBoundingClientRect();
    if (rect.top < 0) {
      p.style.setProperty('top', '0');
      p.style.setProperty('bottom', 'auto');
    }
    if (rect.right > (view?.innerWidth ?? rect.right)) {
      p.style.setProperty('left', 'auto');
      p.style.setProperty('right', '100%');
    }
  }, [popover]);
}
