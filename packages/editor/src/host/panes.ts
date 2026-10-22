// The R-Markers pane ids and sizes (M6B-SPEC §8.2, CR-AR-5; moved here by AUTORIG-SPEC D1): both shells mount the
// Quick Rig markers tool in the same panes — Studio through its dock layout (`shell/rig/layouts.ts` re-exports these),
// Auto-Rig in its CSS grid (`@ekza-studio/editor/host`), so `/autorig` reaches them without any dockview code.

/** Layout preset ids of Rig & Skin (§0.5): R-Side and R-Markers are viewport layouts of the same name. */
export const RIG_LAYOUT = { side: 'rig-side', markers: 'rig-markers' } as const;
export type RigLayoutId = (typeof RIG_LAYOUT)[keyof typeof RIG_LAYOUT];

/** Pane ids of R-Markers (CR-AR-5: exported so other shells mount the markers tool in the same panes). */
export const RIG_MARKER_PANES = { front: 'pane-front', side: 'pane-side', persp: 'pane-persp' } as const;
/** R-Markers pane widths in percent (`front │ side │ persp`). */
export const RIG_MARKER_SIZES: readonly [number, number, number] = [40, 30, 30];
