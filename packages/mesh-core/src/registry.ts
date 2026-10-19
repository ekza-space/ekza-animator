// The operation registry (M6A-SPEC §4.3): every §6.1 op by id, behind the lazy kernel entry. B0a lands stub objects
// (`ops/<dir>/index.ts`); each kernel owner replaces the objects in its directory and keeps their export names, so this
// file never changes. Keys equal `MESH_OP_DESCRIPTORS` / `MESH_SET_OP_DESCRIPTORS` (tested).
import { KERNEL_MARKER } from './kernel';
import { transformComponents } from './ops/transform';
import { extrude } from './ops/extrude';
import { inset } from './ops/inset';
import { bevel } from './ops/bevel';
import { insertLoop } from './ops/loop';
import { offsetLoop } from './ops/offsetLoop';
import { connect } from './ops/connect';
import { cut } from './ops/cut';
import { slide } from './ops/slide';
import { averageVertices } from './ops/average';
import { bridge } from './ops/bridge';
import { fillHole } from './ops/fill';
import { merge, mergeToCenter, mergeByDistance } from './ops/merge';
import { targetWeld } from './ops/targetWeld';
import { collapse } from './ops/collapse';
import { meshDelete, deleteEdgeVertex } from './ops/delete';
import { spinEdge } from './ops/spin';
import { flipTriangleEdge } from './ops/flip';
import { triangulate } from './ops/triangulate';
import { quadrangulate } from './ops/quadrangulate';
import { harden, soften, setNormalAngle, reverse, conform } from './ops/normals';
import { mirror } from './ops/mirror';
import { symmetrize } from './ops/symmetrize';
import { applyTransform } from './ops/freeze';
import { uvPlanar, uvBox, uvCylindrical } from './ops/uv';
import { cleanup } from './ops/cleanup';
import { paint, paintFillShell, paintRemap } from './ops/paint';
import { combine } from './ops/combine';
import { separate } from './ops/separate';
import { extract } from './ops/extract';
import { duplicateFaces } from './ops/duplicate';
import type { MeshOp, MeshSetOp } from './types';

function byId<T extends { readonly id: string }>(items: readonly T[]): Readonly<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  // Non-enumerable: keeps the kernel marker in every bundle that holds the registry (§2 size boundary).
  Object.defineProperty(out, '__kernel', { value: KERNEL_MARKER, enumerable: false });
  return Object.freeze(out);
}

export const MESH_OPS: Readonly<Record<string, MeshOp>> = byId([
  transformComponents,
  extrude,
  inset,
  bevel,
  insertLoop,
  offsetLoop,
  connect,
  cut,
  slide,
  averageVertices,
  bridge,
  fillHole,
  merge,
  mergeToCenter,
  mergeByDistance,
  targetWeld,
  collapse,
  meshDelete,
  deleteEdgeVertex,
  spinEdge,
  flipTriangleEdge,
  triangulate,
  quadrangulate,
  harden,
  soften,
  setNormalAngle,
  reverse,
  conform,
  mirror,
  symmetrize,
  applyTransform,
  uvPlanar,
  uvBox,
  uvCylindrical,
  cleanup,
  paint,
  paintFillShell,
  paintRemap,
]);

export const MESH_SET_OPS: Readonly<Record<string, MeshSetOp>> = byId([combine, separate, extract, duplicateFaces]);
