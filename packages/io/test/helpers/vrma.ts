// A synthetic third-party VRMA for reader tests (MVP-SPEC §4.11.7): non-identity rest rotations on humanoid and
// non-humanoid nodes, a translation-only intermediate node between hips and spine, a rotated intermediate node
// between chest and neck, a rotated root above hips and an eye mapping.
import { quatNormalize, type Quat } from '@ekza-studio/anim-core';
import { GltfBuilder } from '../../src/testing/glb';

export const VRMA_TIMES = [0, 0.5, 1];

/** Deterministic pseudo-random unit quaternions. */
export function seededQuats(seed: number, count: number): Quat[] {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
  return Array.from({ length: count }, () => quatNormalize([next(), next(), next(), next() + 1.5]));
}

export interface SyntheticVrmaOptions {
  /** Add channels three-vrm-animation rejects or ignores (scale on a bone, translation on spine, an eye track). */
  readonly invalidChannels?: boolean;
  readonly specVersion?: string | null;
}

export function makeSyntheticVrma(opts: SyntheticVrmaOptions = {}): Uint8Array {
  const b = new GltfBuilder();
  const json = b.json as Record<string, unknown>;
  const rest = seededQuats(7, 12);
  const node = (name: string, extra: Record<string, unknown>) => ({ name, ...extra });
  json['nodes'] = [
    node('root', { rotation: rest[0], translation: [0.1, 0, -0.2], children: [1] }),
    node('J_Hips', { translation: [0, 0.9, 0.05], rotation: rest[1], children: [2, 8] }),
    node('offset', { translation: [0, 0.08, 0], children: [3] }),
    node('J_Spine', { translation: [0, 0.05, 0], rotation: rest[2], children: [4] }),
    node('J_Chest', { translation: [0, 0.12, 0.01], rotation: rest[3], children: [5] }),
    node('twist', { translation: [0, 0.05, 0], rotation: rest[4], children: [6] }),
    node('J_Neck', { translation: [0, 0.1, 0], rotation: rest[5], children: [7] }),
    node('J_Head', { translation: [0, 0.1, 0.02], rotation: rest[6], scale: [1.1, 1.1, 1.1], children: [9] }),
    node('J_LeftUpperLeg', { translation: [0.1, -0.05, 0], rotation: rest[7] }),
    node('J_LeftEye', { translation: [0.03, 0.05, 0.08] }),
  ];
  json['scenes'] = [{ nodes: [0] }];
  json['scene'] = 0;
  const humanBones: Record<string, { node: number }> = {
    hips: { node: 1 },
    spine: { node: 3 },
    chest: { node: 4 },
    neck: { node: 6 },
    head: { node: 7 },
    leftUpperLeg: { node: 8 },
  };
  if (opts.invalidChannels === true) humanBones['leftEye'] = { node: 9 };
  json['extensionsUsed'] = ['VRMC_vrm_animation'];
  json['extensions'] = {
    VRMC_vrm_animation: {
      ...(opts.specVersion === null ? {} : { specVersion: opts.specVersion ?? '1.0' }),
      humanoid: { humanBones },
    },
  };
  const times = b.accessor(new Float32Array(VRMA_TIMES), 'SCALAR', { minMax: true });
  const samplers: Record<string, unknown>[] = [];
  const channels: Record<string, unknown>[] = [];
  const add = (target: number, path: string, values: number[], interpolation = 'LINEAR'): void => {
    const output = b.accessor(new Float32Array(values), path === 'rotation' ? 'VEC4' : 'VEC3');
    channels.push({ sampler: samplers.length, target: { node: target, path } });
    samplers.push({ input: times, output, interpolation });
  };
  [1, 3, 4, 6, 7, 8].forEach((target, i) =>
    add(target, 'rotation', seededQuats(100 + i, 3).flat(), i === 2 ? 'STEP' : 'LINEAR'),
  );
  add(1, 'translation', [0, 0.9, 0.05, 0.1, 0.85, 0.1, 0.2, 0.92, 0.0]);
  if (opts.invalidChannels === true) {
    add(3, 'translation', [0, 0, 0, 0, 0.1, 0, 0, 0.2, 0]);
    add(4, 'scale', [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    add(9, 'rotation', seededQuats(200, 3).flat());
  }
  json['animations'] = [{ name: 'third-party', samplers, channels }];
  return b.build();
}
