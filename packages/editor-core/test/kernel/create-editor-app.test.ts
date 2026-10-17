// createEditorApp over the real sibling packages. Until WP-1 (anim-core curve engine), WP-2 (memory store, scene
// clock) and WP-3 (curve cache, sampler, rig compiler) are merged their stubs throw `not-implemented`, so these
// tests skip themselves (MVP-SPEC §8.1: blocked tests name the blocking WP) and run as soon as the packages land.
import { type AnimCurve, curveEngine, EkzaError } from '@ekza-animator/anim-core';
import { createMemoryStore, sceneToClipFrame } from '@ekza-animator/doc';
import { compileRig, createCurveCache } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits, createEditorApp, defaultPrefs, insertKeyOnCurve } from '../../src';
import { createFakeServices } from '../../src/testing';
import { DEG, edit, setFrame, W, waveDoc } from './support';

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

const EMPTY: AnimCurve = { keys: [], weighted: false, pre: 'constant', post: 'constant' };
const WP1 = implemented(() => curveEngine.compile(EMPTY));
const WP2 =
  implemented(() => createMemoryStore()) &&
  implemented(() => sceneToClipFrame({ num: 30, den: 1 }, { fps: { num: 30, den: 1 }, sceneStart: 0 }, 0));
const WP3 =
  WP2 &&
  implemented(() => createCurveCache(createMemoryStore(), curveEngine)) &&
  implemented(() => compileRig(undefined as never, undefined as never));
const READY = WP1 && WP2 && WP3;

describe.skipIf(!READY)('createEditorApp over the real packages (blocked by WP-1, WP-2, WP-3 until merged)', () => {
  function realApp() {
    const store = createMemoryStore();
    store.load(waveDoc());
    return createEditorApp({ services: createFakeServices(), store });
  }

  it("creates a working kernel with doc's memory store by default", () => {
    const app = createEditorApp({ services: createFakeServices() });
    expect(app.store.list('characters')).toEqual([]);
    expect(app.prefs.getState()).toEqual(defaultPrefs('other'));
    expect(app.session.getState().activeCharacter).toBeNull();
    app.dispose();
  });

  it('evaluates the wave clip with the AnimX engine', () => {
    const app = realApp();
    const rz = (frame: number) => {
      setFrame(app, frame);
      return app.evaluation.channelValues(W.lowerArmL).rz / DEG;
    };
    expect(rz(0)).toBeCloseTo(30, 9);
    expect(rz(15)).toBeCloseTo(-30, 9);
    expect(rz(30)).toBeCloseTo(30, 9);
  });

  it('keys, inserts shape-preserving keys and undoes through the editor history', () => {
    const app = realApp();
    setFrame(app, 20);
    edit(app, 'Key', (tx) =>
      applyChannelEdits(app, tx, [{ control: W.lowerArmL, channel: 'rz', value: 10 * DEG }], { key: 'force' }),
    );
    const samples = Array.from({ length: 121 }, (_, i) => i / 4);
    const value = (f: number) => curveEngine.evaluate(app.evaluation.compiledCurve(W.curve), f);
    const before = samples.map(value);
    edit(app, 'Insert Key', (tx) => insertKeyOnCurve(app, tx, W.curve, 7.5));
    samples.forEach((f, i) => expect(value(f)).toBeCloseTo(before[i] as number, 9));
    app.history.undo();
    app.history.undo();
    expect(app.store.query.keysOfCurve(W.curve).map((key) => key.t)).toEqual([0, 15, 30]);
  });
});
