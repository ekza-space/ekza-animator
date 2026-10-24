// STUDIO-TOUCH-SPEC §20.3 item 10 (T5b): the rules of `autorigFlow` that both shells share, against their sources of
// truth — the fix order (AS-AR-5), the pose class of the intake operator and the `skel.tpose` 5°, the composition's
// stop message, io's file naming for the export hint, the stage order of `autorig.rig`, the rebind question rule
// (AR-D8-8), the painted flag's reducer, the flow store and the operator log's comparable arguments.
import type { CharacterId, CharacterRecord, MeshId } from '@ekza-studio/doc';
import { exportFileName, omobaSlug } from '@ekza-studio/io';
import { describe, expect, it } from 'vitest';
import {
  AUTORIG_A_POSE_LIMIT,
  AUTORIG_FINGER_PRESETS,
  AUTORIG_FIX_ORDER,
  armPoseClass,
  comparableArgs,
  defaultAutoRigFlowState,
  type EditorApp,
  exportAvatarName,
  exportFileNameOf,
  exportSlugOf,
  firstFix,
  type IntakeReport,
  memoryAutoRigFlowStore,
  type OperatorResult,
  paintedAfterRun,
  paintTracked,
  RIG_INTERRUPTED,
  rebindUnasked,
  recommendedTarget,
  stageAfter,
  startMotionTest,
} from '../../src';
import { COMPOSITION_INTERRUPTED } from '../../src/operators/builtin/rig/wizard';
import { A_POSE_LIMIT, poseClassOf } from '../../src/operators/builtin/rig/wizard/intake';

const report = (checks: Partial<IntakeReport['checks']>): IntakeReport => ({
  kind: 'static',
  fileName: 'x.glb',
  bytes: 1,
  meshes: [],
  triangles: 12,
  textured: false,
  height: 1.7,
  checks: { centred: true, grounded: true, facing: true, upright: true, scale: 'ok', ...checks },
  weight: 'light',
  pose: null,
});

describe('① the fix order (AS-AR-5)', () => {
  it('stand up, size, freeze, centre, face — each only while its check fails', () => {
    expect(AUTORIG_FIX_ORDER).toEqual(['standUp', 'scale', 'freeze', 'center', 'face']);
    const all = report({ centred: false, grounded: false, facing: false, upright: false, scale: 'huge' });
    expect(firstFix(all, false)).toBe('standUp');
    expect(firstFix({ ...all, checks: { ...all.checks, upright: true } }, false)).toBe('scale');
    expect(firstFix(report({ centred: false, facing: false }), false)).toBe('freeze');
    expect(firstFix(report({ grounded: false, facing: false }), true)).toBe('center');
    expect(firstFix(report({ facing: false }), true)).toBe('face');
    expect(firstFix(report({}), true)).toBeNull();
  });
});

describe('② the start pose', () => {
  it('is the intake operator’s pose class (the skel.tpose 5°)', () => {
    expect(AUTORIG_A_POSE_LIMIT).toBe(A_POSE_LIMIT);
    for (const deg of [0, 4.9, 5, 5.01, 35, 50]) {
      const angle = (deg * Math.PI) / 180;
      expect(armPoseClass(angle)).toEqual(poseClassOf(angle));
    }
    expect(armPoseClass((35 * Math.PI) / 180).kind).toBe('a');
    expect(armPoseClass(0).kind).toBe('t');
  });

  it('names the finger detail as Halo’s handoff does; Thumb is Quick Rig’s default preset', () => {
    expect(AUTORIG_FINGER_PRESETS).toEqual({
      mittens: 'core21',
      thumb: 'standard33',
      all: 'full52',
      minimal: 'lite17',
    });
  });
});

describe('③ autorig.rig', () => {
  it('stops with the composition’s own message', () => {
    expect(RIG_INTERRUPTED).toBe(COMPOSITION_INTERRUPTED);
  });

  it('follows the stages the history shows', () => {
    const full = { bind: true, straighten: true };
    expect(stageAfter('Create Skeleton', full)).toBe('skin');
    expect(stageAfter('Bind Skin', full)).toBe('straighten');
    expect(stageAfter('Straighten to T-Pose', full)).toBe('check');
    expect(stageAfter('Refit Skeleton', { bind: false, straighten: false })).toBe('check');
    expect(stageAfter('Refit Skeleton', { bind: false, straighten: true })).toBe('straighten');
    expect(stageAfter('Bind Skin', { bind: true, straighten: false })).toBe('check');
    expect(stageAfter('Move', full)).toBeNull();
  });

  it('asks no rebind question only for the weights its own bind wrote (AR-D8-8)', () => {
    expect(rebindUnasked({ bind: false }, false, 'a:1', 'a:1')).toBe(true);
    expect(rebindUnasked({ bind: false }, true, 'a:1', 'a:1')).toBe(false);
    expect(rebindUnasked({ bind: false }, false, 'a:1', 'a:2')).toBe(false);
    expect(rebindUnasked({ bind: false }, false, null, null)).toBe(false);
    expect(rebindUnasked({ bind: true }, false, 'a:1', 'a:1')).toBe(false);
  });

  it('tracks painted weights between binds', () => {
    expect(paintedAfterRun('skin.weights.paint', false)).toBe(true);
    expect(paintedAfterRun('skin.bind', true)).toBe(false);
    expect(paintedAfterRun('skel.quickRig.commit', true)).toBe(false);
    expect(paintedAfterRun('scene.rename', true)).toBe(true);
    expect(['skin.weights.smooth', 'skin.bind', 'skel.quickRig.commit'].every(paintTracked)).toBe(true);
    expect(paintTracked('skin.unbind')).toBe(false);
  });
});

