// Switching workspaces (M6A-SPEC §5.17, B9). The document, the object and control selection, the scene time and the
// pane cameras stay; the viewport layout and maximized pane are per workspace (`session.workspaceViews`), and so are
// the viewport tool and the pick mask (remembered per app, the workspace's defaults on first entry). Leaving Model
// ends the extrude session, disarms the numeric capture, closes the Last-op card and drops to object mode (the
// component bitsets stay in the selection service). The ViewportManager swaps each pane's display flags and the shell
// swaps the dock layout when `session.workspace` changes; the character display rebuild follows the same change (B8).
import { EkzaError } from '@ekza-studio/anim-core';
import type { EditorApp, SelectionMask, ToolId, ViewportLayout, WorkspaceId } from '../types';

/** Why the Last-op card closed when the user left Model (`LastRun.closed`). */
export const LEFT_MODEL_REASON = 'Left the Model workspace';

/** Viewport layout and maximized pane on the first entry of a workspace (Model: M-Quad, persp maximized, §8.2). */
export const DEFAULT_WORKSPACE_VIEWS: Readonly<
  Record<string, { readonly layout: ViewportLayout; readonly maximizedPane: string | null }>
> = {
  model: { layout: 'quad', maximizedPane: 'pane-persp' },
  animate: { layout: 'split', maximizedPane: null },
  // M6b (§8.2): Rig & Skin opens on R-Side (`front │ persp`).
  rig: { layout: 'rig-side', maximizedPane: null },
};

/** The transform tools (Q W E R): `Y` (last tool, Maya) skips them, so `view.tool` records only the others. */
export function isTransformTool(tool: ToolId): boolean {
  return tool === 'select' || tool === 'move' || tool === 'rotate' || tool === 'scale';
}

interface ToolMemory {
  readonly tool: ToolId;
  readonly mask: SelectionMask;
}

const tools = new WeakMap<object, Map<string, ToolMemory>>();

function toolMemory(app: EditorApp): Map<string, ToolMemory> {
  let memory = tools.get(app.session);
  if (memory === undefined) {
    memory = new Map();
    tools.set(app.session, memory);
  }
  return memory;
}

/** Why `workspace.set` cannot switch to `id`, or null. */
export function workspaceProblem(app: Pick<EditorApp, 'workspaces'>, id: unknown): string | null {
  if (typeof id !== 'string' || id === '') return 'expects { workspace }';
  const def = app.workspaces.get(id);
  if (def === undefined) return `Unknown workspace '${id}'`;
  if (!def.enabled) return def.disabledReason ?? `${def.label} is not available yet`;
  return null;
}

/** Applies the switching rules of §5.17 (session and preferences only). Returns false when `id` is already active. */
export function switchWorkspace(app: EditorApp, id: WorkspaceId): boolean {
  const problem = workspaceProblem(app, id);
  if (problem !== null) throw new EkzaError('unsupported', problem);
  const def = app.workspaces.get(id);
  if (def === undefined) throw new EkzaError('unsupported', `Unknown workspace '${id}'`);
  const from = app.session.getState().workspace;
  if (app.prefs.getState().lastWorkspace !== id) app.prefs.setState({ lastWorkspace: id });
  if (from === id) return false;
  if (from === 'model') {
    // Before the session is read: ending the session may record its args and change the selection (§5.8).
    if (app.extrude.state !== null) app.extrude.end('workspace', { drop: true });
    if (app.capture.state.armed !== null) app.capture.disarm();
  }
  const current = app.session.getState();
  const memory = toolMemory(app);
  memory.set(from, { tool: current.tools.viewport, mask: current.tools.selectionMask });
  const remembered = memory.get(id);
  const left = { layout: current.viewportLayout, maximizedPane: current.maximizedPane };
  const entered = current.workspaceViews[id] ?? DEFAULT_WORKSPACE_VIEWS[id] ?? DEFAULT_WORKSPACE_VIEWS['animate'];
  let model = current.model;
  let lastRun = current.lastRun;
  if (from === 'model') {
    if (model.componentMode !== 'object') {
      model = { ...model, lastComponentMode: model.componentMode, componentMode: 'object' };
    }
    if (lastRun !== null && lastRun.closed === null) lastRun = { ...lastRun, closed: LEFT_MODEL_REASON };
  }
  app.session.setState({
    workspace: id,
    workspaceViews: { ...current.workspaceViews, [from]: left },
    viewportLayout: entered?.layout ?? 'split',
    maximizedPane: entered?.maximizedPane ?? null,
    tools: {
      ...current.tools,
      viewport: remembered?.tool ?? def.defaultTool,
      selectionMask: remembered?.mask ?? def.pickMask,
    },
    model,
    lastRun,
  });
  return true;
}
