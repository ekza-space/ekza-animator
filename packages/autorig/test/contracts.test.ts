// AUTORIG-SPEC §4.3, §8.1, §8.4 (D0; D3 landed its functions): the Auto-Rig shell contract compiles and its skeletons
// hold — the default session carries every slice at its owner's default, the per-step string and key tables merge,
// the shell marker is the check-size boundary's, and D3's functions (progress, Simple navigation) are real.
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
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

  it('D3’s functions landed: progress derives ① for an empty app; Simple navigation installs and removes itself', () => {
    const app = createFakeEditorApp();
    expect(autoRigProgress(app, defaultAutoRigSession()).reachable.model).toBe(true);
    let installed: unknown = 'none';
    const off = installSimpleNavigation(app, {
      setNavigationOverride: (o) => {
        installed = o;
      },
      paneState: () => null,
      paneAt: () => null,
      pickCandidates: () => [],
      isOverMesh: () => false,
    });
    expect(installed).not.toBeNull();
    off();
    expect(installed).toBeNull();
  });
});

describe('strings and keys split per step (AUTORIG-SPEC §8.1, §8.4, §10.0)', () => {
  it('merges one English table per owner', () => {
    const en = messages();
    expect(Object.keys(en)).toEqual(['frame', 'model', 'markers', 'rig', 'animations', 'export']);
    expect(en.frame.product).toBe('Auto-Rig');
    // every value is a non-empty string or a function building one (§8.4)
    const ok = (text: unknown): boolean => (typeof text === 'string' && text.length > 0) || typeof text === 'function';
    expect(Object.values(en.frame).every(ok)).toBe(true);
    expect(Object.values(en.model).every(ok)).toBe(true);
    expect(en.frame.next('Markers')).toBe('Next: Markers');
    expect(formatNumber(1.704)).toBe('1.7');
    expect(formatNumber(312)).toBe('312');
  });

  it('merges one key list per owner under the autorig scope', () => {
    expect(AUTORIG_KEY_SCOPE).toBe('autorig');
    // D3's frame rows first (the global keys); the step owners' lists follow (① has none), each naming its steps
    expect(AUTORIG_KEYMAP.length).toBeGreaterThan(0);
    const firstStepRow = AUTORIG_KEYMAP.findIndex((binding) => binding.steps !== 'all');
    expect(firstStepRow).toBeGreaterThan(0);
    expect(AUTORIG_KEYMAP.slice(0, firstStepRow).every((binding) => binding.steps === 'all')).toBe(true);
    expect(AUTORIG_KEYMAP.slice(firstStepRow).every((binding) => binding.steps !== 'all')).toBe(true);
  });
});
