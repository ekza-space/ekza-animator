// Operators owned by the Studio shell (MVP-SPEC §4.9 owner 8): the workspace and layout preset commands (dockview's).
// Registered through `app.contribute` like every other operator (ADR 0008); none of them writes the document.
// `ui.open`, `ui.close`, `prefs.set` and, since STUDIO-TOUCH-SPEC T6-INT, `view.toggleMaximize` are the page host's
// (`host/operators.ts`; the shell provides its maximize port for the panel form, `registerShellOperators`), and since
// T3 so are the shell-neutral `view.selectionMask` and `view.toggleFullscreen` (`host/registrations/view.ts`): they
// exist on every route.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import {
  type Contribution,
  type EditorApp,
  type OperatorDef,
  type PanelKind,
  type PollResult,
} from '@ekza-studio/editor-core';
import type { StoreApi } from 'zustand/vanilla';
import { type MaximizePort, provideMaximizePort } from '../host/operators';
import { CHROME_PARTS, type ChromePart } from './layout';
import type {} from './operator-map';
import type * as PresetOps from './presetOps';
import { builtinPreset, type LayoutPresetStore, presetNameProblem } from './presets';
import type { ShellUiState, WorkspaceApi } from './types';

export interface ShellOperatorDeps {
  readonly workspace: WorkspaceApi;
  /** The shell's UI state (M6a: the time slider's visibility per workspace). */
  readonly ui: StoreApi<ShellUiState>;
  /** The user's layout presets (docs/LAYOUT-PRESETS.md). */
  readonly presets: LayoutPresetStore;
}

type PresetOpsModule = typeof PresetOps;

let presetOpsLoading: Promise<PresetOpsModule> | null = null;

/** Loads the preset operators' bodies (`./presetOps`) once; a failed load is forgotten so the next run tries again. */
function loadPresetOps(): Promise<PresetOpsModule> {
  if (presetOpsLoading === null) {
    const attempt = import('./presetOps');
    presetOpsLoading = attempt;
    attempt.catch(() => {
      if (presetOpsLoading === attempt) presetOpsLoading = null;
    });
  }
  return presetOpsLoading;
}

const ok: PollResult = true;
const fail = (reason: string): PollResult => ({ ok: false, reason });

