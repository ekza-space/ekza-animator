// Private, test-only package (ADR 0002): never a dependency of the app.
export { createYjsStore, isYjsStore, YjsDocumentStore } from './store';
export { yjsHarness } from './testing/harness';
