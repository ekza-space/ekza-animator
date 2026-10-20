// What the ViewportManager and Model's transform runtime (B12a, M6A-SPEC §5.15) exchange: the runtime places the
// manipulator in Model (component selections, objects for Move and Rotate, pivot editing) ahead of B9's object scale
// target and the control target, and reads the pane camera and the manipulator's frame for its drags. Types only.
import type { Mat4, ReadonlyVec3, Vec3 } from '@ekza-animator/anim-core';
import type { CharacterId } from '@ekza-animator/doc';
import type { Camera } from 'three';
import type { ManipMode, ManipTarget } from '../../../manipulators/ManipulatorKit';
import type { PaneProjector } from '../../../picking/geometry';
import type { ManipHandle } from '../../../types';

export interface ModelManipulatorRequest {
  /** The handles of the active tool (move → translate, rotate → rotate, scale → scale). */
  readonly mode: ManipMode;
  /** The scene matrix of a character root (character-owned objects), or null. */
  readonly characterWorld: (character: CharacterId) => Mat4 | null;
}

export interface ModelManipulatorTarget {
  readonly target: ManipTarget;
  /** The handles shown: the tool's, or translate while the pivot is edited. */
  readonly mode: ManipMode;
  /** The manipulator draws dashed (pivot editing, §5.15). */
  readonly dashed: boolean;
}

/** Model's transform runtime as the ViewportManager asks it (`setModelManipulator`). */
export interface ModelManipulator {
  target(request: ModelManipulatorRequest): ModelManipulatorTarget | null;
}

/** A pane's camera and the manipulator's frame at a drag start (`ViewportManager.manipulatorFrame`). */
export interface ManipulatorFrame {
  readonly camera: Camera;
  readonly projector: PaneProjector;
  readonly width: number;
  readonly height: number;
  /** The manipulator pivot and unit handle axes (scene space); null when no manipulator shows. */
  readonly pivot: ReadonlyVec3 | null;
  readonly axes: readonly [Vec3, Vec3, Vec3];
  readonly mode: ManipMode | null;
  /** The manipulator size in CSS px. */
  readonly sizePx: number;
  /** Scene units per CSS px at the pivot (or at the camera target without a manipulator). */
  readonly unitsPerPx: number;
  ringAxis(handle: ManipHandle): Vec3;
  ringGrab(handle: ManipHandle, x: number, y: number): Vec3 | null;
}
