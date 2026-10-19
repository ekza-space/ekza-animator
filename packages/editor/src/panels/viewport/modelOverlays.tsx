// B13's pane overlays (M6A-SPEC §8.8, §4.8; eager, small): the Model start card in the `emptyState` slot (an empty
// scene in Model: no character, mesh, group or image plane) and the dismissible Getting started card in the
// `gettingStarted` slot. Each draws in one pane only — the maximized pane, else `pane-persp` (every Model layout has
// it), else the layout's first pane — and its body is a lazy chunk. Registered once per panel registry.
import type { Disposer } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import type { SessionState } from '@ekza-animator/editor-core';
import { LAYOUT_PANES } from '@ekza-animator/viewport';
import { type JSX, type RefObject, useEffect, useSyncExternalStore } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import { type PaneOverlayProps, registerPaneOverlay } from '../../overlays/slots';
import { LazyBody } from '../palette/lazy';

const loadStartCard = () => import('./ModelEmptyState');
const loadGettingStarted = () => import('./GettingStarted');

/** The pane that hosts B13's overlays in the current layout. */
export function overlayPane(state: Pick<SessionState, 'maximizedPane' | 'viewportLayout'>): string {
  if (state.maximizedPane !== null) return state.maximizedPane;
  const panes = LAYOUT_PANES[state.viewportLayout] ?? [];
  return panes.includes('pane-persp') ? 'pane-persp' : (panes[0] ?? 'pane-persp');
}

const selectHost = (s: SessionState): string | null => (s.workspace === 'model' ? overlayPane(s) : null);

/** An empty scene to model in: nothing the Model workspace would show. */
export function isEmptyModelScene(store: DocumentStore): boolean {
  return (
    store.list('characters').length === 0 &&
    store.list('meshes').length === 0 &&
    store.list('groups').length === 0 &&
    store.list('imagePlanes').length === 0
  );
}

function ModelEmptyStateSlot(props: PaneOverlayProps): JSX.Element | null {
  const host = useSession(selectHost);
  const empty = useDocQuery(isEmptyModelScene, ['characters', 'meshes', 'groups', 'imagePlanes']);
  if (host !== props.paneId || !empty) return null;
  return <LazyBody name="Model start card" load={loadStartCard} props={{ app: props.app, paneId: props.paneId }} />;
}

// ---------- Getting started: dismissed per browser ----------

export const GETTING_STARTED_KEY = 'ekza-animator:model-getting-started:v1';
const dismissListeners = new Set<() => void>();
let dismissedCache: boolean | null = null;

export function gettingStartedDismissed(): boolean {
  if (dismissedCache === null) {
    try {
      dismissedCache = globalThis.localStorage?.getItem(GETTING_STARTED_KEY) === 'dismissed';
    } catch {
      dismissedCache = false;
    }
  }
  return dismissedCache;
}

export function setGettingStartedDismissed(dismissed: boolean): void {
  dismissedCache = dismissed;
  try {
    if (dismissed) globalThis.localStorage?.setItem(GETTING_STARTED_KEY, 'dismissed');
    else globalThis.localStorage?.removeItem(GETTING_STARTED_KEY);
  } catch {
    // Blocked storage: the card stays dismissed for this page only.
  }
  for (const listener of Array.from(dismissListeners)) listener();
}

function useDismissed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    gettingStartedDismissed,
    gettingStartedDismissed,
  );
}

function GettingStartedSlot(props: PaneOverlayProps): JSX.Element | null {
  const host = useSession(selectHost);
  const dismissed = useDismissed();
  if (host !== props.paneId || dismissed) return null;
  return (
    <LazyBody name="Getting started card" load={loadGettingStarted} props={{ app: props.app, paneId: props.paneId }} />
  );
}

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

/** Registers the Model start card and the Getting started card; the disposer removes them. */
export function registerModelStartOverlays(): Disposer {
  const disposers = [
    registerPaneOverlay('emptyState', ModelEmptyStateSlot),
    registerPaneOverlay('gettingStarted', GettingStartedSlot),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
