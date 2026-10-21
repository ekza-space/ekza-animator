// Contract file: MVP-SPEC §4.6, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Quat, ReadonlyVec3, Vec3 } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import type { DisplayFlags, ManipHandle, PaneCamera, ViewPreset } from '@ekza-studio/editor-core';

export type { DisplayFlags, ManipHandle, PaneCamera, ViewPreset };
export interface PaneDescriptor {
  readonly id: string;           // 'pane-left', 'pane-right', 'pane-top', …
  readonly element: HTMLElement; // pane surface (receives pointer events)
  readonly camera: PaneCamera;
  readonly display: DisplayFlags;
}
export type PickResult =
  | { readonly kind: 'manipulator'; readonly handle: ManipHandle }
  | { readonly kind: 'control'; readonly control: ControlId; readonly distancePx: number; readonly depth: number }
  | { readonly kind: 'joint'; readonly character: CharacterId; readonly node: number }
  | { readonly kind: 'mesh'; readonly character: CharacterId; readonly node: number; readonly control: ControlId | null };
export interface MarqueeRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }   // pane CSS px
export interface CameraSnapshot {
  readonly projection: 'perspective' | 'orthographic';
  readonly position: Vec3;
  readonly quaternion: Quat;
  readonly target: Vec3;
  readonly fovY: number;
  readonly orthoHeight: number;
}
export interface ScreenPoint { readonly x: number; readonly y: number; readonly depth: number }
export type { ReadonlyVec3 };
