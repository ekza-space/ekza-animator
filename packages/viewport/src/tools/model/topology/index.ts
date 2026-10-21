// The Model topology tools (M6A-SPEC §4.7, §5.8, §5.10–§5.12; B12b), eager part: the `ToolDef`s of Multi-Cut,
// Insert Edge Loop, Target Weld, Slide Edge and the extrude manipulator (`VIEWPORT_TOOL.extrude`, which also carries
// the Inset and Bevel handles), and the loader of the lazy topology kit that holds their behaviour, previews and the
// manipulator drawing (§5.27: the eager route holds descriptors, registrations, keymap rows and shell code). The kit
// loads on the first Model entry; until it has loaded a press with one of these tools does nothing.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  PANEL,
  type ToolDef,
  type ToolInstance,
  type ToolPhase,
  VIEWPORT_TOOL,
} from '@ekza-studio/editor-core';
import type { ViewportManager } from '../../../manager/ViewportManager';
import type { ManipHandle } from '../../../types';
import type { ViewportToolHost } from '../../host';
import type * as TopologyKitModule from './kit';

export type TopologyKit = typeof TopologyKitModule;

let kit: TopologyKit | null = null;
let loading: Promise<TopologyKit> | null = null;

/** Loads the topology kit once (a failed load is retried by the next call). */
export function loadTopologyKit(): Promise<TopologyKit> {
  if (loading === null) {
    const load = import('./kit').then((module) => {
      kit = module;
      return module;
    });
    loading = load;
    load.catch(() => {
      if (loading === load) loading = null;
    });
  }
  return loading;
}

/** The topology kit once loaded, else null. */
export function topologyKit(): TopologyKit | null {
  return kit;
}

/** The viewport each app's topology tools draw in (set by `registerTopologyTools`). */
const viewports = new WeakMap<EditorApp, ViewportManager>();

/** The tool ids of this package and their labels. */
export const TOPOLOGY_TOOLS = [
  { id: VIEWPORT_TOOL.multiCut, label: 'Multi-Cut', icon: 'tool-multicut' },
  { id: VIEWPORT_TOOL.insertLoop, label: 'Insert Edge Loop', icon: 'tool-loop' },
  { id: VIEWPORT_TOOL.targetWeld, label: 'Target Weld', icon: 'tool-weld' },
  { id: VIEWPORT_TOOL.slide, label: 'Slide Edge', icon: 'tool-slide' },
  { id: VIEWPORT_TOOL.extrude, label: 'Extrude Manipulator', icon: 'tool-extrude' },
] as const;

/** A tool whose behaviour is created from the kit once it has loaded (the Scale tool's pattern, B9). */
function topologyToolDef(id: string, label: string, icon: string): ToolDef<ViewportToolHost> {
  return {
    id,
    panel: PANEL.viewport,
    label,
    icon,
    workspaces: ['model'],
    create: (app: EditorApp, host: ViewportToolHost): ToolInstance => {
      let impl: ToolInstance | null = null;
      let active = true;
      const ensure = (): ToolInstance | null => {
        if (impl !== null) return impl;
        const vm = viewports.get(app);
        if (kit === null || vm === undefined) {
          void loadTopologyKit().then(
            () => {
              if (active && impl === null) ensure()?.activate?.();
            },
            () => {},
          );
          return null;
        }
        impl = kit.createTopologyTool(id, app, vm, host);
        return impl;
      };
      ensure();
      return {
        activate: () => {
          active = true;
          ensure()?.activate?.();
        },
        deactivate: () => {
          active = false;
          impl?.deactivate?.();
        },
        pointerDown: (e) => ensure()?.pointerDown?.(e) ?? false,
        pointerMove: (e) => impl?.pointerMove?.(e) ?? false,
        pointerUp: (e) => impl?.pointerUp?.(e) ?? false,
        wheel: (e) => impl?.wheel?.(e) ?? false,
        key: (e) => impl?.key?.(e) ?? false,
        cancel: () => impl?.cancel?.(),
        cursor: () => impl?.cursor?.() ?? null,
        phase: (): ToolPhase => impl?.phase?.() ?? 'idle',
        numeric: () => impl?.numeric?.() ?? null,
      };
    },
  };
}

/** Registers the topology tools of a viewport; the kit loads on the first Model entry. */
export function registerTopologyTools(app: EditorApp, vm: ViewportManager): Disposer {
  viewports.set(app, vm);
  const disposers: Disposer[] = TOPOLOGY_TOOLS.map((tool) =>
    app.contribute({ kind: 'tool', def: topologyToolDef(tool.id, tool.label, tool.icon) }),
  );
  const attach = (): void => {
    void loadTopologyKit().then(
      (loaded) => {
        if (viewports.get(app) === vm) loaded.attachTopology(app, vm);
      },
      () => {},
    );
  };
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (state.workspace === 'model' && previous.workspace !== 'model') attach();
    }),
  );
  if (app.session.getState().workspace === 'model') attach();
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
    kit?.detachTopology(app, vm);
    if (viewports.get(app) === vm) viewports.delete(app);
  };
}

/**
 * Pane CSS px of a handle of the extrude manipulator while it shows (§4.7: `screenOfManipulator` covers its handles,
 * the same ids while a session is open), else null.
 */
export function topologyManipulatorPoint(
  vm: ViewportManager,
  paneId: string,
  handle: ManipHandle,
): { readonly x: number; readonly y: number } | null {
  return kit?.manipulatorScreenPoint(vm, paneId, handle) ?? null;
}
