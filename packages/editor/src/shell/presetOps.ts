// The bodies of the layout preset operators (docs/LAYOUT-PRESETS.md): `workspace.preset.apply`, `.save`, `.rename`
// and `.delete`. Their definitions and polls stay eager in `./operators` (menus, the keymap's Alt+1…4 and the command
// palette need them); each operator's `prepare` loads this module (`loadPresetOps`) and its `apply` runs the matching
// function here, so the editor's first route carries only the definitions (the eager-route budget, §5.27). The runner
// polls again after `prepare`, so a run that started before the load still checks the state it applies to.
import { EkzaError } from '@ekza-studio/anim-core';
import { DEFAULT_WORKSPACE_VIEWS, type EditorApp } from '@ekza-studio/editor-core';
import type { ShellOperatorDeps } from './operators';
import { builtinPreset } from './presets';

type PresetDeps = Pick<ShellOperatorDeps, 'workspace' | 'presets'>;

const activeWorkspace = (app: EditorApp): string => app.session.getState().workspace;

/** Applies a built-in preset (dock shape, chrome, viewport panes) or one of the user's presets of this workspace. */
export function applyPreset(app: EditorApp, deps: PresetDeps, id: string): void {
  const workspace = activeWorkspace(app);
  const builtin = builtinPreset(id);
  if (builtin !== undefined) {
    const views = DEFAULT_WORKSPACE_VIEWS[workspace] ?? DEFAULT_WORKSPACE_VIEWS['animate'];
    deps.workspace.applyLayout(builtin.dock, builtin.chrome);
    app.session.setState({
      viewportLayout: builtin.viewportLayout ?? views?.layout ?? 'split',
      maximizedPane: builtin.viewportLayout === null ? (views?.maximizedPane ?? null) : null,
    });
    return;
  }
  const preset = deps.presets.get(workspace, id);
  if (preset === undefined) throw new EkzaError('unsupported', `No preset '${id}'`);
  deps.workspace.applyLayout(preset.dockview, preset.chrome);
  app.session.setState({ viewportLayout: preset.viewportLayout, maximizedPane: preset.maximizedPane });
}

/** Saves the shown layout, chrome and viewport panes under `name` in this workspace. */
export function savePreset(
  app: EditorApp,
  deps: PresetDeps,
  name: string,
): { readonly id: string; readonly persistent: boolean } {
  const captured = deps.workspace.capture();
  if (captured === null) throw new EkzaError('unsupported', 'The workspace is not shown yet');
  const session = app.session.getState();
  const preset = deps.presets.save(session.workspace, name, {
    dockview: captured.dockview,
    chrome: captured.chrome,
    viewportLayout: session.viewportLayout,
    maximizedPane: session.maximizedPane,
  });
  return { id: preset.id, persistent: deps.presets.persistent() };
}

export function renamePreset(app: EditorApp, deps: PresetDeps, id: string, name: string): void {
  deps.presets.rename(activeWorkspace(app), id, name);
}

export function deletePreset(app: EditorApp, deps: PresetDeps, id: string): void {
  deps.presets.remove(activeWorkspace(app), id);
}
