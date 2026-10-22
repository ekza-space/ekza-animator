// Creates the Studio shell (MVP-SPEC §7 WP-8; split by AUTORIG-SPEC §4.4, D1) over the page's HostShell: the panel
// registry with the built-in panels, Studio's shell operators and menu items, the dockview workspace adapter, the
// layout presets, the marking menus, the Graph Editor and time-slider probes, the Recovery prompt and the rig shell.
// The host (UI store, frame hooks, keyboard, files, autosave, palette, navigation) outlives it: a switch to Auto-Rig
// disposes only what is created here.
import type { Disposer } from '@ekza-studio/anim-core';
import type { PanelKind } from '@ekza-studio/editor-core';
import { createHostShell, type CreateHostOptions, HOST_OPERATOR_IDS } from '../host/createHost';
import type { HostShell } from '../host/types';
import { createMarkingMenus, marksMenus, prefetchMarkingMenu } from '../overlays/MarkingMenu';
import { registerBuiltinPanels } from '../panels';
import { graphTestHooks } from '../panels/graph/testHooks';
import { createPanelRegistry } from '../panels/registry';
import { screenOfTimelineFrame, screenOfTimelineTick } from '../panels/timeline/host';
import type { PanelRegistry } from '../panels/types';
import { registerModelSelectUi } from '../panels/viewport/hud';
import { registerModelTransformUi } from '../panels/viewport/ModalReadout';
import { promptRecovery } from './autosave';
import { ALL_SLOTS, FIXED_KINDS } from './layout';
import { registerShellMenuItems, registerUserPresetMenuItems } from './menuItems';
import { shellOperatorDefs } from './operators';
import { createLayoutPresetStore } from './presets';
import { registerRigShell } from './rig';
import type { Shell, ShellUiState } from './types';
import { createWorkspaceController } from './workspace';

export { INITIAL_UI } from '../host/createHost';

/**
 * The page's host, or — without one (unit tests, harnesses that mount the shell alone) — the options of a host of the
 * shell's own, created with it and disposed with it.
 */
export type CreateShellOptions = (
  | { readonly host: HostShell }
  | (CreateHostOptions & { readonly host?: undefined })
) & {
  /** Panels to show; default: a registry with `registerBuiltinPanels`. */
  readonly panels?: PanelRegistry;
};

