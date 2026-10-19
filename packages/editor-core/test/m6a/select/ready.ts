// READY flags of B10's editor-core tests (M6A-SPEC §3 rule 4): a test that needs another package's work is wrapped in
// `describe.skipIf(!READY.<id>)` until that package merges; the integration agent (INT) sets every flag to true and
// the gated tests become failures if they do not pass.
export const READY = {
  /** B2: the kernel's walkers (loop table, rings, grow, shrink, convert, border, shell) and `expandSelection`. */
  b2: false,
  /** B5: `checkMesh` (Mesh Check "select matching"). */
  b5: false,
  /** B7: the real runtime (commits through `commitOp`, symmetry maps from the session settings). */
  b7: false,
} as const;
