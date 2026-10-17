// '@ekza-animator/editor-core/testing': the shared test kit's fake app (MVP-SPEC §7 WP-0b, then WP-7a).
// Browser-safe: nothing here imports Node APIs, so Vitest browser-mode panel tests and the /dev/panels route use it
// as well. Read fixtures with `@ekza-animator/doc/testing` (Node) and pass them in.
export { createFakeEditorApp, type FakeEditorApp } from './app';
export { naiveCurveEngine } from './curves';
export { createFakeServices, type FakeServices } from './services';
export { createNaiveStore, type NaiveStoreOptions } from './store/naiveStore';
