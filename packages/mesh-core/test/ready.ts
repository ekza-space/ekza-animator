// READY gates of the mesh-core op tests (M6A-SPEC §3 rule 4). Turned into failures by INT at the M6a integration (every M6a package merged): the gated cases always run.
// - b2: B2's symmetry maps (`buildSymmetryMap`, `expandSelection`, `mirrorEdgePoint`) — B3's and B4's cross-checks and
//   symmetric cases against B2's own maps, B5's symmetric bevel (P10 with real maps);
// - b3: B3's core ops (`mesh.mergeByDistance` runs) — the Combine + Merge by Distance oracle;
// - b4: B4's shape ops;
// - b13: B13's humanoid body generator (`primitive('humanoidBody', …)`), used by B2's in-seam golden.
// B3's (`ops-core/ready.ts`) and B5's (`ops/bevel/ready.ts`) gate files are folded into this one (M6A-B3-13, M6A-B5-13).
export const READY = { b2: true, b3: true, b4: true, b13: true } as const;
