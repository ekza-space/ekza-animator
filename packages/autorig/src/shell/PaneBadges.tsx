// A wizard pane's badges (AUTORIG-SPEC §4.2, §5.4, §5.5; D3, AR-D3-1), a lazy chunk drawn from ③ on: the pose view
// (`BIND POSE` / `TEST POSE` in Rig & Skin, M6B §5.17) and a playing library preview (`PREVIEW <clip>`, C12), at the
// bottom right of every pane as Studio's HUD draws them (same test ids: `hud-badge-pose-<pane>`,
// `hud-badge-preview-<pane>`). Read-only: the session, the library service's preview and its manifest's labels.
import type { EditorApp } from '@ekza-studio/editor-core';
import { type JSX, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { messages } from '../i18n';
import type { AutoRigStep } from '../types';
import { useAppSession } from './context';

const badge = 'rounded-sm bg-[var(--bg-pressed,#3a3d46)] px-1 text-[10px] font-semibold tracking-wide text-fg';

/**
 * The library preview's clip id, following the service. Subscribing loads the clip-library chunk, which ③ (the
 * motion test) and ④ load anyway; on ⑤ the badge follows the library only once something else loaded it.
 */
function usePreviewClip(app: EditorApp, follow: boolean): string | null {
  const subscribe = useCallback(
    (listener: () => void) => (follow ? app.library.service.subscribe(listener) : () => {}),
    [app, follow],
  );
  const read = useCallback(() => app.library.service.preview?.clip ?? null, [app]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The manifest label of a clip (its id until the manifest is read). */
function useClipLabel(app: EditorApp, clip: string | null): string | null {
  const [labels, setLabels] = useState<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    if (clip === null || labels !== null) return undefined;
    let live = true;
    app.library.service.manifest().then(
      (manifest) => {
        if (live) setLabels(new Map(manifest.clips.map((entry) => [entry.id, entry.label])));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [app, clip, labels]);
  return clip === null ? null : (labels?.get(clip) ?? clip);
}

export default function PaneBadges(props: {
  readonly app: EditorApp;
  readonly paneId: string;
  readonly step: AutoRigStep;
}): JSX.Element {
  const { app, paneId, step } = props;
  const f = messages().frame;
  const pose = useAppSession(
    app,
    useCallback((s) => (s.workspace === 'rig' ? s.rig.poseView : null), []),
  );
  const label = useClipLabel(app, usePreviewClip(app, step !== 'export' || app.library.loaded));
  return (
    <div className="pointer-events-none absolute right-2 bottom-1.5 z-20 flex select-none items-center gap-2">
      {pose === null ? null : (
        <span className={badge} data-testid={`hud-badge-pose-${paneId}`}>
          {pose === 'test' ? f.badgeTestPose : f.badgeBindPose}
        </span>
      )}
      {label === null ? null : (
        <span className={badge} data-testid={`hud-badge-preview-${paneId}`}>
          {f.badgePreview(label)}
        </span>
      )}
    </div>
  );
}
