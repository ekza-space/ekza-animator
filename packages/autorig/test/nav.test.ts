// AUTORIG-SPEC §8.1 (D3): Simple navigation. The arbitration table — persp: a left drag on empty space tumbles, a
// right or middle drag tracks; ortho never tumbles; a press the tool claims goes to the tool; Alt (and other
// modifiers) fall through to the user's profile — and the override's lifetime: installed on the shell's viewport,
// asking the tool's hit test only for a plain left press, removed by its disposer, and never writing the persisted
// `navProfile` (or any preference).
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { NavigationOverride, NavPointerInput } from '@ekza-studio/viewport';
import { describe, expect, it } from 'vitest';
import { addNavigationClaim, installSimpleNavigation, simpleGesture, toolClaims } from '../src/nav';

const press = (button: number, mods: Partial<NavPointerInput> = {}): NavPointerInput => ({
  button,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('simpleGesture (§8.1)', () => {
  it('persp: left on empty space tumbles, right and middle track; a claimed press goes to the tool', () => {
    const empty = { ortho: false, claimed: () => false };
    expect(simpleGesture(press(0), empty)).toBe('tumble');
    expect(simpleGesture(press(2), empty)).toBe('track');
    expect(simpleGesture(press(1), empty)).toBe('track');
    expect(simpleGesture(press(0), { ortho: false, claimed: () => true })).toBeNull();
  });

  it('ortho panes never tumble (left goes to the tool), but pan with the right button', () => {
    const ortho = { ortho: true, claimed: () => false };
    expect(simpleGesture(press(0), ortho)).toBeNull();
    expect(simpleGesture(press(2), ortho)).toBe('track');
  });

  it('Alt and the tool modifiers fall through (the profile’s Maya chords, marquee add/toggle)', () => {
    let asked = 0;
    const counting = {
      ortho: false,
      claimed: () => {
        asked += 1;
        return false;
      },
    };
    for (const mods of [{ altKey: true }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(simpleGesture(press(0, mods), counting)).toBeNull();
    }
    expect(simpleGesture(press(2, { altKey: true }), counting)).toBeNull();
    expect(asked).toBe(0);
  });
});

type Hit = { kind: 'manipulator' | 'control' | 'joint' | 'mesh' };

function fakeViewport(opts: { hits?: Hit[]; overMesh?: boolean; preset?: string | null } = {}) {
  let installed: NavigationOverride | null = null;
  return {
    get installed(): NavigationOverride | null {
      return installed;
    },
    setNavigationOverride(o: NavigationOverride | null) {
      installed = o;
    },
    paneState: () => ({ preset: opts.preset === undefined ? 'persp' : opts.preset }) as never,
    pickCandidates: () => (opts.hits ?? []) as never,
    isOverMesh: () => opts.overMesh === true,
  };
}

describe('installSimpleNavigation (§8.1)', () => {
  it('installs on the viewport, arbitrates per pane, and its disposer removes it; prefs are never written', () => {
    const app = createFakeEditorApp();
    const prefs = app.prefs.getState();
    const vm = fakeViewport();
    const off = installSimpleNavigation(app, vm);
    const o = vm.installed;
    expect(o).not.toBeNull();
    expect(o?.gesture(press(0), 'pane-persp', { x: 10, y: 10 })).toBe('tumble');
    expect(o?.gesture(press(0, { altKey: true }), 'pane-persp', { x: 10, y: 10 })).toBeNull();
    off();
    expect(vm.installed).toBeNull();
    off(); // idempotent
    expect(app.prefs.getState()).toBe(prefs);
  });

  it('ortho presets never tumble; a shot camera (no preset) is treated as persp', () => {
    const app = createFakeEditorApp();
    const front = fakeViewport({ preset: 'front' });
    installSimpleNavigation(app, front);
    expect(front.installed?.gesture(press(0), 'pane-front', { x: 1, y: 1 })).toBeNull();
    const shot = fakeViewport({ preset: null });
    installSimpleNavigation(app, shot);
    expect(shot.installed?.gesture(press(0), 'pane-single', { x: 1, y: 1 })).toBe('tumble');
  });

  it('the tool claims manipulators, joints and controls; the mesh only under a painting or marker tool', () => {
    const app = createFakeEditorApp();
    for (const kind of ['manipulator', 'joint', 'control'] as const) {
      expect(toolClaims(app, fakeViewport({ hits: [{ kind }] }), 'pane-persp', 0, 0)).toBe(true);
    }
    const mesh = fakeViewport({ hits: [{ kind: 'mesh' }], overMesh: true });
    expect(toolClaims(app, mesh, 'pane-persp', 0, 0)).toBe(false);
    for (const tool of ['paintSkinWeights', 'quickRigMarker']) {
      const state = app.session.getState();
      app.session.setState({ tools: { ...state.tools, viewport: tool } });
      expect(toolClaims(app, mesh, 'pane-persp', 0, 0)).toBe(true);
    }
  });

  it('a step can claim presses of its own while it is mounted', () => {
    const app = createFakeEditorApp();
    const vm = fakeViewport();
    installSimpleNavigation(app, vm);
    const off = addNavigationClaim(app, (paneId, x) => paneId === 'pane-persp' && x < 50);
    expect(vm.installed?.gesture(press(0), 'pane-persp', { x: 10, y: 0 })).toBeNull();
    expect(vm.installed?.gesture(press(0), 'pane-persp', { x: 90, y: 0 })).toBe('tumble');
    off();
    expect(vm.installed?.gesture(press(0), 'pane-persp', { x: 10, y: 0 })).toBe('tumble');
  });
});
