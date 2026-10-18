// The Dope Sheet panel (M2A-SPEC §5.10, §7, §4.8; A3) in Vitest browser mode: the React.lazy body loads only once
// the panel's box is shown, the contributions are registered by the wrapper, the toolbar runs its operators, the row
// labels select and expand, the probe answers in page px, and Show and the expansion persist with the layout.
import type { ControlId, KeyId } from '@ekza-animator/doc';
import { PANEL, registerBuiltinOperators } from '@ekza-animator/editor-core';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DopeSheetPanel } from '../../src/panels/dopesheet/DopeSheetPanel';
import { dopeSheetProbe } from '../../src/panels/dopesheet/DopeSheetView';
import { focusedDopeSheet } from '../../src/panels/dopesheet/focus';
import { render, update } from '../render';
import { createTestShell, ShellFrame, waitFor, waveFixtures } from '../shell-helpers';
import { by, callsOf, cleanup, loadFixtures, maybe, mount, transact, UPPER_ARM_L, waveApp } from './helpers';

beforeAll(async () => {
  await loadFixtures();
});
afterEach(async () => {
  await cleanup();
});

const HAND = 'rig_SyntheticWave001:fk.hand.L' as ControlId;
const LOWER = 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId;

/** A box whose size the test controls (0 × 0 = a hidden dock tab; `resize` changes it). */
function Box(props: { readonly size: number; readonly children: React.ReactNode }) {
  return (
    <div
      data-testid="box"
      style={{ width: props.size * 2, height: props.size, position: 'relative', overflow: 'hidden' }}
    >
      {props.children}
    </div>
  );
}

async function resize(size: number): Promise<void> {
  await act(async () => {
    by('box').style.width = `${size * 2}px`;
    by('box').style.height = `${size}px`;
  });
}

/** Polls with a name, so a timeout says what it waited for. */
async function until(what: string, predicate: () => boolean): Promise<void> {
  try {
    await waitFor(predicate, 5000);
  } catch {
    throw new Error(`timed out waiting for ${what}`);
  }
}

async function waitForCanvas(): Promise<void> {
  await waitFor(() => maybe('ds-canvas') !== null && by('ds-canvas').getBoundingClientRect().width > 0, 5000);
}

