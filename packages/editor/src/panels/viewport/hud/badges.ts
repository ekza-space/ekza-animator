// The viewport badge slot (M6B-SPEC §0.5; C0): status badges at the bottom right of every pane's HUD, in every
// workspace. Providers register once (C7: `BIND` / `TEST POSE`; C12: `PREVIEW <clip>` from its chunk); a provider's
// `label(app)` is drawn while it is non-null and re-read whenever the provider notifies. Eager and tiny.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, ViewportBadgeProvider } from '@ekza-studio/editor-core';
import { createElement, type JSX, useSyncExternalStore } from 'react';

const providers: ViewportBadgeProvider[] = [];
const listeners = new Set<() => void>();
let version = 0;

const notify = (): void => {
  version += 1;
  for (const listener of Array.from(listeners)) listener();
};

/** Registers a badge provider; the disposer removes it. Badges draw in registration order. */
export function registerViewportBadge(provider: ViewportBadgeProvider): Disposer {
  providers.push(provider);
  const off = provider.subscribe(notify);
  notify();
  return () => {
    const index = providers.indexOf(provider);
    if (index < 0) return;
    providers.splice(index, 1);
    off();
    notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The pane's badges (`hud-badge-<provider id>-<paneId>`), mounted in the viewport HUD of every workspace. */
export function ViewportBadges(props: { readonly app: EditorApp; readonly paneId: string }): JSX.Element | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const badges = providers.flatMap((provider) => {
    const label = provider.label(props.app);
    return label === null ? [] : [{ id: provider.id, label }];
  });
  if (badges.length === 0) return null;
  return createElement(
    'span',
    { className: 'flex items-center gap-1', 'data-testid': `hud-badges-${props.paneId}` },
    badges.map((badge) =>
      createElement(
        'span',
        {
          key: badge.id,
          className: 'rounded-sm bg-[var(--bg-pressed,#3a3d46)] px-1 text-[10px] font-semibold tracking-wide text-fg',
          'data-testid': `hud-badge-${badge.id}-${props.paneId}`,
        },
        badge.label,
      ),
    ),
  );
}
