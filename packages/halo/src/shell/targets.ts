// The visible-target counter (STUDIO-TOUCH-SPEC §4.8, ST-37, AS-ST-17): the interactive targets a user sees at L0 —
// buttons, tabs, segments, menu items, sliders (chips), toggles and links — inside the shell, on screen, not hidden,
// not faded out, not inert (the verb bar's invisible measuring copy, a closed sheet). The budget on an iPad landscape
// container is ≤ 22 at rest and ≤ 36 with a Halo open; the test API reports the count (`halo().visibleTargets`).

export const TARGET_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
].join(',');

/** Visible budgets of §4.8 (iPad landscape). */
export const TARGET_BUDGET = { rest: 22, halo: 36 } as const;

interface Measurable {
  closest(selector: string): Element | null;
  getBoundingClientRect(): {
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

/** Whether one element counts as a visible target in a viewport of the given size. */
export function visibleTarget(
  el: Measurable,
  style: (el: Element) => { readonly visibility: string; readonly opacity: string; readonly display: string },
  viewport: { readonly width: number; readonly height: number },
): boolean {
  if (el.closest('[inert],[aria-hidden="true"],[hidden],[data-halo-uncounted]') !== null) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= viewport.width || r.top >= viewport.height) return false;
  // walk up for visibility, display and opacity (a faded cluster ignores touches too, §4.7)
  let node: Element | null = el as unknown as Element;
  while (node !== null) {
    const s = style(node);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    node = node.parentElement;
  }
  return true;
}

/** Counts the visible targets under `root` (a nested target, e.g. a button inside a menu item, counts once). */
export function countVisibleTargets(root: ParentNode | null): number {
  if (root === null || typeof window === 'undefined') return 0;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const style = (el: Element) => window.getComputedStyle(el);
  let count = 0;
  for (const el of root.querySelectorAll(TARGET_SELECTOR)) {
    if (
      el.parentElement?.closest(TARGET_SELECTOR) !== null &&
      root.contains(el.parentElement?.closest(TARGET_SELECTOR) ?? null)
    )
      continue;
    if (visibleTarget(el, style, viewport)) count += 1;
  }
  return count;
}
