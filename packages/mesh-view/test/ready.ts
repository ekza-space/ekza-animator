// READY flags of mesh-view's tests (M6A-SPEC §3 rule 4): a test that needs another package's work is wrapped in
// `describe.skipIf(!READY.<id>)` until that package merges; the integration agent (INT) sets every flag to true and
// the gated tests become failures if they do not pass.
export const READY = {
  /**
   * B6: mesh-view's overlays and picking and the viewport's lazy mesh display (landed with this file). No mesh-view
   * test is gated: they run on B0a's reference kernel through the §4.3 public API, which B1 keeps, so no `b1` flag is
   * needed here; the editor-level bench waits on B7, B9 and B10 through `test.fixme`
   * (apps/web/e2e/bench/m6a-mesh-view.bench.ts).
   */
  b6: true,
} as const;
