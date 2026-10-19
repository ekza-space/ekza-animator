// M6a test API, B9 group (M6A-SPEC §4.8): workspaces, pixels, key resolution, marking menus, the command palette.
import type { KeyInput, MarkingMenuDef } from '@ekza-animator/editor-core';
import { scopeChain } from '../../input/keyboard';
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type ShellWorkspacesTestApi = Pick<
  EkzaAnimatorTestApi,
  'workspaces' | 'pixel' | 'resolveKey' | 'markingMenu' | 'commandPalette'
>;

/**
 * The e2e fixture marking menu (`?e2e=1&mmFixture=1`, M6A-B9-21): a plain-RMB menu in Model, so the shell e2e proves
 * in real Chrome that a right-button press opens a registered menu while a `contextmenu` event alone opens nothing,
 * before B10/B11 register the real menus. Only e2e pages that ask for it have it.
 */
export const E2E_FIXTURE_MENU: MarkingMenuDef = {
  id: 'e2e.fixture',
  trigger: { button: 'rmb', mods: 'none' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: {
    N: { label: 'Wireframe', op: 'view.shading', args: { mode: 'wire' } },
    S: { label: 'Shaded', op: 'view.shading', args: { mode: 'shaded' } },
    E: { label: 'Later', disabledReason: 'Arrives later (fixture)' },
  },
  list: [{ label: 'Lit', op: 'view.shading', args: { mode: 'lit' } }],
};

export function shellWorkspacesTestApi(ctx: M6aTestApiContext): ShellWorkspacesTestApi {
  const { app } = ctx.shell;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mmFixture') === '1') {
    app.contribute({ kind: 'markingMenu', def: E2E_FIXTURE_MENU });
  }
  return {
    workspaces() {
      const active = app.session.getState().workspace;
      return [...app.workspaces.list()]
        .sort((a, b) => a.order - b.order)
        .map((def) => {
          const status = (def.enabled ? def.status?.(app) : undefined) ?? { glyph: 'none' as const, reasons: [] };
          return {
            id: def.id,
            label: def.label,
            enabled: def.enabled,
            active: def.id === active,
            glyph: status.glyph,
            reasons: [...status.reasons],
          };
        });
    },
    pixel(paneId, x, y) {
      ctx.sync();
      const vm = ctx.shell.ui.getState().viewport;
      const rect = vm?.paneRect(paneId) ?? null;
      if (vm === null || rect === null) return [0, 0, 0, 0];
      if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) return [0, 0, 0, 0];
      return vm.readPixel(x, y) ?? [0, 0, 0, 0];
    },
    resolveKey(chord, at) {
      const mac = app.keymap.platform === 'mac';
      const mod = chord.mod === true;
      const input: KeyInput = {
        code: chord.code,
        ctrlKey: chord.ctrl === true || (!mac && mod),
        metaKey: mac && mod,
        shiftKey: chord.shift === true,
        altKey: chord.alt === true,
        repeat: false,
      };
      // The keyboard adapter's chain (§5.17, B0b): hierarchical in Model, `<panel>` → `global` in Animate.
      const { scopes } = scopeChain(app, { kind: at.panel, scope: at.panel, paneId: at.paneId ?? null });
      const binding = app.keymap.resolve(input, scopes, 'press');
      return binding === null ? null : { op: binding.op, args: binding.args, scope: binding.scope };
    },
    markingMenu() {
      const menus = ctx.shell.markingMenus;
      const open = menus.state.getState().open;
      if (open === null) return null;
      const view = (entry: { label: string; op: string | null; enabled: boolean }) => ({
        label: entry.label,
        op: entry.op,
        enabled: entry.enabled,
      });
      const slots: Record<string, { label: string; op: string | null; enabled: boolean }> = {};
      for (const [slot, entry] of Object.entries(open.slots)) if (entry !== undefined) slots[slot] = view(entry);
      const screenOfSlot: Record<string, { x: number; y: number }> = {};
      for (const [slot, point] of Object.entries(menus.screenOfSlot())) {
        if (point !== undefined) screenOfSlot[slot] = { x: point.x, y: point.y };
      }
      return { id: open.def.id, slots, list: open.list.map(view), screenOfSlot };
    },
    commandPalette() {
      const palette = ctx.shell.commandPalette;
      const state = palette.state.getState();
      return {
        open: state.open,
        query: state.query,
        items: palette.items().map((entry) => ({ op: entry.op, label: entry.label, enabled: entry.enabled })),
      };
    },
  };
}
