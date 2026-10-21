// READY gates of the M6b packages (M6B-SPEC §3 rule 4, §9.0): `describe.skipIf(!READY.<id>)`. Each package sets its
// own flag in the commit that merges it into m6b/mvp; INT turns every gate into a failure (every flag true).
export const READY = {
  c1: false,
  c2: true,
  c3: true,
  c4: false,
  c6: false,
  c7: true,
  c10: false,
  c12: false,
} as const;
