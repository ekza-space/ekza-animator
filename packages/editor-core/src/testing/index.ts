// '@ekza-animator/editor-core/testing': the shared test kit (MVP-SPEC §7 WP-0b, owned by WP-7a).
// Browser-safe: nothing here imports Node APIs, so Vitest browser-mode panel tests and the /dev/panels route use it
// as well. Read fixtures with `@ekza-animator/doc/testing` (Node) and pass them in.
import { installModelOperators } from '../operators/builtin/modelOps';
import * as modelOperatorsChunk from '../operators/builtin/modelOpsChunk';

// M6A-INT-13: test apps get the Model operators at once (the editor loads their chunk on the first Model entry).
// While test/m6a/model-ops.test.ts regenerates the manifest (EKZA_WRITE_MODEL_MANIFEST=1) the old one may not match.
const regenerating =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    'EKZA_WRITE_MODEL_MANIFEST'
  ] === '1';
if (!regenerating) installModelOperators(modelOperatorsChunk);

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
