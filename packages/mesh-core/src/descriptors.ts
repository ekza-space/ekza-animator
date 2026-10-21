// `@ekza-studio/mesh-core/descriptors` (M6A-SPEC §2 eager/lazy split): the op descriptors and primitive parameters
// that menus, keymap rows, the command palette, option boxes and Last-op cards read. Plain data only — no kernel code,
// no earcut, no predicates, no kernel marker — so the eager editor route can import it. B0a writes this barrel; only
// stub lines change afterwards (§3 rule 2).
import { TRANSFORM_COMPONENTS } from './ops/transform/descriptor';
import { EXTRUDE } from './ops/extrude/descriptor';
import { INSET } from './ops/inset/descriptor';
import { BEVEL } from './ops/bevel/descriptor';
import { INSERT_LOOP } from './ops/loop/descriptor';
import { OFFSET_LOOP } from './ops/offsetLoop/descriptor';
import { CONNECT } from './ops/connect/descriptor';
import { CUT } from './ops/cut/descriptor';
import { SLIDE } from './ops/slide/descriptor';
import { AVERAGE_VERTICES } from './ops/average/descriptor';
import { BRIDGE } from './ops/bridge/descriptor';
import { FILL_HOLE } from './ops/fill/descriptor';
import { MERGE, MERGE_TO_CENTER, MERGE_BY_DISTANCE } from './ops/merge/descriptor';
import { TARGET_WELD } from './ops/targetWeld/descriptor';
import { COLLAPSE } from './ops/collapse/descriptor';
import { DELETE, DELETE_EDGE_VERTEX } from './ops/delete/descriptor';
import { SPIN_EDGE } from './ops/spin/descriptor';
import { FLIP_TRIANGLE_EDGE } from './ops/flip/descriptor';
import { TRIANGULATE } from './ops/triangulate/descriptor';
import { QUADRANGULATE } from './ops/quadrangulate/descriptor';
import { HARDEN, SOFTEN, SET_NORMAL_ANGLE, REVERSE, CONFORM } from './ops/normals/descriptor';
import { MIRROR } from './ops/mirror/descriptor';
import { SYMMETRIZE } from './ops/symmetrize/descriptor';
import { APPLY_TRANSFORM } from './ops/freeze/descriptor';
import { UV_PLANAR, UV_BOX, UV_CYLINDRICAL } from './ops/uv/descriptor';
import { CLEANUP } from './ops/cleanup/descriptor';
import { PAINT, PAINT_FILL_SHELL, PAINT_REMAP } from './ops/paint/descriptor';
import { COMBINE } from './ops/combine/descriptor';
import { SEPARATE } from './ops/separate/descriptor';
import { EXTRACT } from './ops/extract/descriptor';
import { DUPLICATE_FACES } from './ops/duplicate/descriptor';
import type { MeshOpDescriptor, MeshSetOpDescriptor } from './types';

function byId<T extends { readonly id: string }>(items: readonly T[]): Readonly<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return Object.freeze(out);
}

/** Every §6.1 MeshOp row. */
export const MESH_OP_DESCRIPTORS: Readonly<Record<string, MeshOpDescriptor>> = byId([
  TRANSFORM_COMPONENTS,
  EXTRUDE,
  INSET,
  BEVEL,
  INSERT_LOOP,
  OFFSET_LOOP,
  CONNECT,
  CUT,
  SLIDE,
  AVERAGE_VERTICES,
  BRIDGE,
  FILL_HOLE,
  MERGE,
  MERGE_TO_CENTER,
  MERGE_BY_DISTANCE,
  TARGET_WELD,
  COLLAPSE,
  DELETE,
  DELETE_EDGE_VERTEX,
  SPIN_EDGE,
  FLIP_TRIANGLE_EDGE,
  TRIANGULATE,
  QUADRANGULATE,
  HARDEN,
  SOFTEN,
  SET_NORMAL_ANGLE,
  REVERSE,
  CONFORM,
  MIRROR,
  SYMMETRIZE,
  APPLY_TRANSFORM,
  UV_PLANAR,
  UV_BOX,
  UV_CYLINDRICAL,
  CLEANUP,
  PAINT,
  PAINT_FILL_SHELL,
  PAINT_REMAP,
]);

/** Every §6.1 set-op row. */
export const MESH_SET_OP_DESCRIPTORS: Readonly<Record<string, MeshSetOpDescriptor>> = byId([
  COMBINE,
  SEPARATE,
  EXTRACT,
  DUPLICATE_FACES,
]);

export { EDGE_CREASE, EDGE_HARD, EDGE_SEAM, FACE_FLIP_DIAGONAL } from './constants';
export { MAYA_PRIMITIVE_DEFAULTS, PRIMITIVE_PARAMS } from './primitiveParams';
export type * from './types';