describe('the lazy boundary (§5.21.2 boundary 4)', () => {
  it('registers the contributions at once and loads the body only when the box is shown', async () => {
    const app = waveApp();
    registerBuiltinOperators(app);
    await mount(
      app,
      <Box size={0}>
        <DopeSheetPanel app={app} instanceId="dopeSheet" />
      </Box>,
      { width: 900, height: 400 },
    );
    expect(app.operators.get('dopeSheet.frame')).toBeDefined();
    expect(app.tools.get(PANEL.dopeSheet, 'scale')).toBeDefined();
    expect(app.operators.poll('dopeSheet.frame', {}, { what: 'all' })).toEqual({
      ok: false,
      reason: 'The Dope Sheet is not open',
    });
    await update(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(maybe('ds-canvas')).toBeNull();
    expect(focusedDopeSheet(app)).toBeNull();

    await resize(300);
    await waitForCanvas();
    expect(focusedDopeSheet(app)).not.toBeNull();
    expect(app.operators.poll('dopeSheet.frame', {}, { what: 'all' })).toBe(true);
  });
});

describe('the panel body', () => {
  async function mountSheet() {
    const app = waveApp({ platform: 'mac' });
    registerBuiltinOperators(app);
    await mount(
      app,
      <Box size={320}>
        <DopeSheetPanel app={app} instanceId="dopeSheet" />
      </Box>,
      { width: 900, height: 400 },
    );
    await waitForCanvas();
    return app;
  }

  it('lists the rows as labels; the expand toggle shows channel rows', async () => {
    const app = await mountSheet();
    await waitFor(() => maybe('ds-row-summary') !== null);
    expect(maybe(`ds-row-${LOWER}`)?.textContent).toContain('L Lower Arm');
    expect(maybe(`ds-row-${LOWER}/rz`)).toBeNull();
    await act(async () => by(`ds-expand-${LOWER}`).click());
    await waitFor(() => maybe(`ds-row-${LOWER}/rz`) !== null);
    expect(by(`ds-row-${LOWER}/rz`).textContent).toContain('Rotate Z');
    expect(app.calls).toBeDefined();
  });

  it('a click on a control label selects it; a double-click selects every key of the row', async () => {
    const app = await mountSheet();
    await waitFor(() => maybe(`ds-row-${LOWER}`) !== null);
    await act(async () => by(`ds-row-${LOWER}`).click());
    expect(callsOf(app, 'select.controls')).toEqual([{ ids: [LOWER], mode: 'replace' }]);
    await act(async () => {
      by('ds-row-summary').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const selected = [...app.session.getState().selection.keys.keys()].sort();
    expect(selected).toEqual(
      app.store.query
        .keysOfCurve('crv_SyntheticWave001' as never)
        .map((key) => key.id)
        .sort(),
    );
  });

  it('the toolbar runs the tools, Ripple and Frame; Snap toggles the session; Show switches the rows', async () => {
    const app = await mountSheet();
    await act(async () => by('ds-tool-move').click());
    await waitFor(() => app.session.getState().tools.dopeSheet === 'move');
    expect(by('ds-tool-move').getAttribute('aria-pressed')).toBe('true');
    await act(async () => by('ds-ripple').click());
    await waitFor(() => app.session.getState().tools.ripple);
    expect(by('ds-ripple').getAttribute('aria-pressed')).toBe('true');
    await act(async () => by('ds-snap').click());
    expect(app.session.getState().time.snapToFrames).toBe(false);
    await act(async () => by('ds-frame-all').click());
    await waitFor(() => callsOf(app, 'dopeSheet.frame').length === 1);
    expect(callsOf(app, 'dopeSheet.frame')).toEqual([{ what: 'all' }]);

    // Show: Selected (the default) lists the selected controls; Character every keyed control.
    await transact(app, (tx) => {
      const curve = tx.query.curveFor('clp_SyntheticWave001' as never, 'lay_SyntheticWave001' as never, LOWER, 'rz');
      if (curve === undefined) throw new Error('no wave curve');
      tx.put('curves', { ...curve, id: 'crv_HandCurve0000001' as never, control: HAND });
      tx.put('keys', {
        id: 'k_HandKey0000001' as KeyId,
        clip: 'clp_SyntheticWave001' as never,
        curve: 'crv_HandCurve0000001' as never,
        t: 3,
        v: 0,
        inType: 'auto',
        outType: 'auto',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      });
    });
    await act(async () =>
      app.session.setState({ selection: { ...app.session.getState().selection, controls: [HAND] } }),
    );
    await waitFor(() => maybe(`ds-row-${LOWER}`) === null && maybe(`ds-row-${HAND}`) !== null);
    const show = by('ds-show') as HTMLSelectElement;
    await act(async () => {
      show.value = 'character';
      show.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => maybe(`ds-row-${LOWER}`) !== null && maybe(`ds-row-${HAND}`) !== null);
    expect(maybe(`ds-row-${UPPER_ARM_L}`)).toBeNull();
  });

  it('the probe answers rows, glyph points inside the canvas and the region bar', async () => {
    const app = await mountSheet();
    const probe = dopeSheetProbe(app);
    await until('the probe glyph', () => probe.screenOfDopeKey('summary', 15) !== null);
    const state = probe.dopeSheet();
    expect(state?.rows[0]).toMatchObject({ id: 'summary', kind: 'summary', keys: [0, 15, 30], holds: [] });
    const rect = by('ds-canvas').getBoundingClientRect();
    expect(state?.canvasRect).toEqual({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    const point = probe.screenOfDopeKey('summary', 15);
    expect(point).not.toBeNull();
    expect(point!.x).toBeGreaterThan(rect.left);
    expect(point!.x).toBeLessThan(rect.right);
    expect(probe.screenOfDopeKey('summary', 14)).toBeNull();
    expect(probe.screenOfDopeRegion('middle')).toBeNull();
    // A click on the glyph selects the key; the region bar then exists.
    const canvas = by('ds-canvas');
    await act(async () => {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: point!.x,
            clientY: point!.y,
            button: 0,
            buttons: type === 'pointerdown' ? 1 : 0,
            pointerId: 3,
          }),
        );
      }
    });
    expect([...app.session.getState().selection.keys.keys()]).toHaveLength(1);
    expect(probe.screenOfDopeRegion('middle')).not.toBeNull();
  });
});

describe('persistence with the layout (§5.10)', () => {
  it('Show and the expansion are written to and restored from the dockview panel parameters', async () => {
    const fixtures = await waveFixtures();
    const { app, shell } = createTestShell(fixtures);
    registerBuiltinOperators(app);
    // The dockview panel of the Dope Sheet: dockview serializes `params` with the layout (A0's layout tests).
    const panel = {
      params: { kind: 'dopeSheet' } as Record<string, unknown>,
      api: {
        updateParameters(params: Record<string, unknown>) {
          panel.params = params;
        },
      },
    };
    const dockview = { getPanel: (id: string) => (id === 'dopeSheet' ? panel : undefined) };
    const withDockview = { ...shell, workspace: { ...shell.workspace, dockview } } as unknown as typeof shell;
    const tree = (
      <ShellFrame shell={withDockview}>
        <Box size={300}>
          <DopeSheetPanel app={app} instanceId="dopeSheet" />
        </Box>
      </ShellFrame>
    );
    const view = await render(tree);
    await until('the canvas', () => maybe('ds-canvas') !== null && by('ds-canvas').getBoundingClientRect().width > 0);
    const show = by('ds-show') as HTMLSelectElement;
    await act(async () => {
      show.value = 'character';
      show.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(panel.params['dopeSheet']).toEqual({ show: 'character', expanded: {} });
    await until('the lower arm row', () => maybe(`ds-expand-${LOWER}`) !== null);
    await act(async () => by(`ds-expand-${LOWER}`).click());
    expect(panel.params).toEqual({ kind: 'dopeSheet', dopeSheet: { show: 'character', expanded: { [LOWER]: true } } });
    await view.unmount();

    // Mounted again over the same parameters: Show and the expansion come back.
    const again = await render(tree);
    await until('the restored channel row', () => maybe(`ds-row-${LOWER}/rz`) !== null);
    expect((by('ds-show') as HTMLSelectElement).value).toBe('character');
    await again.unmount();
  });
});
