import { EkzaError } from '@ekza-animator/anim-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPanelRegistry, type PanelDef, registerBuiltinPanels } from '../src';
import { PanelHarness } from '../src/testing';
import { byTestId, readSynthetic, render, update } from './render';

let snapshot: unknown;
let skeleton: unknown;
beforeAll(async () => {
  snapshot = await readSynthetic('wave-doc.json');
  skeleton = await readSynthetic('humanoid-skeleton.json');
});

const text = (container: HTMLElement, id: string): string | null => byTestId(container, id).textContent;

describe('createPanelRegistry', () => {
  const panel = (id: string): PanelDef => ({ id, kind: id, title: id, component: () => null, keyScope: id });

  it('lists panels in registration order and refuses duplicate ids', () => {
    const registry = createPanelRegistry();
    registry.register(panel('b'));
    const disposeA = registry.register(panel('a'));
    expect(registry.list().map((def) => def.id)).toEqual(['b', 'a']);
    expect(() => registry.register(panel('a'))).toThrow(EkzaError);
    disposeA();
    expect(registry.get('a')).toBeUndefined();
    const replacement = panel('a');
    registry.register(replacement);
    disposeA(); // a stale disposer leaves the newer definition alone
    expect(registry.get('a')).toBe(replacement);
  });

  it('registers the built-in panels through registerBuiltinPanels', () => {
    const registry = createPanelRegistry();
    const dispose = registerBuiltinPanels(registry);
    const ids = registry.list().map((def) => def.id);
    dispose();
    expect(registry.list().filter((def) => ids.includes(def.id))).toEqual([]);
  });
});

describe('PanelHarness (/dev/panels)', () => {
  it('shows the panel index with the dev.state panel, and reports unknown ids', async () => {
    const index = await render(<PanelHarness snapshot={snapshot} skeleton={skeleton} panel={null} />);
    expect(byTestId(index.container, 'dev-panels-link-dev.state').getAttribute('href')).toBe('?panel=dev.state');
    expect(index.container.querySelector('[data-testid="dev-panels-unknown"]')).toBeNull();
    await index.unmount();
    const unknown = await render(<PanelHarness snapshot={snapshot} skeleton={skeleton} panel="nope" />);
    expect(text(unknown.container, 'dev-panels-unknown')).toContain("'nope'");
    await unknown.unmount();
  });

  it('mounts dev.state with the fake app: evaluation, frame stepping, document edits and undo', async () => {
    const view = await render(<PanelHarness snapshot={snapshot} skeleton={skeleton} panel="dev.state" />);
    const { container } = view;
    expect(text(container, 'dev-panels-title')).toBe('Fake app state');
    expect(text(container, 'dev-state-count-keys')).toBe('3');
    expect(text(container, 'dev-state-count-controls')).toBe('27');
    expect(text(container, 'dev-state-frame')).toBe('0');
    expect(text(container, 'dev-state-value-fk.lowerArm.L-rz')).toBe('30.000');

    for (let i = 0; i < 15; i++) await update(() => byTestId(container, 'dev-state-next').click());
    expect(text(container, 'dev-state-frame')).toBe('15');
    expect(text(container, 'dev-state-value-fk.lowerArm.L-rz')).toBe('-30.000');

    await update(() => byTestId(container, 'dev-state-offset').click());
    expect(text(container, 'dev-state-value-fk.lowerArm.L-rz')).toBe('-20.000');
    expect(text(container, 'dev-state-undo-label')).toBe('Offset Keys');
    await update(() => byTestId(container, 'dev-state-undo').click());
    expect(text(container, 'dev-state-value-fk.lowerArm.L-rz')).toBe('-30.000');
    expect((byTestId(container, 'dev-state-undo') as HTMLButtonElement).disabled).toBe(true);

    const exposed = window.__EKZA_DEV_PANELS__;
    expect(exposed?.app.store.list('characters')).toHaveLength(1);
    expect(exposed?.panels.get('dev.state')?.title).toBe('Fake app state');
    await view.unmount();
    expect(window.__EKZA_DEV_PANELS__).toBeUndefined();
  });

  it('reads the panel id from the URL when no prop is given', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('panel', 'dev.state');
    window.history.replaceState(null, '', url);
    try {
      const view = await render(<PanelHarness snapshot={snapshot} skeleton={skeleton} />);
      expect(text(view.container, 'dev-panels-title')).toBe('Fake app state');
      await view.unmount();
    } finally {
      url.searchParams.delete('panel');
      window.history.replaceState(null, '', url);
    }
  });

  it('refuses data that is not a document snapshot', async () => {
    const restore = console.error;
    console.error = () => {}; // React reports the failed render
    try {
      await expect(
        render(<PanelHarness snapshot={{ format: 'other' }} skeleton={null} panel={null} />),
      ).rejects.toThrow('not an ekza-animator-doc snapshot');
    } finally {
      console.error = restore;
    }
  });
});
