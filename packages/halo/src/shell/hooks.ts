// React readers of the app the Halo shell renders from (a selector must return a primitive or a stable reference).
import type { EditorApp, SessionState } from '@ekza-studio/editor-core';
import type { HostShell } from '@ekza-studio/editor/host';
import type { ViewportManager } from '@ekza-studio/viewport';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** A slice of the session (`Object.is`-stable selectors only). */
export function useSessionValue<T>(app: EditorApp, select: (state: SessionState) => T): T {
  return useSyncExternalStore(
    (listener) => app.session.subscribe(listener),
    () => select(app.session.getState()),
    () => select(app.session.getState()),
  );
}

/** A counter that changes with the document (records changed) and the history. */
export function useDocumentVersion(app: EditorApp): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const offStore = app.store.subscribe(bump);
    const offHistory = app.history.subscribe(bump);
    return () => {
      offStore();
      offHistory();
    };
  }, [app]);
  return version;
}

/** The frame's size, kept current by a ResizeObserver (container queries in JS for the size classes, §4.6). */
export function useElementSize(el: HTMLElement | null): { readonly width: number; readonly height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (el === null) return undefined;
    const read = (): void =>
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

/** §4.6 size classes by container width: Wide ≥ 1024, Regular 700–1023, Compact < 700 (never the user agent). */
export type SizeClass = 'wide' | 'regular' | 'compact';
export const sizeClassOf = (width: number): SizeClass =>
  width >= 1024 ? 'wide' : width >= 700 ? 'regular' : 'compact';

/** The page's viewport manager (null until the GL host made it). */
export function useViewport(host: HostShell): ViewportManager | null {
  return useSyncExternalStore(
    (listener) => host.ui.subscribe(listener),
    () => host.ui.getState().viewport,
    () => host.ui.getState().viewport,
  );
}
