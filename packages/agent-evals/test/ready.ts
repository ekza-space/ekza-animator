// MCP-SPEC §3 rule 3: tests that need another M-AI package gate on its flag (`describe.skipIf(!READY.<id>)`); each
// package flips its own flag when it merges, and INT turns every remaining gate into a failure.
export const READY = {
  /** P1: explicit-target operators, the scope migrations and the actor-safe operators. */
  p1: true,
  /** P2: the full runtime call path (queue, gesture and redo waits, confirmations, revisions) and tools 4–25, 31–32. */
  p2: true,
  p3: false,
  p4: false,
  p5: false,
  p6: false,
  /** P7 (B2 in the MVP): the live bridge, pairing and editor_connect. */
  p7: true,
  p8: false,
  p9: false,
} as const;
