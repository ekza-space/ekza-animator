// Graph Editor panel (MVP-SPEC §7 WP-6) over the shared test kit's fake app and the synthetic wave document.
import { EkzaError, tangentFields } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId, DocSnapshot, KeyId } from '@ekza-animator/doc';
import { type KeyPartSelection, PANEL, parseNumericInput } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createPanelRegistry, EditorAppProvider } from '../../src';
import { focusedGraphEditor, GraphPanel, graphTestHooks, registerGraphPanel } from '../../src/panels/graph';
import { MIXED_SCALE_ERROR } from '../../src/panels/graph/model';
import { byTestId, type Rendered, readSynthetic, render, update } from '../render';

const CURVE = 'crv_SyntheticWave001' as CurveId;
const CLIP = 'clp_SyntheticWave001' as ClipId;
const LOWER_ARM = 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId;
const UPPER_ARM = 'rig_SyntheticWave001:fk.upperArm.L' as ControlId;
const KEYS = ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'] as unknown as readonly [KeyId, KeyId, KeyId];

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}
/** WP-7a numeric input parser (field entry) and WP-1 tangent fields (angle/weight display) are implemented. */
const NUMERIC_READY = implemented(() => parseNumericInput('1', 0));
const TANGENT_FIELDS_READY = implemented(() => tangentFields({ dt: 1, dv: 0 }, 'out', { num: 30, den: 1 }, 1));

let snapshot: DocSnapshot;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
});

let view: Rendered | null = null;
let app: FakeEditorApp;
afterEach(async () => {
  await view?.unmount();
  view = null;
  app.dispose();
});

async function mountPanel(): Promise<HTMLElement> {
  app = createFakeEditorApp({ snapshot });
  view = await render(
    <EditorAppProvider app={app}>
      <div style={{ width: 1100, height: 420 }}>
        <GraphPanel app={app} instanceId="graph#1" />
      </div>
    </EditorAppProvider>,
  );
  await settle();
  return view.container;
}

/** Lets frames, observers and pending operator runs settle inside act(). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Sets the key selection (the panel re-renders its fields; see `quietly`). */
function select(keys: readonly (readonly [KeyId, Partial<KeyPartSelection>])[]): Promise<void> {
  return quietly(() =>
    update(() => {
      const selection = app.session.getState().selection;
      app.session.setState({
        selection: {
          ...selection,
          keys: new Map(keys.map(([key, parts]) => [key, { key: false, in: false, out: false, ...parts }])),
        },
      });
    }),
  );
}

/** Runs `fn` with the expected render-error reports of the stubbed tangent fields silenced (WP-1 not landed). */
async function quietly(fn: () => Promise<void>): Promise<void> {
  if (TANGENT_FIELDS_READY) return inAct(fn);
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await inAct(fn);
    await settle();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

/** Runs a user interaction inside act() so React flushes the renders it causes. */
async function inAct(fn: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await fn();
  });
}

const callsOf = (id: string): unknown[] => app.calls.filter((call) => call.id === id).map((call) => call.args);
const input = (container: HTMLElement, id: string): HTMLInputElement => byTestId(container, id) as HTMLInputElement;

describe('registerGraphPanel', () => {
  it('registers the Graph Editor panel with the graph key scope', () => {
    const registry = createPanelRegistry();
    const dispose = registerGraphPanel(registry);
    expect(registry.get('graph')).toMatchObject({ id: 'graph', kind: PANEL.graph, keyScope: PANEL.graph });
    expect(registry.get('graph')?.title).toBe('Graph Editor');
    dispose();
    expect(registry.get('graph')).toBeUndefined();
    app = createFakeEditorApp();
  });
});

