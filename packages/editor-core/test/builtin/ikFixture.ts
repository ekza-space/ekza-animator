// A2 test fixture: the wave document with limb IK records (the shared kit's `withLimbIkRecords`, shaped like the
// rig's `limbIkRecords` output) and a fake app whose rig programs list those limbs, with the built-in operators.
import type { ControlId, DocSnapshot } from '@ekza-studio/doc';
import type { LimbId } from '@ekza-studio/rig';
import { registerBuiltinOperators } from '../../src';
import {
  createFakeIkEditorApp,
  createFakeServices,
  FIXTURE_FOOT,
  type FakeServices,
  fixtureControl,
  withLimbIkRecords,
} from '../../src/testing';
import type { EditorApp } from '../../src/types';
import { humanoidSkeleton, WAVE, waveDoc } from './support';

export const cid = (key: string): ControlId => fixtureControl(WAVE.rig, key);
export const FOOT = FIXTURE_FOOT;

/** The wave document plus limb IK records (all four limbs by default; legs IK, arms FK). */
export function ikWaveDoc(opts?: { readonly limbs?: readonly LimbId[]; readonly ikFkDefault?: number }): DocSnapshot {
  return withLimbIkRecords(waveDoc(), opts);
}

/** The fake app over `ikWaveDoc` whose programs list the limbs; built-in operators registered. */
export function ikApp(opts?: { readonly snapshot?: DocSnapshot; readonly services?: FakeServices }): {
  readonly app: EditorApp;
  readonly services: FakeServices;
} {
  const services = opts?.services ?? createFakeServices();
  const app = createFakeIkEditorApp({
    snapshot: opts?.snapshot ?? ikWaveDoc(),
    skeleton: humanoidSkeleton(),
    services,
  });
  registerBuiltinOperators(app);
  return { app, services };
}
