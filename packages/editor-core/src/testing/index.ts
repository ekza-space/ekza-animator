// '@ekza-animator/editor-core/testing': the shared test kit (MVP-SPEC §7 WP-0b, owned by WP-7a).
// Browser-safe: nothing here imports Node APIs, so Vitest browser-mode panel tests and the /dev/panels route use it
// as well. Read fixtures with `@ekza-animator/doc/testing` (Node) and pass them in.
export { createFakeEditorApp, type FakeEditorApp } from './app';
export { naiveCurveEngine, naiveCycleAwareCurveEngine } from './curves';
export { createFakeServices, type FakeServices } from './services';
export { createNaiveStore, type NaiveStoreOptions } from './store/naiveStore';
// M2a A2: limb IK fixtures (records shaped like the rig's limbIkRecords, programs listing their limbs).
export {
  createFakeIkEditorApp,
  FIXTURE_FOOT,
  fixtureControl,
  fixtureLimbs,
  withLimbIkRecords,
} from './limbs';
