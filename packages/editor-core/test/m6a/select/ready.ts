// READY flags of B10's editor-core tests (M6A-SPEC §3 rule 4). Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
export const READY = {
  /** B2: the kernel's walkers (loop table, rings, grow, shrink, convert, border, shell) and `expandSelection`. */
  b2: true,
  /** B3: core topology ops (`mesh.delete` through the runtime: hidden components are never op targets). */
  b3: true,
  /** B5: `checkMesh` (Mesh Check "select matching"). */
  b5: true,
  /** B7: the real runtime (commits through `commitOp`, symmetry maps from the session settings). */
  b7: true,
} as const;
