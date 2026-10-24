// The Animate stage while the shell is mounted (STUDIO-TOUCH-SPEC §7.1, §10; T7; P-T6A-4): ● Rec as the `shell`
// override (removed on unmount, ha-12), the fitting manipulator of a selected control (§10.1: a turn ring for FK
// controls, move for IK goals and the root), Reach and the touch count of canvas drags, and the Library sheet (the
// Thread provides the focused band source itself while it is mounted). Leaving Animate closes the stage's transient
// surfaces and stops a library preview.
import { PANEL, VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import { createElement, lazy, type JSX, Suspense } from 'react';
import type { HaloController } from '../../shell/controller';
import { registerHaloSheet, type SheetBodyProps } from '../../shell/Sheets';
import { FITTABLE_TOOLS, fittingTool } from './model';
import { installReach } from './reach';
import { installRec } from './rec';
import { sheetContextOf } from './sheetContext';
import { animateUi, closeAnimateSurfaces } from './ui';

const LibrarySheet = lazy(() => import('../../sheets/library'));

/** The frame's size class (its root's `data-size`), for where a sheet docks. */
function sideOf(): 'right' | 'bottom' {
  if (typeof document === 'undefined') return 'right';
  const size = document.querySelector('[data-shell="ekza-halo-shell"]')?.getAttribute('data-size');
  return size === 'wide' || size === null || size === undefined ? 'right' : 'bottom';
}

/** The Library in the frame's sheet slot (T6a's `registerHaloSheet`; T6-INT may move it to `SHEET_LOADERS`). */
function LibraryHost({ controller }: SheetBodyProps): JSX.Element {
  const { store } = controller.ctx;
  const close = (): void => {
    if (store.get().sheet === 'library') store.set({ sheet: null });
  };
  return createElement(
    Suspense,
    { fallback: null },
    createElement(LibrarySheet, { ctx: sheetContextOf(controller, null, sideOf(), close) }),
  );
}

/** The fitting manipulator follows the lead selected control in Animate (§10.1). */
function installFittingTool(controller: HaloController): () => void {
  const { ctx } = controller;
  const { app, store } = ctx;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const apply = (): void => {
    pending = null;
    if (store.get().stage !== 'animate' || app.session.getState().workspace !== 'animate') return;
    const lead = app.session.getState().selection.controls.at(-1);
    if (lead === undefined) return;
    const tool = app.session.getState().tools.viewport;
    if (!FITTABLE_TOOLS.has(tool)) return;
    const wanted = fittingTool(app, lead);
    if (tool !== wanted) void ctx.run('view.tool', { panel: PANEL.viewport, tool: wanted });
  };
  // after the run that changed the selection or the stage has finished (operators do not run inside one another)
  const fit = (): void => {
    if (pending === null) pending = setTimeout(apply, 0);
  };
  const offSession = app.session.subscribe((next, previous) => {
    if (
      next.selection.controls !== previous.selection.controls ||
      (next.tools.viewport !== previous.tools.viewport && next.tools.viewport === VIEWPORT_TOOL.select) ||
      next.workspace !== previous.workspace
    )
      fit();
  });
  const offStore = store.subscribe((next, previous) => {
    if (next.stage !== previous.stage) fit();
  });
  fit();
  return () => {
    if (pending !== null) clearTimeout(pending);
    offSession();
    offStore();
  };
}

export function startAnimate(controller: HaloController): () => void {
  const { ctx } = controller;
  const { app, store } = ctx;
  const ui = animateUi(store);
  const disposers: (() => void)[] = [];
  disposers.push(installRec(app, store));
  disposers.push(installFittingTool(controller));
  disposers.push(installReach(ctx, () => store.set((s) => ({ touches: s.touches + 1 }))));
  disposers.push(registerHaloSheet('library', LibraryHost));

  // leaving Animate (or the sheet slot taken by another sheet) closes the stage's transient surfaces
  disposers.push(
    store.subscribe((next, previous) => {
      if (next.stage !== previous.stage && previous.stage === 'animate') {
        closeAnimateSurfaces(ui);
        if (app.library.loaded && app.library.service.preview !== null) void ctx.run('library.stop');
      }
      if (next.home && !previous.home) closeAnimateSurfaces(ui);
    }),
  );
  // a deleted animation's docked Halo goes with it
  disposers.push(
    app.store.subscribe(() => {
      const docked = ui.get().docked;
      if (docked?.kind === 'clip' && app.store.get('clips', docked.clip)?.deleted !== null) ui.set({ docked: null });
    }),
  );
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
    closeAnimateSurfaces(ui);
  };
}
