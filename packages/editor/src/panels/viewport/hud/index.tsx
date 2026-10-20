// B10's pane overlays and marking menus (M6A-SPEC §8.4, §8.7, §5.24; eager, small): the Poly Count HUD slot (top-left,
// drawn in Model while the pane's `polyCount` flag is on; the HUD itself is a lazy chunk), the `BIND POSE` badge
// (bottom-right, Model with a skinned mesh) and the `model.modes` / `model.convert` marking menus. The shell calls
// `registerModelSelectUi` once per app.
import type { Disposer } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { type JSX, lazy, Suspense } from 'react';
import { useDocQuery, useSession } from '../../../hooks';
import { CONVERT_MENU } from '../../../overlays/menus/convert';
import { MODES_MENU } from '../../../overlays/menus/modes';
import { type PaneOverlayProps, registerPaneOverlay } from '../../../overlays/slots';

const Hud = lazy(() => import('./Hud'));

/** The HUD slot: nothing outside Model or with the pane's Poly Count off. */
export function HudSlot(props: PaneOverlayProps): JSX.Element | null {
  const model = useSession((s) => s.workspace === 'model');
  if (!model || props.state === null || !props.state.display.polyCount) return null;
  return (
    <Suspense fallback={null}>
      <Hud {...props} />
    </Suspense>
  );
}

function hasSkinnedMesh(store: DocumentStore): boolean {
  return store.list('meshes').some((mesh) => mesh.deleted === null && mesh.data !== null && mesh.skin !== null);
}

/** `BIND POSE` (§5.17, §8.7): Model shows skinned meshes at their bind pose. */
export function BindPoseBadge(props: PaneOverlayProps): JSX.Element | null {
  const model = useSession((s) => s.workspace === 'model');
  const skinned = useDocQuery(hasSkinnedMesh, ['meshes']);
  if (!model || !skinned) return null;
  return (
    <span
      className="rounded-sm bg-[var(--bg-pressed,#3a3d46)] px-1 text-[10px] font-semibold tracking-wide text-fg"
      data-testid={`bind-pose-${props.paneId}`}
    >
      BIND POSE
    </span>
  );
}

/** Registers the HUD and bind-pose overlays and the mode and convert marking menus; the disposer removes them. */
export function registerModelSelectUi(app: EditorApp): Disposer {
  const disposers: Disposer[] = [
    registerPaneOverlay('hud', HudSlot),
    registerPaneOverlay('bindPose', BindPoseBadge),
    app.contribute({ kind: 'markingMenu', def: MODES_MENU }),
    app.contribute({ kind: 'markingMenu', def: CONVERT_MENU }),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
