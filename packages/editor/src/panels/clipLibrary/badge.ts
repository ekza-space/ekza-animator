// The `PREVIEW <clip>` viewport badge (M6B-SPEC §0.4.7 "Preview" (3); C12), registered once through C0's badge slot
// when the Clip Library first shows (panel or Rig Toolkit section); it draws in every pane of every workspace while a
// library preview plays (`hud-badge-preview-<paneId>`).
import type { EditorApp, ViewportBadgeProvider } from '@ekza-studio/editor-core';
import { registerViewportBadge } from '../viewport/hud/badges';
import { clipLabel, subscribeLibrary } from './state';

const listeners = new Set<() => void>();
const watched = new WeakSet<EditorApp>();
let registered = false;

const provider: ViewportBadgeProvider = {
  id: 'preview',
  label(app) {
    const preview = app.library.loaded ? app.library.service.preview : null;
    return preview === null ? null : `PREVIEW ${clipLabel(app, preview.clip) ?? preview.clip}`;
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Registers the badge (once per page) and follows this app's library (once per app). */
export function ensurePreviewBadge(app: EditorApp): void {
  if (!watched.has(app)) {
    watched.add(app);
    subscribeLibrary(app, () => {
      for (const listener of Array.from(listeners)) listener();
    });
  }
  if (!registered) {
    registered = true;
    registerViewportBadge(provider);
  }
}