export function shellOperatorDefs(app: EditorApp, deps: ShellOperatorDeps): Contribution[] {
  const resetWorkspace: OperatorDef = {
    id: 'workspace.reset',
    label: 'Reset Workspace',
    description: 'Restore the default layout of the current workspace.',
    category: 'view',
    scope: 'global',
    apply() {
      app.session.setState({ maximizedPane: null });
      deps.workspace.reset();
    },
  };

  const showPanel: OperatorDef<{ readonly panel: PanelKind }> = {
    id: 'workspace.showPanel',
    label: 'Show Panel',
    category: 'view',
    scope: 'global',
    poll: (_ctx, args) => (typeof args.panel === 'string' && args.panel !== '' ? ok : fail('No panel given')),
    apply(_ctx, args) {
      if (!deps.workspace.showPanel(args.panel)) {
        throw new EkzaError('unsupported', `Panel '${args.panel}' is not available in this build`);
      }
    },
  };

  // M6a (§8.2): Windows › Timeline shows or hides the time slider in the current workspace (hidden in Model).
  const toggleTimeline: OperatorDef = {
    id: 'workspace.toggleTimeline',
    label: 'Timeline',
    description: 'Show or hide the time slider in this workspace.',
    category: 'view',
    scope: 'global',
    apply() {
      deps.workspace.setChrome('timeline', !deps.workspace.chrome().timeline);
    },
  };

  // Layout presets (docs/LAYOUT-PRESETS.md): the chrome toggles, focus mode, presets and fullscreen.
  const toggleChrome: OperatorDef<{ readonly part: ChromePart; readonly shown?: boolean }> = {
    id: 'workspace.toggleChrome',
    label: 'Show or Hide Chrome',
    aliases: ['Hide toolbar', 'Show toolbar', 'Hide UI'],
    description: 'Show or hide the tool strip, the help line or the time slider in this workspace.',
    category: 'view',
    scope: 'global',
    poll: (_ctx, args) =>
      CHROME_PARTS.includes(args.part)
        ? ok
        : fail(`expects { part: ${CHROME_PARTS.map((p) => `'${p}'`).join(' | ')} }`),
    apply(_ctx, args) {
      deps.workspace.setChrome(args.part, args.shown ?? !deps.workspace.chrome()[args.part]);
    },
  };

  const toggleFocus: OperatorDef<void, { readonly focused: boolean }> = {
    id: 'workspace.toggleFocus',
    label: 'Focus Mode',
    aliases: ['Hide UI', 'Show UI', 'Toggle UI'],
    description: 'Hide the panels and the tool strip around the viewport; again to bring them back as they were.',
    category: 'view',
    scope: 'global',
    poll: () => (deps.workspace.dockview === null ? fail('The workspace is not shown yet') : ok),
    apply() {
      return { focused: deps.workspace.toggleFocus() };
    },
  };

  const presetWorkspace = (): string => app.session.getState().workspace;
  const animateLike = (workspace: string): boolean => (app.workspaces.get(workspace)?.timeline ?? true) === true;

  const applyPreset: OperatorDef<{ readonly preset: string }, void, PresetOpsModule> = {
    id: 'workspace.preset.apply',
    label: 'Apply Layout Preset',
    aliases: ['Layout preset', 'Workspace layout'],
    description: 'Switch to a built-in or saved layout preset (panels, chrome and viewport panes).',
    category: 'view',
    scope: 'global',
    poll(_ctx, args) {
      if (typeof args.preset !== 'string' || args.preset === '') return fail('expects { preset }');
      if (deps.workspace.dockview === null) return fail('The workspace is not shown yet');
      const workspace = presetWorkspace();
      const builtin = builtinPreset(args.preset);
      if (builtin !== undefined) {
        if (builtin.animateOnly && !animateLike(workspace)) {
          return fail(`${builtin.label} is an Animate preset; Alt+1 restores this workspace's default layout`);
        }
        return ok;
      }
      return deps.presets.get(workspace, args.preset) === undefined ? fail(`No preset '${args.preset}'`) : ok;
    },
    prepare: loadPresetOps,
    apply: (_ctx, args, impl) => impl.applyPreset(app, deps, args.preset),
  };

  const savePreset: OperatorDef<
    { readonly name: string },
    { readonly id: string; readonly persistent: boolean },
    PresetOpsModule
  > = {
    id: 'workspace.preset.save',
    label: 'Save Layout Preset',
    description: 'Save the current panels, chrome and viewport panes as a named preset of this workspace.',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll(_ctx, args) {
      const problem = presetNameProblem(args.name);
      if (problem !== null) return fail(problem);
      return deps.workspace.dockview === null ? fail('The workspace is not shown yet') : ok;
    },
    prepare: loadPresetOps,
    apply: (_ctx, args, impl) => impl.savePreset(app, deps, args.name),
  };

  const renamePreset: OperatorDef<{ readonly id: string; readonly name: string }, void, PresetOpsModule> = {
    id: 'workspace.preset.rename',
    label: 'Rename Layout Preset',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll(_ctx, args) {
      const problem = presetNameProblem(args.name);
      if (problem !== null) return fail(problem);
      const workspace = presetWorkspace();
      if (deps.presets.get(workspace, args.id) === undefined) return fail(`No preset '${String(args.id)}'`);
      const clash = deps.presets
        .list(workspace)
        .find((preset) => preset.id !== args.id && preset.name.toLowerCase() === args.name.trim().toLowerCase());
      return clash === undefined ? ok : fail(`A preset named '${clash.name}' already exists`);
    },
    prepare: loadPresetOps,
    apply: (_ctx, args, impl) => impl.renamePreset(app, deps, args.id, args.name),
  };

  const deletePreset: OperatorDef<{ readonly id: string }, void, PresetOpsModule> = {
    id: 'workspace.preset.delete',
    label: 'Delete Layout Preset',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll: (_ctx, args) =>
      deps.presets.get(presetWorkspace(), args.id) === undefined ? fail(`No preset '${String(args.id)}'`) : ok,
    prepare: loadPresetOps,
    apply: (_ctx, args, impl) => impl.deletePreset(app, deps, args.id),
  };

  return [
    resetWorkspace,
    showPanel,
    toggleTimeline,
    toggleChrome,
    toggleFocus,
    applyPreset,
    savePreset,
    renamePreset,
    deletePreset,
  ].map((def) => ({ kind: 'operator', def: def as OperatorDef<unknown, unknown, unknown> }) as const);
}

/** `view.toggleMaximize`'s panel form over this shell's dockview groups (the host's operator asks it). */
export function shellMaximizePort(workspace: WorkspaceApi): MaximizePort {
  return {
    toggle: (panel) => workspace.toggleMaximize({ kind: panel }),
    restore: () => workspace.hasMaximized() && workspace.toggleMaximize({}),
  };
}

export function registerShellOperators(app: EditorApp, deps: ShellOperatorDeps): Disposer {
  const disposers = shellOperatorDefs(app, deps).map((contribution) => app.contribute(contribution));
  disposers.push(provideMaximizePort(app, shellMaximizePort(deps.workspace)));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
