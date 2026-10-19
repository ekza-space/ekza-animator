// M6A-SPEC §3 rule 4: the sibling M6a packages io's tests need. Tests that need one use
// `describe.skipIf(!READY.<id>)`. Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
export const READY = {
  /** B1: the kernel's Euler operators (topology edits). */
  b1: true,
  /** B3: Insert Edge Loop (the loop-and-export part of E2E-MOD-12). */
  b3: true,
  /** B5: Mesh Check diagnostics (the mesh.* hygiene lints). */
  b5: true,
} as const;
