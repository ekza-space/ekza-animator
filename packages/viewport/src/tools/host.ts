// What a viewport tool may ask of the viewport (ToolDef<ViewportToolHost>.create(app, host)). Built-in tools and
// extension tools use the same host.
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import type { DragSession } from '../manipulators/drag';
import type { AxisHandle } from '../manipulators/ManipulatorKit';
import type { ObjectScaleSession } from '../manipulators/scale/math';
import type { ManipHandle, MarqueeRect, PickResult } from '../types';

export interface ViewportToolHost {
  /** Sorted pick candidates at a pane point: manipulator handle first, then controls, then joints. */
  pickCandidates(paneId: string, x: number, y: number): readonly PickResult[];
  /** The manipulator handle at a pane point, or null. */
  pickManipulator(paneId: string, x: number, y: number): ManipHandle | null;
  /** Visible controls crossed by a pane rectangle (CSS px). */
  marquee(paneId: string, rect: MarqueeRect): readonly ControlId[];
  /** Shows (or with null hides) the marquee rectangle over a pane. */
  setMarquee(paneId: string, rect: MarqueeRect | null): void;
  /** Starts a manipulator drag on the selected controls; null when nothing can be dragged. */
  beginManipulatorDrag(paneId: string, handle: ManipHandle, x: number, y: number): DragSession | null;
  /**
   * The channel behind an axis handle (translate arrow, rotate ring) that is locked on the lead control, or null.
   * Such a handle is pickable but never drags: a press on it should only say why nothing moves (§4.11.16).
   */
  lockedChannel(handle: ManipHandle): AxisHandle | null;
  /** Highlights the dragged handle (null when the drag ends). */
  setActiveHandle(handle: ManipHandle | null): void;
  /** Maps a joint to the control that drives it (nearest driven ancestor), or null. */
  controlForJoint(character: CharacterId, node: number): ControlId | null;
  /**
   * M6a (B9): starts a Scale-tool drag on the selected scene objects (meshes and groups, Model object mode) when the
   * manipulator sits on them; null otherwise. Optional for extension hosts.
   */
  beginObjectDrag?(paneId: string, handle: ManipHandle, x: number, y: number): ObjectScaleSession | null;
}
