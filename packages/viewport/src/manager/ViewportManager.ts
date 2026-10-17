// WP-5 stubs: final signatures (MVP-SPEC §7 WP-5; ADR 0006). The constructor throws until the viewport lands;
// `registerViewportContributions` is a no-op so the app boots from day 1.
import { type Disposer, EkzaError, type ReadonlyVec3 } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import type { EditorApp, NavProfile } from '@ekza-animator/editor-core';
import type { Scene, WebGLRenderer } from 'three';
import type {
  CameraSnapshot,
  DisplayFlags,
  ManipHandle,
  MarqueeRect,
  PaneDescriptor,
  PickResult,
  ScreenPoint,
} from '../types';

export const DEFAULT_DISPLAY: DisplayFlags = {
  mesh: true,
  skeleton: false,
  controls: true,
  grid: true,
  xray: false,
  hud: true,
  springBones: false,
};

export class ViewportManager {
  declare readonly scene: Scene;
  declare readonly renderedFrames: number;

  constructor(_opts: { readonly app: EditorApp; readonly renderer: WebGLRenderer }) {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager');
  }

  registerPane(_desc: PaneDescriptor): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.registerPane');
  }

  updatePane(_id: string, _patch: Partial<Pick<PaneDescriptor, 'camera' | 'display'>>): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.updatePane');
  }

  unregisterPane(_id: string): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.unregisterPane');
  }

  paneIds(): readonly string[] {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.paneIds');
  }

  paneAt(_clientX: number, _clientY: number): string | null {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.paneAt');
  }

  /** Render dirty panes. Call from R3F useFrame(…, 1). */
  render(): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.render');
  }

  invalidate(_paneId?: string): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.invalidate');
  }

  /** Pane CSS px. */
  pick(_paneId: string, _x: number, _y: number): PickResult | null {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.pick');
  }

  /** Sorted; for click cycling. */
  pickCandidates(_paneId: string, _x: number, _y: number): readonly PickResult[] {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.pickCandidates');
  }

  /** Crossing test. */
  marquee(_paneId: string, _rect: MarqueeRect): readonly ControlId[] {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.marquee');
  }

  frame(_paneId: string, _what: 'selection' | 'all'): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.frame');
  }

  /** Pane CSS px. */
  project(_paneId: string, _world: ReadonlyVec3): ScreenPoint | null {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.project');
  }

  /** A point on the shape polyline. */
  controlScreenPoint(_paneId: string, _control: ControlId): ScreenPoint | null {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.controlScreenPoint');
  }

  manipulatorScreenPoint(_paneId: string, _handle: ManipHandle): ScreenPoint | null {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.manipulatorScreenPoint');
  }

  camera(_paneId: string): CameraSnapshot {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.camera');
  }

  setNavProfile(_profile: NavProfile): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.setNavProfile');
  }

  dispose(): void {
    throw new EkzaError('not-implemented', 'viewport.ViewportManager.dispose');
  }
}

/** Registers 'select' | 'move' | 'rotate' viewport tools and the viewport operators of §4.9 (owner 5). */
export function registerViewportContributions(_app: EditorApp, _vm: ViewportManager): Disposer {
  return () => {};
}
