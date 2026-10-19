// Stored-form flag bits (M6A-SPEC §4.3). Eager-safe: plain numbers, no kernel code.

/** `edgeFlags` bits: hard edge (normals split), seam (UV/attribute seam), crease (reserved). */
export const EDGE_HARD = 1,
  EDGE_SEAM = 2,
  EDGE_CREASE = 4;
/** `faceFlags` bit 0: triangulate a quad along the other diagonal (§5.4). */
export const FACE_FLIP_DIAGONAL = 1;