export function createShell(opts: CreateShellOptions): Shell {
  const host = opts.host ?? createHostShell(opts);
  const ownsHost = opts.host === undefined;
  const { app, ui } = host;
  const disposers: Disposer[] = [];

  let panels = opts.panels;
  if (panels === undefined) {
    panels = createPanelRegistry();
    disposers.push(registerBuiltinPanels(panels));
  }
  const registry = panels;

  const workspace = createWorkspaceController({
    app,
    panels: registry,
    storage: host.storage,
    ui,
    notify: (text) => app.services.notify.toast({ kind: 'info', text }),
  });

  // Layout presets (docs/LAYOUT-PRESETS.md): the user's presets live beside the layouts, in the same storage.
  const presets = createLayoutPresetStore(host.storage);
  // Studio's shell operators: every `shellOperatorDefs` row but the host's (the host registers those on every route).
  for (const contribution of shellOperatorDefs(app, {
    workspace,
    ui,
    presets,
    onImportClosed: () => host.files.cancelImport(),
  })) {
    if (contribution.kind !== 'operator' || !HOST_OPERATOR_IDS.has(contribution.def.id)) {
      disposers.push(app.contribute(contribution));
    }
  }

  // M6A-SPEC §5.18 (B9): marking menus (the viewport's press hook, `ui.markingMenu` through the host's overlay port).
  const markingMenus = createMarkingMenus({
    app,
    run: (op, args, ctx) => host.runFromUi(op, args, ctx),
    help: (text, tone) => host.help(text, tone),
  });
  disposers.push(() => markingMenus.dispose());
  const pointerMenus = (press: Parameters<typeof markingMenus.handlePress>[0]): boolean =>
    markingMenus.handlePress(press);
  /** Hooks the presses of a viewport (null unhooks); test fakes without the hook are left alone. */
  const hookMenus = (vm: ShellUiState['viewport'], handler: typeof pointerMenus | null): void => {
    if (typeof vm?.setPointerMenus === 'function') vm.setPointerMenus(handler);
  };
  hookMenus(ui.getState().viewport, pointerMenus);
  disposers.push(
    ui.subscribe((state, previous) => {
      if (state.viewport === previous.viewport) return;
      hookMenus(previous.viewport, null);
      hookMenus(state.viewport, pointerMenus);
    }),
    () => hookMenus(ui.getState().viewport, null),
  );
  // The marking menus (controller and drawing) load before the first menu opens: when a workspace that has marking
  // menus is entered (Model), or when one is registered for the active workspace. Animate never loads them.
  const prefetchMenus = (): void => {
    if (typeof window === 'undefined' || markingMenus.controller() !== null) return;
    if (marksMenus(app)) prefetchMarkingMenu(markingMenus);
  };
  prefetchMenus();
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (state.workspace === previous.workspace) return;
      markingMenus.close();
      prefetchMenus();
    }),
    app.markingMenus.subscribe(prefetchMenus),
  );
  // M2A-SPEC §5.20: the Recovery prompt, once per page load (a page that received a handoff record never asks).
  disposers.push(
    promptRecovery({ app, runFromUi: (op, args) => host.runFromUi(op, args), skip: host.params.handoff !== null }),
  );
  const extraPanels: { kind: PanelKind; title: string }[] = [];
  for (const def of registry.list()) {
    if (FIXED_KINDS.has(def.kind) || ALL_SLOTS.some((slot) => slot.kind === def.kind)) continue;
    if (extraPanels.some((panel) => panel.kind === def.kind)) continue;
    extraPanels.push({ kind: def.kind, title: def.title });
  }
  disposers.push(
    registerShellMenuItems(app, extraPanels, {
      chromeShown: (part) => workspace.chrome()[part],
      focused: () => workspace.focused(),
      fullscreen: () => typeof document !== 'undefined' && document.fullscreenElement !== null,
    }),
  );
  disposers.push(registerUserPresetMenuItems(app, presets));
  // M6a (B10): the Poly Count HUD and BIND POSE overlays, the RMB mode and Ctrl+RMB convert marking menus.
  disposers.push(registerModelSelectUi(app));
  // M6b (C7): the Rig & Skin shell UI, loaded on the first entry; disposed with this shell, which clears the
  // view-only flag (AUTORIG-SPEC §8.3, AR-V1: the rule is Studio's).
  disposers.push(
    registerRigShell(app, { showPanel: (kind) => workspace.showPanel(kind), dockview: () => workspace.dockview }),
  );
  disposers.push(registerModelTransformUi(app));

  // The Graph Editor and time-slider slices of the e2e test API (MVP-SPEC §4.8) follow the focused panel of each
  // kind, so one registration per shell serves every mounted instance (null while none is mounted).
  disposers.push(host.probes.set('graph', graphTestHooks(app)));
  disposers.push(
    host.probes.set('timeline', {
      screenOfFrame: (frame) => screenOfTimelineFrame(app, frame),
      screenOfTick: (frame) => screenOfTimelineTick(app, frame),
    }),
  );

  const shell: Shell = {
    ...host,
    kind: 'studio',
    panels: registry,
    workspace,
    presets,
    markingMenus,
    attachWorkspace: (api) => workspace.attach(api),
    leave(): void {
      markingMenus.close();
    },
    openMarkingMenu: (def, ctx) => markingMenus.openByCommand(def, ctx),
    dispose(): void {
      markingMenus.close();
      for (const dispose of disposers.splice(0).reverse()) dispose();
      if (ownsHost) host.dispose();
    },
  };
  // A shell with a host of its own is that host's mounted shell at once; on the page, `StudioShell` mounts it from an
  // effect (a store update while rendering would re-render the host's subscribers mid-render).
  if (ownsHost) disposers.push(host.mount(shell));
  return shell;
}
