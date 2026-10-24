// The shell-wide touch policy (STUDIO-TOUCH-SPEC §4.1, §5.3 C10, S13): while a touch shell is mounted the page
// never pinch-zooms, scrolls, pulls to refresh or shows the long-press callout. `html.ekza-touch-policy`
// (styles.css) sets `touch-action`, `overscroll-behavior`, `user-select` and `-webkit-touch-callout` on `html` and
// `body` (text fields and `[data-touch-scroll]` lists keep theirs), and WebKit's `gesturestart` is cancelled so a
// pinch outside the canvas never zooms the page. The returned disposer removes all of it, so Studio Pro on the same
// page zooms and scrolls as before. Installs are counted: the policy stays until the last one is disposed.

export const TOUCH_POLICY_CLASS = 'ekza-touch-policy';

interface PolicyDocument {
  readonly documentElement: { readonly classList: Pick<DOMTokenList, 'add' | 'remove'> };
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: EventListenerOptions): void;
}

const installs = new WeakMap<PolicyDocument, number>();

const cancel = (event: Event): void => {
  event.preventDefault();
};

export function installTouchPolicy(doc: PolicyDocument = document): () => void {
  const count = installs.get(doc) ?? 0;
  installs.set(doc, count + 1);
  if (count === 0) {
    doc.documentElement.classList.add(TOUCH_POLICY_CLASS);
    doc.addEventListener('gesturestart', cancel, { passive: false });
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const left = (installs.get(doc) ?? 1) - 1;
    installs.set(doc, left);
    if (left > 0) return;
    doc.documentElement.classList.remove(TOUCH_POLICY_CLASS);
    doc.removeEventListener('gesturestart', cancel);
  };
}
