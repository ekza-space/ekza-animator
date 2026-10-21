// The lazy entry of the viewport's Rig & Skin overlays (M6B-SPEC §2.1: rig code never enters the eager route).
import type * as ViewportRig from './index';

export type ViewportRigModule = typeof ViewportRig;

let loading: Promise<ViewportRigModule> | null = null;

export function loadViewportRig(): Promise<ViewportRigModule> {
  loading ??= import('./index');
  return loading;
}
