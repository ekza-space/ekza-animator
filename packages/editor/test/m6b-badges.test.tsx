// M6B-SPEC §0.5 (C0): the viewport badge slot — a registered provider's label shows while non-null and follows its
// notifications; the disposer removes it; providers draw in registration order.
import type { EditorApp, ViewportBadgeProvider } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { registerViewportBadge, ViewportBadges } from '../src/panels/viewport/hud/badges';
import { render, update } from './render';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function provider(id: string, initial: string | null) {
  let label = initial;
  const listeners = new Set<() => void>();
  const def: ViewportBadgeProvider = {
    id,
    label: () => label,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    def,
    set(next: string | null) {
      label = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('the viewport badge slot (§0.5)', () => {
  it('draws non-null labels in registration order, follows notifications and removes disposed providers', async () => {
    const app = {} as EditorApp;
    const view = await render(<ViewportBadges app={app} paneId="pane-persp" />);
    const badges = () =>
      [...view.container.querySelectorAll('[data-testid^="hud-badge-"]')].map((node) => [
        node.getAttribute('data-testid'),
        node.textContent,
      ]);
    expect(badges()).toEqual([]);
    const bind = provider('bind', 'BIND');
    const preview = provider('preview', null);
    await update(() => {
      disposers.push(registerViewportBadge(bind.def));
    });
    const offPreview = registerViewportBadge(preview.def);
    await update(() => preview.set('PREVIEW Walk'));
    expect(badges()).toEqual([
      ['hud-badge-bind-pane-persp', 'BIND'],
      ['hud-badge-preview-pane-persp', 'PREVIEW Walk'],
    ]);
    await update(() => bind.set(null));
    expect(badges()).toEqual([['hud-badge-preview-pane-persp', 'PREVIEW Walk']]);
    await update(() => offPreview());
    expect(badges()).toEqual([]);
    await view.unmount();
  });
});
