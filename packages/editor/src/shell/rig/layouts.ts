// Rig & Skin layouts (M6B-SPEC §8.2, §0.4.2; C7): the dock arrangement of the workspace and its viewport presets.
// Docks: Outliner left (240 px); Rig Toolkit (first tab) · Paint Weights · Channel Box · Attributes right (300 px,
// min 260); Validation below (160 px; the Component Editor joins it when C6 builds it, §0.3); the time slider shown. Viewport presets: R-Single
// (`persp`), **R-Side** (`front │ persp`, the default) and R-Markers (`front │ side │ persp`, 40/30/30), which Quick
// Rig switches to (`applyRigLayout`, C3). Eager and small: `layout.ts` builds the default dock layout from here.
import { type EditorApp, PANEL, type PanelKind, type ViewportLayout } from '@ekza-studio/editor-core';
import type { DockviewApi, IDockviewPanel } from 'dockview-react';
import type { PanelComponent } from '../layout';

/** Layout preset ids of Rig & Skin (§0.5): R-Side and R-Markers are viewport layouts of the same name. */
export const RIG_LAYOUT = { side: 'rig-side', markers: 'rig-markers' } as const;
export type RigLayoutId = (typeof RIG_LAYOUT)[keyof typeof RIG_LAYOUT];

/** Pane ids of R-Markers (CR-AR-5: exported so other shells mount the markers tool in the same panes). */
export const RIG_MARKER_PANES = { front: 'pane-front', side: 'pane-side', persp: 'pane-persp' } as const;
/** R-Markers pane widths in percent (`front │ side │ persp`). */
export const RIG_MARKER_SIZES: readonly [number, number, number] = [40, 30, 30];

/** The viewport presets Rig & Skin offers (status line, Windows › Layout). */
export const RIG_LAYOUTS: readonly { readonly layout: ViewportLayout; readonly label: string }[] = [
  { layout: 'single', label: 'Single view' },
  { layout: RIG_LAYOUT.side, label: 'Front | perspective' },
  { layout: RIG_LAYOUT.markers, label: 'Front | side | perspective' },
];

/** Switches the viewport to a Rig & Skin preset (U state; the panes keep their cameras and display). */
export function applyRigLayout(app: Pick<EditorApp, 'session'>, id: RigLayoutId): void {
  const state = app.session.getState();
  if (state.viewportLayout !== id || state.maximizedPane !== null) {
    app.session.setState({ viewportLayout: id, maximizedPane: null });
  }
}

type Slot = { readonly kind: PanelKind; readonly slot: 'left' | 'center' | 'right' | 'bottom'; readonly title: string };

/** Dock slots of Rig & Skin (§8.2). */
export const RIG_SLOTS: readonly Slot[] = [
  { kind: PANEL.viewport, slot: 'center', title: 'Viewport' },
  { kind: PANEL.outliner, slot: 'left', title: 'Outliner' },
  { kind: PANEL.rigToolkit, slot: 'right', title: 'Rig Toolkit' },
  { kind: PANEL.paintWeights, slot: 'right', title: 'Paint Weights' },
  { kind: PANEL.channelBox, slot: 'right', title: 'Channel Box' },
  { kind: PANEL.attributes, slot: 'right', title: 'Attributes' },
  { kind: PANEL.validation, slot: 'bottom', title: 'Validation' },
];

/** Rig & Skin dock sizes (§8.2). */
export const RIG_DOCK_SIZES = { left: 240, right: 300, rightMin: 260, bottom: 160 } as const;

/** Builds the default Rig & Skin dock layout into an empty dockview; kinds `resolve` returns null for are left out. */
export function buildRigLayout(api: DockviewApi, resolve: (kind: PanelKind) => PanelComponent | null): void {
  const options = (entry: PanelComponent) => ({
    id: entry.kind,
    component: entry.component,
    title: entry.title,
    params: { kind: entry.kind },
  });
  const viewport = resolve(PANEL.viewport);
  const center = viewport === null ? null : api.addPanel(options(viewport));
  const dock = (
    slot: 'left' | 'right' | 'bottom',
    size: { readonly initialWidth?: number; readonly initialHeight?: number },
    minimumWidth?: number,
  ): void => {
    const direction = slot === 'bottom' ? 'below' : slot;
    let first: IDockviewPanel | null = null;
    for (const entry of RIG_SLOTS.filter((candidate) => candidate.slot === slot)) {
      const e = resolve(entry.kind);
      if (e === null) continue;
      const constraints = minimumWidth === undefined ? {} : { minimumWidth };
      if (first === null) {
        const position = center === null ? { direction } : { referencePanel: center, direction };
        first = api.addPanel({ ...options(e), position, ...size, ...constraints });
      } else {
        api.addPanel({ ...options(e), position: { referencePanel: first, direction: 'within' }, inactive: true });
      }
    }
  };
  dock('left', { initialWidth: RIG_DOCK_SIZES.left });
  dock('right', { initialWidth: RIG_DOCK_SIZES.right }, RIG_DOCK_SIZES.rightMin);
  dock('bottom', { initialHeight: RIG_DOCK_SIZES.bottom });
  center?.api.setActive();
}
