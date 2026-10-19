// What an op run read on a target (M6A-SPEC §5.7: an adjusted re-run reads the selection of the recorded kind that the
// undo restored, whatever the current mode) and the selection helpers the sessions and the journal share: copies that
// later selection writes cannot change, equality, and bytes for the undo budget.
import type { ComponentKind, ComponentSelection } from '@ekza-animator/mesh-core';

/**
 * What an op run read on one target: the component kind (null for an object-level run) and the selection of that kind
 * **before** symmetry expansion (the selection an adjusted re-run reads again after the undo restores it, §5.7).
 */
export interface OpInput {
  readonly kind: ComponentKind | null;
  readonly selection: ComponentSelection | null;
}

/** A copy that later selection writes (the service, the op's own result) cannot change. */
export function cloneSelection(sel: ComponentSelection): ComponentSelection {
  return {
    kind: sel.kind,
    verts: sel.verts.clone(),
    edges: sel.edges.clone(),
    faces: sel.faces.clone(),
    order: sel.order === null ? null : sel.order.slice(),
    active: sel.active,
  };
}

export function cloneInput(input: OpInput): OpInput {
  return { kind: input.kind, selection: input.selection === null ? null : cloneSelection(input.selection) };
}

const sameOrder = (a: Uint32Array | null, b: Uint32Array | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Equal kind, components, pick order and active component. */
export function sameSelection(a: ComponentSelection | null, b: ComponentSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  return (
    a.kind === b.kind &&
    a.active === b.active &&
    a.verts.equals(b.verts) &&
    a.edges.equals(b.edges) &&
    a.faces.equals(b.faces) &&
    sameOrder(a.order, b.order)
  );
}

export function sameInput(a: OpInput, b: OpInput): boolean {
  return a.kind === b.kind && sameSelection(a.selection, b.selection);
}

/** Bytes a stored selection holds (bitset words and the pick order). */
export function selectionBytes(sel: ComponentSelection | null): number {
  if (sel === null) return 0;
  return (
    sel.verts.words.byteLength + sel.edges.words.byteLength + sel.faces.words.byteLength + (sel.order?.byteLength ?? 0)
  );
}
