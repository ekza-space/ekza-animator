// READY gates of the B11 tests (M6A-SPEC §3 rule 4, §9 B11). Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
// - b3: B3's core ops (extrude, insert loop, delete) on B1's kernel;
// - b4: B4's shape ops (triangulate, mirror);
// - b5: B5's bevel;
// - b10: B10's component selection service stores selections.
export const READY = { b3: true, b4: true, b5: true, b10: true } as const;
