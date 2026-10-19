// The Last-op card's pane slot (M6A-SPEC §8.6, §4.8; B11 registers it into B9's `lastOpCard` slot): an eager facade
// that decides in which pane the card shows and loads the card itself (`../toolkit/LastOpCardView`, a lazy chunk)
// only when there is one. Shown in Model, in the pane where the last operation ran (`T` may name another; a pane
// that is not drawn falls back to the maximized pane), for operations with fields; hidden after `✕` until `T`.
import { type LastOpCardState, lastOpCardState, subscribeLastOpCard, visibleParams } from '@ekza-animator/editor-core';
import { type JSX, lazy, Suspense, useSyncExternalStore } from 'react';
import { useSession } from '../../hooks';
import type { PaneOverlayProps } from '../../overlays/slots';

const LastOpCardView = lazy(() => import('../toolkit/LastOpCardView'));

/** The pane a card shows in when the run named none (scripts, menus without a pane). */
export const DEFAULT_CARD_PANE = 'pane-persp';

/** Where the card of `paneId`'s Model view shows, given the card state, the run's pane and the drawn panes. */
export function cardPane(
  card: LastOpCardState,
  runPane: string | null,
  layout: { readonly maximized: string | null },
): string {
  const wanted = card.paneId ?? runPane ?? layout.maximized ?? DEFAULT_CARD_PANE;
  return layout.maximized !== null && layout.maximized !== wanted ? layout.maximized : wanted;
}

export function LastOpCard(props: PaneOverlayProps): JSX.Element | null {
  const { app, paneId } = props;
  const workspace = useSession((s) => s.workspace);
  const lastRun = useSession((s) => s.lastRun);
  const maximized = useSession((s) => s.maximizedPane);
  const card = useSyncExternalStore(
    (listener) => subscribeLastOpCard(app, listener),
    () => lastOpCardState(app),
    () => lastOpCardState(app),
  );
  if (workspace !== 'model' || lastRun === null) return null;
  if (visibleParams(lastRun.params).length === 0) return null;
  if (card.dismissed && lastRun.closed === null) return null;
  if (cardPane(card, lastRun.paneId, { maximized }) !== paneId) return null;
  return (
    <Suspense fallback={null}>
      <LastOpCardView app={app} paneId={paneId} lastRun={lastRun} card={card} />
    </Suspense>
  );
}
