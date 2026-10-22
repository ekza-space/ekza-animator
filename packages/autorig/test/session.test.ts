// AUTORIG-SPEC §4.3 (D3): the session store — generic slice patches, session fields, a new subject resets the
// slices, listeners — and its mirror in sessionStorage (`ekza-studio:autorig:v1`): written on every change, read
// back field by field over the defaults (a later package's new slice fields default), unreadable or blocked storage
// is skipped, never thrown.
import { describe, expect, it } from 'vitest';
import { AUTORIG_SESSION_KEY, defaultAutoRigSession } from '../src';
import {
  clearSessionMirror,
  createAutoRigSessionStore,
  type MirrorStorage,
  readSessionMirror,
  writeSessionMirror,
} from '../src/session';

function memory(): MirrorStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const blocked: MirrorStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the session store (§4.3)', () => {
  it('patches slices generically and sets session fields; unchanged writes notify nobody', () => {
    const store = createAutoRigSessionStore();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.patch('model', { heavyConfirmed: true });
    expect(store.getState().model).toEqual({ parts: null, heavyConfirmed: true });
    store.patch('rig', { sub: 'paint' });
    expect(store.getState().rig).toMatchObject({ sub: 'paint', motionTest: true });
    store.set({ step: 'markers', startPose: { armAngle: 0.6, kind: 'a' } });
    expect(store.getState()).toMatchObject({ step: 'markers', startPose: { kind: 'a' } });
    expect(calls).toBe(3);
    store.patch('model', { heavyConfirmed: true });
    store.set({ step: 'markers' });
    expect(calls).toBe(3);
    off();
    store.set({ step: 'model' });
    expect(calls).toBe(3);
  });

  it('a new subject resets the slices, the intake and the start pose (the step and nav stay)', () => {
    const store = createAutoRigSessionStore();
    store.set({ step: 'rig', nav: 'simple', startPose: { armAngle: 0, kind: 't' } });
    store.patch('animations', { skipped: true });
    store.resetSubject({ character: null, meshes: ['msh_1' as never] });
    const s = store.getState();
    expect(s.subject.meshes).toEqual(['msh_1']);
    expect(s).toMatchObject({ step: 'rig', nav: 'simple', startPose: null, intake: null });
    expect(s.animations).toEqual(defaultAutoRigSession().animations);
  });
});

describe('the session mirror (§4.3: sessionStorage, try/catch)', () => {
  it('writes the step, subject, intake, start pose and the five slices on every change and reads them back', () => {
    const storage = memory();
    const store = createAutoRigSessionStore(defaultAutoRigSession(), storage);
    store.set({ step: 'markers', subject: { character: null, meshes: ['msh_1' as never] } });
    store.set({ startPose: { armAngle: 0.61, kind: 'a' } });
    store.patch('export', { target: 'glb' });
    const raw = JSON.parse(storage.items.get(AUTORIG_SESSION_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      ['animations', 'export', 'intake', 'markers', 'model', 'rig', 'startPose', 'step', 'subject'].sort(),
    );
    expect(raw['nav']).toBeUndefined();
    const back = readSessionMirror(storage);
    expect(back).toMatchObject({
      step: 'markers',
      subject: { character: null, meshes: ['msh_1'] },
      startPose: { armAngle: 0.61, kind: 'a' },
      export: { target: 'glb', downloaded: false },
    });
    clearSessionMirror(storage);
    expect(readSessionMirror(storage)).toBeNull();
  });

  it('reads each slice over its defaults; bad or foreign values fall back', () => {
    const storage = memory();
    storage.setItem(
      AUTORIG_SESSION_KEY,
      JSON.stringify({
        step: 'rig',
        subject: { meshes: ['msh_1', 7] },
        startPose: { kind: 'x' },
        rig: { sub: 'adjust' },
      }),
    );
    const back = readSessionMirror(storage);
    expect(back?.step).toBe('rig');
    expect(back?.subject).toEqual({ character: null, meshes: ['msh_1'] });
    expect(back?.startPose).toBeNull();
    expect(back?.rig).toEqual({ ...defaultAutoRigSession().rig, sub: 'adjust' });
    expect(back?.model).toEqual(defaultAutoRigSession().model);
    storage.setItem(AUTORIG_SESSION_KEY, '{not json');
    expect(readSessionMirror(storage)).toBeNull();
    storage.setItem(AUTORIG_SESSION_KEY, JSON.stringify({ step: 'dance' }));
    expect(readSessionMirror(storage)).toBeNull();
  });

  it('blocked storage is skipped without throwing (§6.3)', () => {
    expect(readSessionMirror(blocked)).toBeNull();
    expect(() => writeSessionMirror(blocked, defaultAutoRigSession())).not.toThrow();
    expect(() => clearSessionMirror(blocked)).not.toThrow();
    const store = createAutoRigSessionStore(defaultAutoRigSession(), blocked);
    expect(() => store.set({ step: 'markers' })).not.toThrow();
    expect(store.getState().step).toBe('markers');
    expect(readSessionMirror(null)).toBeNull();
  });
});
