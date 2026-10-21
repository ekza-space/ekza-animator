// B0b test harness: the shell's real window listeners (`useWindowInput`) over fake panel frames, so tests press real
// `keydown`/`keyup` events and read what the keyboard adapter dispatched (`app.calls`).
import {
  ANIMATE_WORKSPACE,
  BUILTIN_MENU_ITEMS,
  type ComponentMode,
  MODEL_MENUS,
  registerBuiltinOperators,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type WorkspaceDef,
} from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { type JSX, useRef } from 'react';
import { PANE_ATTR, PANEL_ATTR } from '../../src/input/pointer';
import { useWindowInput } from '../../src/shell/useWindowInput';
import type { Shell } from '../../src/shell/types';
import { render, type Rendered, update } from '../render';
import { createTestShell, ShellFrame, type TestShell } from '../shell-helpers';

/** A Model workspace definition for tests (B9 registers the real one): key scope `model`, the §8.1 menu set. */
export const TEST_MODEL_WORKSPACE: WorkspaceDef = Object.freeze({
  ...ANIMATE_WORKSPACE,
  id: 'model',
  label: 'Model',
  shortLabel: 'Mdl',
  order: 0,
  keyScope: 'model',
  menus: MODEL_MENUS,
  timeline: false,
  layout: 'model-quad',
  pickMask: { controls: false, joints: false, meshes: true, groups: true },
});

function Harness(props: { readonly shell: Shell }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  useWindowInput(props.shell, root);
  const frame = { width: 300, height: 200 } as const;
  return (
    <div ref={root} style={{ display: 'flex', gap: 8 }}>
      <div {...{ [PANEL_ATTR]: 'viewport' }} data-testid="h-viewport" style={frame}>
        <div {...{ [PANE_ATTR]: 'pane-persp' }} data-testid="h-pane" style={frame} />
      </div>
      <div {...{ [PANEL_ATTR]: 'graph' }} data-testid="h-graph" style={frame} />
      <div {...{ [PANEL_ATTR]: 'outliner' }} data-testid="h-outliner" style={frame} />
    </div>
  );
}

export interface KeyHarness extends TestShell {
  readonly view: Rendered;
  /** Moves the pointer over a harness element (`pane`, `viewport`, `graph`, `outliner`). */
  hover(target: 'pane' | 'viewport' | 'graph' | 'outliner'): void;
  /** Presses the pointer over the hovered element (a gesture while a tap/hold key is down). */
  pointerDown(): void;
  /** Dispatches a real KeyboardEvent on the page; returns it (defaultPrevented tells what the adapter did). */
  key(type: 'keydown' | 'keyup', code: string, init?: KeyboardEventInit): KeyboardEvent;
  /** Down then up. */
  press(code: string, init?: KeyboardEventInit): KeyboardEvent;
  /** Operator ids run since the last call (and their args). */
  runs(): { readonly id: string; readonly args: unknown }[];
  enterModel(mode?: ComponentMode): void;
  setMode(mode: ComponentMode): void;
  /** Installs a fake active viewport tool: its `ToolDef.keys`, phase and the events its `key()` received. */
  fakeTool(opts: { readonly keys?: readonly string[]; readonly consumes?: (e: ToolKeyEvent) => boolean }): FakeTool;
}

export interface FakeTool {
  phase: ToolPhase;
  readonly events: ToolKeyEvent[];
}

export async function mountKeys(opts: { readonly platform?: 'mac' | 'other' } = {}): Promise<KeyHarness> {
  const test = createTestShell(opts.platform === undefined ? {} : { platform: opts.platform });
  const { app, shell } = test;
  registerBuiltinOperators(app);
  for (const def of BUILTIN_MENU_ITEMS) if (app.menus.get(def.id) === undefined) app.contribute({ kind: 'menu', def });
  app.contribute({ kind: 'workspace', def: TEST_MODEL_WORKSPACE });
  const view = await render(
    <ShellFrame shell={shell}>
      <Harness shell={shell} />
    </ShellFrame>,
  );
  let seen = app.calls.length;
  let hovered: HTMLElement = document.body;
  const element = (id: string): HTMLElement => {
    const found = view.container.querySelector<HTMLElement>(`[data-testid="h-${id}"]`);
    if (found === null) throw new Error(`no harness element ${id}`);
    return found;
  };
  const centre = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  };
  const key = (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent(type, { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init });
    hovered.ownerDocument.body.dispatchEvent(event);
    return event;
  };
  const setMode = (mode: ComponentMode): void => {
    const state = app.session.getState();
    app.session.setState({ model: { ...state.model, componentMode: mode } });
  };
  return {
    ...test,
    view,
    hover(target) {
      hovered = element(target);
      hovered.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...centre(hovered) }));
    },
    pointerDown() {
      hovered.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...centre(hovered) }));
    },
    key,
    press(code, init) {
      key('keydown', code, init);
      return key('keyup', code, init);
    },
    runs() {
      const out = app.calls.slice(seen).map((call) => ({ id: call.id, args: call.args }));
      seen = app.calls.length;
      return out;
    },
    enterModel(mode = 'object') {
      app.session.setState({ workspace: 'model' });
      setMode(mode);
    },
    setMode,
    fakeTool(toolOpts) {
      const tool: FakeTool = { phase: 'idle', events: [] };
      const instance: ToolInstance = {
        phase: () => tool.phase,
        key: (e) => {
          tool.events.push(e);
          return toolOpts.consumes?.(e) ?? false;
        },
      };
      app.contribute({
        kind: 'tool',
        def: {
          id: 'fakeTool',
          panel: 'viewport',
          label: 'Fake Tool',
          keys: toolOpts.keys ?? [],
          create: () => instance,
        },
      });
      app.session.setState({ tools: { ...app.session.getState().tools, viewport: 'fakeTool' } });
      const vm = { activeTool: () => instance, paneAt: () => null } as unknown as ViewportManager;
      shell.ui.setState({ viewport: vm });
      return tool;
    },
  };
}

export { update };
