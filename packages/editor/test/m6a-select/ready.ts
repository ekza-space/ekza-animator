// READY flags of B10's editor tests (M6A-SPEC §3 rule 4). Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
export const READY = {
  /** B5: `checkMesh` (the Mesh Check panel's rows, `meshCheck()`). */
  b5: true,
} as const;
