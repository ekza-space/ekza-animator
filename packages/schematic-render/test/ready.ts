// MCP-SPEC §3 rule 3: tests that need another M-AI package gate on its flag (`describe.skipIf(!READY.<id>)`); each
// package flips its own flag when it merges, and INT turns every remaining gate into a failure.
export const READY = {
  /** P1: explicit-target operators, the scope migrations and the actor-safe operators. */
  p1: false,
  /** P2: the full runtime call path (queue, gesture and redo waits, confirmations, revisions) and tools 4–25, 31–32. */
  p2: false,
  p3: false,
  p4: false,
  p5: false,
  p6: false,
  p7: false,
  p8: false,
  p9: false,
} as const;
