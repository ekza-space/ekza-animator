// READY flags of mesh-core's tests (M6A-SPEC §3 rule 4): a test that needs another package's work is wrapped in
// `describe.skipIf(!READY.<id>)` until that package merges; the integration agent (INT) sets every flag to true and
// the gated tests become failures if they do not pass.
export const READY = {
  /** B13: the humanoid body generator (`primitive('humanoidBody', …)`), used by B2's in-seam golden. */
  b13: false,
} as const;
