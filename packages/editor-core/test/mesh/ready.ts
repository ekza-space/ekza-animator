// READY gates of the B7 tests (M6A-SPEC §3 rule 4). Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
// - b1: B1's kernel (Euler operators, real ops, sphere/cone/torus) with B3's `mesh.extrude`;
// - primitives: B1's sphere, cone and torus (the gate the creation cases used while B3 had not merged).
export const READY = { b1: true, primitives: true } as const;
