// The shared Tween bar (M2A-SPEC §5.13, A4) over the shared test kit's fake app: a slider drag is one `Tween` step
// with a breakdown key at the frame (E2E-M2A-13 numbers), Esc cancels without a trace, the thumb springs back to 0,
// the target label follows the selection and toggles to the pose, presets run `key.tween`, and the overshoot toggle
// widens the slider to ±150. The status-line variant keeps its presets in an overflow menu.
import { DEG2RAD, RAD2DEG } from '@ekza-animator/anim-core';
import type { ControlId, CurveId, DocSnapshot, KeyId } from '@ekza-animator/doc';
import { ensureCurve, registerBuiltinOperators } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorAppProvider } from '../../src';
import { TweenBar } from '../../src/panels/shared/TweenBar';
import { byTestId, type Rendered, readSynthetic, render, update } from '../render';

const CLIP = 'clp_SyntheticWave001';
const HAND = 'rig_SyntheticWave001:fk.hand.L' as ControlId;

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

/** Hand rz keyed 0° at 0 and 60° at 20 (linear), the hand selected, frame 10; the bar of `panel` mounted. */
async function mountBar(panel: 'graph' | 'status' = 'graph'): Promise<{ curve: CurveId; keys: KeyId[] }> {
  app = createFakeEditorApp({ snapshot });
  registerBuiltinOperators(app);
  const made = app.store.transact({ label: 'setup' }, (tx) => {
    const curve = ensureCurve(app, tx, CLIP as never, HAND, 'rz');
    const keys = [
      [0, 0],
      [20, 60 * DEG2RAD],
    ].map(([t, v], i) => {
      const id = `k_TweenBar${String(i).padStart(5, '0')}` as KeyId;
      tx.put('keys', {
        id,
        clip: CLIP as never,
        curve,
        t: t as number,
        v: v as number,
        inType: 'linear',
        outType: 'linear',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      });
      return id;
    });
    return { curve, keys };
  });
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, controls: [HAND] },
    time: { ...state.time, sceneFrame: 10 },
  });
  view = await render(
    <EditorAppProvider app={app}>
      <div style={{ width: 900 }}>
        <TweenBar panel={panel} />
      </div>
    </EditorAppProvider>,
  );
  return made;
}

/** Client x of a slider amount (the track spans −limit…limit). */
function xOf(slider: HTMLElement, amount: number, limit = 100): { x: number; y: number } {
  const rect = slider.getBoundingClientRect();
  return { x: rect.left + ((amount + limit) / (2 * limit)) * rect.width, y: rect.top + rect.height / 2 };
}

async function pointer(target: HTMLElement, type: string, at: { x: number; y: number }): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
  });
}

function rzAt10(curve: CurveId): { v: number; breakdown: boolean | undefined } | null {
  const key = app.store.query.keysOfCurve(curve).find((k) => Math.abs(k.t - 10) < 1e-6);
  return key === undefined ? null : { v: key.v * RAD2DEG, breakdown: key.breakdown };
}

describe('TweenBar (§5.13)', () => {
  it('a slider drag from 0 to 50 sets a 45° breakdown at the frame in ONE Tween step; the thumb springs back', async () => {
    const { curve } = await mountBar();
    const slider = byTestId(document.body, 'tween-slider-graph');
    await pointer(slider, 'pointerdown', xOf(slider, 0));
    expect(rzAt10(curve)?.v).toBeCloseTo(30, 9); // preview at 0: the in-between
    await pointer(slider, 'pointermove', xOf(slider, 25));
    await pointer(slider, 'pointermove', xOf(slider, 50));
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
    await pointer(slider, 'pointerup', xOf(slider, 50));
    expect(rzAt10(curve)?.v).toBeCloseTo(45, 9);
    expect(rzAt10(curve)?.breakdown).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Tween');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    await update(() => app.history.undo());
    expect(rzAt10(curve)).toBeNull();
    expect(app.evaluation.channelValue(HAND, 'rz') * RAD2DEG).toBeCloseTo(30, 9);
  });

  it('Esc during a drag cancels without a trace', async () => {
    const { curve } = await mountBar();
    const before = JSON.stringify(app.store.snapshot());
    const slider = byTestId(document.body, 'tween-slider-graph');
    await pointer(slider, 'pointerdown', xOf(slider, 0));
    await pointer(slider, 'pointermove', xOf(slider, 80));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    });
    await pointer(slider, 'pointerup', xOf(slider, 80));
    expect(rzAt10(curve)).toBeNull();
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
    expect(app.history.peekUndo()?.label).toBe('setup');
    expect(app.store.preview).toBeNull();
  });

  it('the target label follows the selection; a click forces the pose target', async () => {
    const { keys } = await mountBar();
    const target = byTestId(document.body, 'tween-target-graph');
    expect(target.textContent).toBe('Pose @ f10');
    await update(() => {
      const selection = app.session.getState().selection;
      app.session.setState({
        selection: { ...selection, keys: new Map([[keys[1] as KeyId, { key: true, in: false, out: false }]]) },
      });
    });
    expect(target.textContent).toBe('1 key');
    expect(target.getAttribute('aria-pressed')).toBe('false');
    await act(async () => target.click());
    expect(app.session.getState().tools.tweenTarget).toBe('frame');
    expect(target.textContent).toBe('Pose @ f10');
    expect(target.getAttribute('aria-pressed')).toBe('true');
    await update(() => {
      const time = app.session.getState().time;
      app.session.setState({ time: { ...time, sceneFrame: 12 } });
    });
    expect(target.textContent).toBe('Pose @ f12');
  });

  it('presets run key.tween with the chosen mode; overshoot widens the slider to ±150', async () => {
    const { curve } = await mountBar();
    await act(async () => byTestId(document.body, 'tween-preset-graph-50').click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rzAt10(curve)?.v).toBeCloseTo(45, 9);
    const mode = byTestId(document.body, 'tween-mode-graph') as HTMLSelectElement;
    await act(async () => {
      mode.value = 'toDefault';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => byTestId(document.body, 'tween-preset-graph--100').click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rzAt10(curve)?.v).toBeCloseTo(90, 9); // 45 − (0 − 45)
    expect(app.history.peekUndo()?.label).toBe('Blend to Default');
    const slider = byTestId(document.body, 'tween-slider-graph');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    await act(async () => byTestId(document.body, 'tween-overshoot-graph').click());
    expect(app.prefs.getState().tweenOvershoot).toBe(true);
    expect(slider.getAttribute('aria-valuemax')).toBe('150');
  });

  it('the status-line bar keeps its presets and the overshoot toggle in an overflow menu', async () => {
    await mountBar('status');
    expect(document.body.querySelector('[data-testid="tween-preset-status-50"]')).toBeNull();
    expect(byTestId(document.body, 'tween-slider-status')).toBeDefined();
    expect(byTestId(document.body, 'tween-target-status').textContent).toBe('Pose @ f10');
    expect(byTestId(document.body, 'tween-more-status')).toBeDefined();
  });

  it('a drag with nothing to tween changes nothing', async () => {
    const { curve } = await mountBar();
    await update(() => {
      const time = app.session.getState().time;
      app.session.setState({ time: { ...time, sceneFrame: 25 } });
    });
    const before = JSON.stringify(app.store.snapshot());
    const slider = byTestId(document.body, 'tween-slider-graph');
    await pointer(slider, 'pointerdown', xOf(slider, 0));
    await pointer(slider, 'pointermove', xOf(slider, 60));
    await pointer(slider, 'pointerup', xOf(slider, 60));
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
    expect(app.store.query.keysOfCurve(curve)).toHaveLength(2);
  });
});
