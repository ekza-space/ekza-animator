// What a viewport tool may ask of the viewport (ToolDef<ViewportToolHost>.create(app, host)). Built-in tools and
// extension tools use the same host.
import type { CharacterId, ControlId } from '@ekza-animator/doc';
import type { DragSession } from '../manipulators/drag';
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
  /** Highlights the dragged handle (null when the drag ends). */
  setActiveHandle(handle: ManipHandle | null): void;
  /** Maps a joint to the control that drives it (nearest driven ancestor), or null. */
  controlForJoint(character: CharacterId, node: number): ControlId | null;
}
