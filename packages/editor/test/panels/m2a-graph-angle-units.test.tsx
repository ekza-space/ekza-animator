// M2A-SPEC §5.1 rule 5 in the Graph Editor (browser mode; hand-off M2A-A4-12, resolved at integration): an angle
// attribute (`@roll`, `unit: 'angle'`) shows and takes degrees in the key fields like the Channel Box and the curve
// axis — a key at 20° reads 20.000 in both, typing 30 writes 30°, and the in/out angle fields match the slope the
// canvas draws (measured on screen from the key and its handle).
import { DEG2RAD, RAD2DEG } from '@ekza-studio/anim-core';
import type { ControlId, CurveId, KeyId } from '@ekza-studio/doc';
import { ensureCurve, registerBuiltinOperators } from '@ekza-studio/editor-core';
import { type FakeEditorApp, loadOperatorBodies } from '@ekza-studio/editor-core/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ChannelBoxPanel } from '../../src/panels/channel-box/ChannelBoxPanel';
import { GraphPanel, graphTestHooks } from '../../src/panels/graph';
import { CLIP, cleanup, control, input, loadFixtures, mount, setClipFrame, setSession, waveApp } from './helpers';

afterEach(cleanup);
beforeAll(async () => {
  await loadFixtures();
});

const HAND = control('fk.hand.L');
const FPS = 30;

/** The wave app with the built-in operators, `@roll` (angle) on the hand keyed 0° / 20° / 60° at 0 / 10 / 20. */
async function rollApp(): Promise<{ app: FakeEditorApp; curve: CurveId; keys: KeyId[] }> {
  const app = waveApp();
  registerBuiltinOperators(app);
  let curve = '' as CurveId;
  const keys: KeyId[] = [];
  await act(async () => {
    app.store.transact({ label: 'Roll' }, (tx) => {
      tx.patch('controls', HAND, { attrs: { roll: { type: 'float', default: 0, keyable: true, unit: 'angle' } } });
      curve = ensureCurve(app, tx, CLIP, HAND, '@roll');
      [0, 20, 60].forEach((deg, i) => {
        const id = `k_RollAngle${String(i).padStart(4, '0')}` as KeyId;
        keys.push(id);
        tx.put('keys', {
          id,
          clip: CLIP,
          curve,
          t: i * 10,
          v: deg * DEG2RAD,
          inType: 'auto',
          outType: 'auto',
          inHandle: { dt: 0, dv: 0 },
          outHandle: { dt: 0, dv: 0 },
          broken: false,
          weightLocked: true,
        });
      });
    });
  });
  return { app, curve, keys };
}

async function mountBoth(app: FakeEditorApp, controls: readonly ControlId[]): Promise<void> {
  await mount(
    app,
    <div style={{ display: 'flex', width: 1400, height: 480 }}>
      <div style={{ width: 300, height: 480, display: 'flex', flexDirection: 'column' }}>
        <ChannelBoxPanel app={app} instanceId="cb#1" />
      </div>
      <div style={{ width: 1100, height: 480 }}>
        <GraphPanel app={app} instanceId="graph#1" />
      </div>
    </div>,
    { width: 1400, height: 480 },
  );
  await setSession(app, { selection: { ...app.session.getState().selection, controls: [...controls] } });
  await settle();
}

async function settle(): Promise<void> {
  // The operators' apply bodies are lazy chunks (M-AI B5): a first run awaits its chunk.
  await loadOperatorBodies();
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function selectKey(app: FakeEditorApp, key: KeyId): Promise<void> {
  return setSession(app, {
    selection: {
      ...app.session.getState().selection,
      keys: new Map([[key, { key: true, in: false, out: false }]]),
    },
  });
}

/** Tangent angle of a handle as the canvas draws it: atan(Δvalue display / Δseconds), from screen pixels. */
function drawnAngle(app: FakeEditorApp, key: KeyId, side: 'in' | 'out'): number {
  const hooks = graphTestHooks(app);
  const view = hooks.graph()?.view;
  const at = hooks.screenOfKey(key);
  const handle = hooks.screenOfHandle(key, side);
  if (view === undefined || at === null || handle === null) throw new Error(`no ${side} handle of ${key} on screen`);
  const frames = (handle.x - at.x) / view.sx;
  const display = -(handle.y - at.y) / view.sy;
  return Math.atan(display / (frames / FPS)) * RAD2DEG;
}

describe('Graph Editor key fields on an angle attribute (§5.1 rule 5, M2A-A4-12)', () => {
  it('show degrees like the Channel Box; typing 30 writes 30°; the angle fields match the drawn slopes', async () => {
    const { app, curve, keys } = await rollApp();
    await mountBoth(app, [HAND]);
    await setClipFrame(app, 10);
    expect(graphTestHooks(app).graph()?.visibleCurves).toContain(curve);
    await selectKey(app, keys[1] as KeyId);
    await settle();
    expect(input('cb-field-@roll').value).toBe('20.000');
    expect(input('ge-field-value').value).toBe('20.000');

    // The drawn tangents of the rising middle key, against the fields (3 decimals shown).
    const inField = Number(input('ge-field-in-angle').value);
    const outField = Number(input('ge-field-out-angle').value);
    expect(Math.abs(outField)).toBeGreaterThan(1);
    expect(inField).toBeCloseTo(drawnAngle(app, keys[1] as KeyId, 'in'), 2);
    expect(outField).toBeCloseTo(drawnAngle(app, keys[1] as KeyId, 'out'), 2);

    await act(async () => userEvent.fill(input('ge-field-value'), '30'));
    await act(async () => userEvent.keyboard('{Enter}'));
    await settle();
    const v = app.store.get('keys', keys[1] as KeyId)?.v ?? Number.NaN;
    expect(Math.abs(v - 30 * DEG2RAD)).toBeLessThanOrEqual(1e-9);
    expect(input('ge-field-value').value).toBe('30.000');
    expect(input('cb-field-@roll').value).toBe('30.000');

    // A typed out-angle is the slope the canvas then draws.
    await act(async () => userEvent.fill(input('ge-field-out-angle'), '40'));
    await act(async () => userEvent.keyboard('{Enter}'));
    await settle();
    expect(drawnAngle(app, keys[1] as KeyId, 'out')).toBeCloseTo(40, 2);
    expect(input('ge-field-out-angle').value).toBe('40.000');
  });
});
