// AUTORIG-SPEC §4.3, §8.1, §8.4 (D0): the Auto-Rig shell contract compiles and its skeletons hold — the default session
// carries every slice at its owner's default, the per-step string and key tables merge, the shell marker is the
// check-size boundary's, and the stubs of D3's functions throw `not-implemented`.
import { describe, expect, it } from 'vitest';
import {
  AUTORIG_KEY_SCOPE,
  AUTORIG_KEYMAP,
  AUTORIG_SESSION_KEY,
  AUTORIG_SHELL_MARKER,
  AUTORIG_STEPS,
  type AutoRigSession,
  type AutoRigSliceName,
  autoRigProgress,
  defaultAutoRigSession,
  formatNumber,
  IDENTITY_CLIP_PARAMS,
  installSimpleNavigation,
  messages,
} from '../src';

describe('Auto-Rig contract (AUTORIG-SPEC §4.3)', () => {
  it('names the five steps in order and the shell marker of the check-size boundary', () => {
    expect(AUTORIG_STEPS).toEqual(['model', 'markers', 'rig', 'animations', 'export']);
    expect(AUTORIG_SHELL_MARKER).toBe('ekza-autorig-shell');
    expect(AUTORIG_SESSION_KEY).toBe('ekza-studio:autorig:v1');
  });

  it('starts a session on ① with no subject and every slice at its owner default', () => {
    const session: AutoRigSession = defaultAutoRigSession();
    expect(session).toEqual({
      step: 'model',
      subject: { character: null, meshes: [] },
      intake: null,
      startPose: null,
      nav: null,
      busy: null,
      model: { parts: null, heavyConfirmed: false },
      markers: { pane: 'front', lastOrtho: 'front' },
      rig: { sub: 'review', motionTest: true, motionClip: 'walk', paintedSinceBind: false },
      animations: { draft: {}, skipped: false, editing: null },
      export: { target: 'ekza-vrm', downloaded: false },
    });
    const slices: readonly AutoRigSliceName[] = ['model', 'markers', 'rig', 'animations', 'export'];
    expect(slices.every((slice) => slice in session)).toBe(true);
    // a fresh object per call (the store patches its own copy)
    expect(defaultAutoRigSession()).not.toBe(session);
  });

  it('identity clip parameters are the §5.5.3 identity', () => {
    expect(IDENTITY_CLIP_PARAMS).toEqual({ speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 });
  });

  it('D3’s functions are stubs until it lands them', () => {
    expect(() => autoRigProgress({} as never, defaultAutoRigSession())).toThrow(/not-implemented|autoRigProgress/);
    expect(() => installSimpleNavigation({} as never)).toThrow(/installSimpleNavigation/);
  });
});

describe('strings and keys split per step (AUTORIG-SPEC §8.1, §8.4, §10.0)', () => {
  it('merges one English table per owner', () => {
    const en = messages();
    expect(Object.keys(en)).toEqual(['frame', 'model', 'markers', 'rig', 'animations', 'export']);
    expect(en.frame.product).toBe('Auto-Rig');
    expect(Object.values(en.frame).every((text) => typeof text === 'string' && text.length > 0)).toBe(true);
    expect(formatNumber(1.704)).toBe('1.7');
    expect(formatNumber(312)).toBe('312');
  });

  it('merges one key list per owner under the autorig scope', () => {
    expect(AUTORIG_KEY_SCOPE).toBe('autorig');
    expect(AUTORIG_KEYMAP).toEqual([]);
  });
});
