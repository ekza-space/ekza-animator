// M6a test API, B9 group (M6A-SPEC §4.8): workspaces, pixels, key resolution, marking menus, the command palette.
// B0a: `workspaces` and `resolveKey` are kernel-level and work; the others throw until B9 lands them.
import type { KeyInput } from '@ekza-animator/editor-core';
import { scopeChain } from '../../input/keyboard';
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type ShellWorkspacesTestApi = Pick<
  EkzaAnimatorTestApi,
  'workspaces' | 'pixel' | 'resolveKey' | 'markingMenu' | 'commandPalette'
>;

export function shellWorkspacesTestApi(ctx: M6aTestApiContext): ShellWorkspacesTestApi {
  const { app } = ctx.shell;
  return {
    workspaces() {
      const active = app.session.getState().workspace;
      return [...app.workspaces.list()]
        .sort((a, b) => a.order - b.order)
        .map((def) => {
          const status = def.status?.(app) ?? { glyph: 'none' as const, reasons: [] };
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
    pixel: () => notImplemented('B9', 'pixel'),
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
    markingMenu: () => notImplemented('B9', 'markingMenu'),
    commandPalette: () => notImplemented('B9', 'commandPalette'),
  };
}