describe('GraphPanel', () => {
  it('lists the animated controls when nothing is selected, shows their curves and registers the graph tools', async () => {
    const container = await mountPanel();
    expect(byTestId(container, `ge-row-${LOWER_ARM}`).textContent).toContain('L Lower Arm');
    expect(byTestId(container, `ge-row-${LOWER_ARM}/rz`).textContent).toContain('Rotate Z');
    expect(container.querySelector(`[data-testid="ge-row-${UPPER_ARM}"]`)).toBeNull();
    expect(app.tools.list('graph').map((tool) => tool.id)).toEqual(['select', 'move', 'insert']);
    expect(app.operators.get('graph.frame')).toBeDefined();
    const hooks = graphTestHooks(app);
    const graph = hooks.graph();
    expect(graph?.visibleCurves).toEqual([CURVE]);
    const canvas = byTestId(container, 'ge-canvas').getBoundingClientRect();
    expect(graph?.canvasRect).toEqual({ x: canvas.left, y: canvas.top, w: canvas.width, h: canvas.height });
    const key = hooks.screenOfKey(KEYS[1]);
    expect(key?.x).toBeGreaterThan(canvas.left);
    expect(key?.x).toBeLessThan(canvas.right);
    expect(hooks.screenOfHandle(KEYS[1], 'out')).toBeNull();
    expect(hooks.screenOfCurve(CURVE, 7.5)).not.toBeNull();
  });

  it('follows the selected controls (auto load) and the channel selection', async () => {
    const container = await mountPanel();
    await update(() => {
      const selection = app.session.getState().selection;
      app.session.setState({ selection: { ...selection, controls: [UPPER_ARM, LOWER_ARM] } });
    });
    await settle();
    expect(byTestId(container, `ge-row-${UPPER_ARM}`)).toBeDefined();
    await update(() => byTestId(container, `ge-row-${LOWER_ARM}/rx`).click());
    expect(app.session.getState().selection.channels).toEqual([{ control: LOWER_ARM, channel: 'rx' }]);
    // rx has no curve, so every listed curve stays visible; selecting rz isolates its curve.
    await update(() => byTestId(container, `ge-row-${LOWER_ARM}/rz`).click());
    await settle();
    expect(graphTestHooks(app).graph()?.visibleCurves).toEqual([CURVE]);
    expect(byTestId(container, `ge-row-${LOWER_ARM}/rz`).getAttribute('aria-selected')).toBe('true');
  });

  it('hides curves with the eye, filters rows and shows only animated channels', async () => {
    const container = await mountPanel();
    await update(() => byTestId(container, `ge-eye-${LOWER_ARM}/rz`).click());
    await settle();
    expect(graphTestHooks(app).graph()?.visibleCurves).toEqual([]);
    await update(() => byTestId(container, `ge-eye-${LOWER_ARM}/rz`).click());
    await settle();
    expect(graphTestHooks(app).graph()?.visibleCurves).toEqual([CURVE]);

    await update(() => byTestId(container, 'ge-only-animated').click());
    expect(container.querySelector(`[data-testid="ge-row-${LOWER_ARM}/rx"]`)).toBeNull();
    expect(byTestId(container, `ge-row-${LOWER_ARM}/rz`)).toBeDefined();
    await inAct(() => userEvent.fill(input(container, 'ge-channel-filter'), 'nothing matches'));
    await settle();
    expect(container.querySelector(`[data-testid="ge-row-${LOWER_ARM}"]`)).toBeNull();
  });

  it('locks channels and double-click selects a curve through operators', async () => {
    const container = await mountPanel();
    await update(() => byTestId(container, `ge-lock-${LOWER_ARM}/rz`).click());
    await settle();
    expect(callsOf('channel.toggleLock')).toEqual([{ refs: [{ control: LOWER_ARM, channel: 'rz' }], locked: true }]);
    await quietly(() => userEvent.dblClick(byTestId(container, `ge-row-${LOWER_ARM}/rz`)));
    expect(callsOf('select.curveKeys')).toEqual([{ curve: CURVE, mode: 'replace' }]);
    expect(app.session.getState().selection.keys.size).toBe(3);
  });

  it('runs toolbar operators: tools, tangents, break/unify, weighted, lock weight, infinity, filters', async () => {
    const container = await mountPanel();
    expect((byTestId(container, 'ge-break') as HTMLButtonElement).disabled).toBe(true);
    await update(() => byTestId(container, 'ge-tool-insert').click());
    await update(() => byTestId(container, 'ge-tangent-linear').click());
    await update(() => byTestId(container, 'ge-tangent-stepNext').click());
    await update(() => byTestId(container, 'ge-weighted').click());
    await update(() => byTestId(container, 'ge-euler-filter').click());
    await update(() => byTestId(container, 'ge-simplify').click());
    await inAct(() => userEvent.selectOptions(byTestId(container, 'graph-infinity-post'), 'cycle'));
    await inAct(() => userEvent.selectOptions(byTestId(container, 'graph-infinity-pre'), 'oscillate'));
    await select([[KEYS[1], { key: true }]]);
    await update(() => byTestId(container, 'ge-break').click());
    await update(() => byTestId(container, 'ge-unify').click());
    await update(() => byTestId(container, 'ge-lock-weight').click());
    await settle();
    expect(app.calls.map((call) => [call.id, call.args])).toEqual([
      ['view.tool', { panel: 'graph', tool: 'insert' }],
      ['graph.tangent.set', { type: 'linear' }],
      ['graph.tangent.set', { type: 'stepNext' }],
      ['graph.curve.setWeighted', { weighted: true }],
      ['graph.eulerFilter', undefined],
      ['graph.curves.simplify', undefined],
      ['graph.infinity.set', { post: 'cycle' }],
      ['graph.infinity.set', { pre: 'oscillate' }],
      ['graph.tangent.break', undefined],
      ['graph.tangent.unify', undefined],
      ['graph.tangent.lockWeight', { locked: false }],
    ]);
    // Unknown operators (the fake app registers none of 7b's) come back as info toasts.
    expect((app.services as unknown as { toasts: readonly { kind: string }[] }).toasts.at(-1)?.kind).toBe('info');
    expect((byTestId(container, 'graph-infinity-post') as HTMLSelectElement).value).toBe('constant');
  });

  it('shows the frame and value of the selected keys, "—" when they differ', async () => {
    const container = await mountPanel();
    expect(input(container, 'ge-field-frame').disabled).toBe(true);
    await select([[KEYS[1], { key: true }]]);
    await settle();
    expect(input(container, 'ge-field-frame').value).toBe('15');
    expect(input(container, 'ge-field-value').value).toBe('-30.000');
    await select([
      [KEYS[0], { key: true }],
      [KEYS[1], { key: true }],
    ]);
    await settle();
    expect(input(container, 'ge-field-frame').value).toBe('');
    expect(input(container, 'ge-field-frame').placeholder).toBe('—');
  });

  it('refuses × and ÷ on keys with different values and keeps the document', async () => {
    const container = await mountPanel();
    await select([
      [KEYS[0], { key: true }],
      [KEYS[1], { key: true }],
    ]);
    await settle();
    for (const [field, text] of [
      ['ge-field-value', '*=2'],
      ['ge-field-value', '*2'],
      ['ge-field-frame', '/2'],
    ] as const) {
      await inAct(() => userEvent.fill(input(container, field), text));
      await inAct(() => userEvent.keyboard('{Enter}'));
      expect(input(container, field).getAttribute('aria-invalid')).toBe('true');
      expect(input(container, field).title).toBe(MIXED_SCALE_ERROR);
    }
    expect(callsOf('graph.keys.setFields')).toEqual([]);
  });

  it.skipIf(!NUMERIC_READY)(
    '[needs WP-7a] typed fields run graph.keys.setFields (relative on mixed values)',
    async () => {
      const container = await mountPanel();
      await select([[KEYS[1], { key: true }]]);
      await settle();
      await inAct(() => userEvent.fill(input(container, 'ge-field-value'), '30'));
      await inAct(() => userEvent.keyboard('{Enter}'));
      await inAct(() => userEvent.fill(input(container, 'ge-field-frame'), '18'));
      await inAct(() => userEvent.keyboard('{Enter}'));
      await select([
        [KEYS[0], { key: true }],
        [KEYS[1], { key: true }],
      ]);
      await settle();
      await inAct(() => userEvent.fill(input(container, 'ge-field-value'), '+=10'));
      await inAct(() => userEvent.keyboard('{Enter}'));
      await inAct(() => userEvent.fill(input(container, 'ge-field-frame'), 'not a number'));
      await inAct(() => userEvent.keyboard('{Enter}'));
      await settle();
      expect(callsOf('graph.keys.setFields')).toEqual([{ value: 30 }, { frame: 18 }, { value: 10, relative: true }]);
      expect(input(container, 'ge-field-frame').getAttribute('aria-invalid')).toBe('true');
    },
  );

  it.skipIf(!TANGENT_FIELDS_READY)('[needs WP-1] shows the in/out angles of the selected key', async () => {
    const container = await mountPanel();
    await select([[KEYS[1], { key: true }]]);
    await settle();
    // Key 15 is a flat extreme of the auto curve; weights apply to weighted curves only.
    expect(input(container, 'ge-field-in-angle').value).toBe('0.000');
    expect(input(container, 'ge-field-out-angle').value).toBe('0.000');
    expect(input(container, 'ge-field-in-weight').disabled).toBe(true);
    expect(input(container, 'ge-field-out-weight').disabled).toBe(true);
  });

  it.skipIf(TANGENT_FIELDS_READY)(
    'falls back to a notice while the curve engine has no tangent fields (WP-1)',
    async () => {
      const container = await mountPanel();
      await select([[KEYS[1], { key: true }]]);
      await settle();
      expect(byTestId(container, 'ge-fields-unavailable').textContent).toContain('unavailable');
      expect(input(container, 'ge-field-frame').value).toBe('15');
    },
  );

  it('turns DOM double-clicks on the curve into select.curveKeys and wheel events into zoom', async () => {
    const container = await mountPanel();
    const canvas = byTestId(container, 'ge-canvas');
    const rect = canvas.getBoundingClientRect();
    const point = graphTestHooks(app).screenOfCurve(CURVE, 7.5);
    if (point === null) throw new Error('curve not on screen');
    await quietly(() => userEvent.dblClick(canvas, { position: { x: point.x - rect.left, y: point.y - rect.top } }));
    expect(callsOf('select.curveKeys')).toEqual([{ curve: CURVE, mode: 'replace' }]);
    expect([...app.session.getState().selection.keys.keys()]).toEqual([...KEYS]);
    await settle();
    expect(graphTestHooks(app).screenOfHandle(KEYS[1], 'out')).not.toBeNull();

    const before = graphTestHooks(app).graph()?.view;
    await inAct(() => userEvent.wheel(canvas, { delta: { y: -100 } }));
    await settle();
    expect(graphTestHooks(app).graph()?.view.sx).toBeGreaterThan(before?.sx ?? Number.POSITIVE_INFINITY);
  });

  it('maps DOM pointer drags to a marquee, and Esc on the window cancels a navigation drag', async () => {
    const container = await mountPanel();
    const canvas = byTestId(container, 'ge-canvas');
    const hooks = graphTestHooks(app);
    const k0 = hooks.screenOfKey(KEYS[0]);
    const k15 = hooks.screenOfKey(KEYS[1]);
    if (k0 === null || k15 === null) throw new Error('keys not on screen');
    const fire = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 7,
          bubbles: true,
          ...init,
        }),
      );
    };
    const top = Math.min(k0.y, k15.y) - 12;
    const bottom = Math.max(k0.y, k15.y) + 12;
    await inAct(async () => {
      fire('pointerdown', k0.x - 12, top);
      fire('pointermove', (k0.x + k15.x) / 2, (top + bottom) / 2);
      fire('pointermove', k15.x + 12, bottom);
      fire('pointerup', k15.x + 12, bottom);
    });
    await settle();
    expect(callsOf('select.keys').at(-1)).toEqual({
      items: [
        { key: KEYS[0], parts: { key: true, in: false, out: false } },
        { key: KEYS[1], parts: { key: true, in: false, out: false } },
      ],
      mode: 'replace',
    });

    const before = hooks.graph()?.view;
    fire('pointerdown', 300, 200, { button: 1, buttons: 4, altKey: true });
    fire('pointermove', 360, 230, { button: 1, buttons: 4, altKey: true });
    expect(hooks.graph()?.view).not.toEqual(before);
    const escape = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(hooks.graph()?.view).toEqual(before);
    fire('pointerup', 360, 230, { button: 1, buttons: 0 });
  });

  it('frames from the toolbar and removes its contributions when the last Graph Editor unmounts', async () => {
    const container = await mountPanel();
    const framed = graphTestHooks(app).graph()?.view;
    await inAct(() => userEvent.wheel(byTestId(container, 'ge-canvas'), { delta: { y: 200 } }));
    await settle();
    expect(graphTestHooks(app).graph()?.view).not.toEqual(framed);
    await update(() => byTestId(container, 'ge-frame-all').click());
    expect(graphTestHooks(app).graph()?.view.sx).toBeCloseTo(framed?.sx ?? 0, 9);
    expect(await app.run('graph.frame', { what: 'all' })).toMatchObject({ status: 'finished' });
    expect(focusedGraphEditor(app)).not.toBeNull();
    await view?.unmount();
    view = null;
    expect(focusedGraphEditor(app)).toBeNull();
    expect(app.tools.list('graph')).toEqual([]);
    expect(app.operators.get('graph.frame')).toBeUndefined();
    expect(graphTestHooks(app).graph()).toBeNull();
    expect(CLIP).toBe('clp_SyntheticWave001');
  });
});
