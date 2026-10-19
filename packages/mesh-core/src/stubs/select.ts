// B0a stubs of B2's selection walkers (M6A-SPEC §4.3, §3 rule 1): final signatures that throw
// `EkzaError('not-implemented', 'mesh-core.<symbol>')` until B2 lands `src/select/**` and switches the barrel lines.
import { notImplemented } from '../kernel';
import type { ComponentKind, ComponentSelection, ConvertMode, EditMesh, HiddenSet, LoopGesture } from '../types';

export function edgeLoop(_m: EditMesh, _e: number, _hidden?: HiddenSet | null): Uint32Array {
  throw notImplemented('edgeLoop');
}
export function edgeRing(_m: EditMesh, _e: number, _hidden?: HiddenSet | null): Uint32Array {
  throw notImplemented('edgeRing');
}
export function partialLoop(
  _m: EditMesh,
  _a: number,
  _b: number,
  _kind: ComponentKind,
  _hidden?: HiddenSet | null,
): Uint32Array | null {
  throw notImplemented('partialLoop');
}
export function vertexLoop(_m: EditMesh, _v: number, _along: number, _hidden?: HiddenSet | null): Uint32Array {
  throw notImplemented('vertexLoop');
}
export function faceLoop(_m: EditMesh, _f: number, _across: number, _hidden?: HiddenSet | null): Uint32Array {
  throw notImplemented('faceLoop');
}
export function growSelection(_m: EditMesh, _sel: ComponentSelection, _hidden?: HiddenSet | null): ComponentSelection {
  throw notImplemented('growSelection');
}
export function shrinkSelection(
  _m: EditMesh,
  _sel: ComponentSelection,
  _hidden?: HiddenSet | null,
): ComponentSelection {
  throw notImplemented('shrinkSelection');
}
export function convertSelection(
  _m: EditMesh,
  _sel: ComponentSelection,
  _to: ComponentKind,
  _mode: ConvertMode,
  _hidden?: HiddenSet | null,
): ComponentSelection {
  throw notImplemented('convertSelection');
}
/** Maya's loop table (§5.6) as a pure function: the selection after the gesture on `component` of `kind`. */
export function loopGesture(
  _m: EditMesh,
  _sel: ComponentSelection,
  _kind: ComponentKind,
  _component: number,
  _gesture: LoopGesture,
  _hidden?: HiddenSet | null,
): ComponentSelection {
  throw notImplemented('loopGesture');
}