describe('⑤ export naming (io’s rules, mirrored)', () => {
  const names = ['Cube Lad', 'Ekza Bot', 'Żółć Śmiała', '  ', '', '漢字', 'ekza-x', 'a'.repeat(80), 'R2-D2 (v2)'];

  it('slugs the avatar name as io’s omobaSlug', () => {
    for (const name of names) expect([name, exportSlugOf(name)]).toEqual([name, omobaSlug(name)]);
  });

  it('names each target’s file as autorig.export does', () => {
    expect(exportFileNameOf('ekza-vrm', 'Cube Lad', 0, null)).toBe('cube-lad.vrm');
    expect(exportFileNameOf('glb', 'Cube Lad', 2, 'walk')).toBe('cube-lad.glb');
    expect(exportFileNameOf('omoba-kit', 'Cube Lad', 0, null)).toBe('cube-lad-omoba-kit.zip');
    expect(exportFileNameOf('vrma', 'Cube Lad', 2, 'walk')).toBe('cube-lad-animations.zip');
    for (const name of names) {
      const slug = omobaSlug(name);
      expect(exportFileNameOf('vrma', name, 1, 'walk loop')).toBe(
        exportFileName('{character}-{clip}', { character: slug, clip: 'walk loop', fps: 30 }, 'vrma'),
      );
    }
  });

  it('names the file after a model character’s VRM name and recommends its target', () => {
    const model = {
      name: 'Cube Lad',
      deleted: null,
      source: { kind: 'model' },
      vrm: { name: ' Hero ' },
      format: 'vrm1',
    } as unknown as CharacterRecord;
    const gltf = { ...model, source: { kind: 'asset' }, format: 'gltf' } as unknown as CharacterRecord;
    expect(exportAvatarName(model)).toBe('Hero');
    expect(exportAvatarName(gltf)).toBe('Cube Lad');
    expect(recommendedTarget(model)).toBe('ekza-vrm');
    expect(recommendedTarget(gltf)).toBe('glb');
  });
});

describe('③ the motion test', () => {
  it('plays once the character’s runtime is there (right after Create Skeleton it is still being built)', async () => {
    const runs: string[] = [];
    const listeners = new Set<() => void>();
    const built: { runtime?: object } = {};
    const app = {
      library: { loaded: true, load: () => Promise.resolve(), service: { preview: null } },
      characters: {
        get: () => built.runtime,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      store: { subscribe: () => () => {} },
    } as unknown as EditorApp;
    const reports: unknown[] = [];
    const quiet = (op: string): Promise<OperatorResult<unknown>> => {
      runs.push(op);
      return Promise.resolve({ status: 'finished', value: undefined });
    };
    const test = startMotionTest({ app, quiet }, 'chr_A' as CharacterId, 'walk', (state) => reports.push(state));
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toEqual([]);
    expect(listeners.size).toBe(1);
    built.runtime = {};
    for (const listener of listeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toEqual(['library.preview']);
    expect(reports).toEqual([null]);
    expect(listeners.size).toBe(0);
    await test.stop();
  });
});

describe('the flow store and the log', () => {
  it('starts empty and a new subject resets every field', () => {
    const store = memoryAutoRigFlowStore();
    expect(store.get()).toEqual(defaultAutoRigFlowState());
    store.set({ rigidParts: true, boundKey: 'k', parts: ['msh_a' as MeshId] });
    store.resetSubject({ character: null, meshes: ['msh_b' as MeshId] });
    expect(store.get()).toEqual(defaultAutoRigFlowState({ character: null, meshes: ['msh_b' as MeshId] }));
  });

  it('makes arguments comparable: ids by first appearance, bytes by length, keys sorted', () => {
    const tokens = new Map<string, string>();
    const a = comparableArgs(
      { meshes: ['msh_Zx81', 'msh_Ab02'], bytes: new Uint8Array(7), character: 'chr_Q1', z: 1, a: [true] },
      tokens,
    );
    expect(JSON.stringify(a)).toBe(
      '{"a":[true],"bytes":{"bytes":7},"character":"chr#1","meshes":["msh#1","msh#2"],"z":1}',
    );
    expect(comparableArgs({ character: 'chr_Q1', mesh: 'msh_Ab02', asset: 'f'.repeat(64) }, tokens)).toEqual({
      asset: 'ast#1',
      character: 'chr#1',
      mesh: 'msh#2',
    });
  });
});
