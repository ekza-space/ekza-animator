// Whose a one-finger drag is (STUDIO-TOUCH-SPEC §5.1, ST-5): in the Shared routing a drag manipulates only what is
// already selected, a handle (manipulator, cap handle, a rig dot), or — with a brush tool active — the mesh under the
// finger, which strokes after the brush delay; anywhere else it orbits (pans in an orthographic pane). A stage package
// that draws its own handles in the pane registers a claim while it is mounted (`addHaloClaim`). Pure over its inputs.
import type { ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ArbiterClaim, PickResult } from '@ekza-studio/viewport';
import { BRUSH_TOOLS, MESH_TOOLS } from '@ekza-studio/viewport';

/** A stage's own claim: true when the press at (x, y) of the pane is a handle of its. */
export type HaloClaim = (paneId: string, x: number, y: number) => boolean;

const registry = new WeakMap<EditorApp, Set<HaloClaim>>();

export function addHaloClaim(app: EditorApp, claim: HaloClaim): () => void {
  let set = registry.get(app);
  if (set === undefined) {
    set = new Set();
    registry.set(app, set);
  }
  set.add(claim);
  return () => {
    registry.get(app)?.delete(claim);
  };
}

export interface PressFacts {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly hit: PickResult | null;
  /** The active viewport tool. */
  readonly tool: string;
  readonly selectedControls: readonly ControlId[];
  readonly jointsSelected: boolean;
  /** Whether a mesh is under the press (lazily: a mesh-view hit test). */
  overMesh(): boolean;
  /** The Thumb key's tap meaning is on: a drag on empty space draws a marquee (§5.2). */
  readonly marquee: boolean;
}

/** The claim of a buffered press in the Shared routing (§5.1). */
export function claimOf(app: EditorApp, press: PressFacts): ArbiterClaim {
  if (MESH_TOOLS.has(press.tool) && press.overMesh()) return BRUSH_TOOLS.has(press.tool) ? 'brush' : 'tool';
  const hit = press.hit;
  if (hit?.kind === 'manipulator') return 'tool';
  const control = hit?.kind === 'control' ? hit.control : hit?.kind === 'mesh' ? hit.control : null;
  if (control !== null && press.selectedControls.includes(control)) return 'tool';
  if (hit?.kind === 'joint' && press.jointsSelected) return 'tool';
  for (const claim of registry.get(app) ?? []) if (claim(press.paneId, press.x, press.y)) return 'tool';
  if (press.marquee && hit === null && !press.overMesh()) return 'tool';
  return 'navigate';
}
