// READY flags of B10's editor tests (M6A-SPEC §3 rule 4): the integration agent (INT) sets them to true and the gated
// assertions become failures if they do not pass.
export const READY = {
  /** B5: `checkMesh` (the Mesh Check panel's rows, `meshCheck()`). */
  b5: false,
} as const;
