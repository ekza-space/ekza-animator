// Whole-mesh runs of component ops (M6A-SPEC §6.1 Modes column; B11). Twelve ops whose Modes column lists `object`
// next to component kinds (Triangulate "f, object", Conform "f, object", Average Vertices "v e f, object", …) also run
// on whole meshes. Their descriptors list only the component kinds (B0a's contract has no "also whole" flag), so B11's
// registration decides: in object mode (no `kind` arg) — or with an explicit `kind: null`, which an adjusted re-run of
// a whole-mesh run passes — they act on the selected mesh objects (or the explicit `meshes`) with kind null and a null
// selection, which every kernel reads as the whole mesh (its visible faces, edges or vertices, `scopeFaces` & co.).
import type { EditorApp } from '../../../types';

/** §6.1 rows whose Modes column includes `object` besides component kinds (kernel descriptor kinds stay components). */
export const WHOLE_MESH_OPS: ReadonlySet<string> = new Set([
  'mesh.averageVertices',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.harden',
  'mesh.soften',
  'mesh.setNormalAngle',
  'mesh.reverse',
  'mesh.conform',
  'mesh.symmetrize',
  'mesh.uv.planar',
  'mesh.uv.box',
  'mesh.uv.cylindrical',
]);

/**
 * True when a run of `opId` acts on whole meshes: a whole-mesh capable op with an explicit `kind: null`, or without a
 * component `kind` while the Model mode is object. An explicit component `kind` always means the component selection.
 */
export function wholeMeshRun(app: EditorApp, opId: string, args: unknown): boolean {
  if (!WHOLE_MESH_OPS.has(opId)) return false;
  const kind =
    typeof args === 'object' && args !== null ? (args as Readonly<Record<string, unknown>>)['kind'] : undefined;
  if (kind === null) return true;
  if (kind === 'vertex' || kind === 'edge' || kind === 'face') return false;
  return app.session.getState().model.componentMode === 'object';
}
