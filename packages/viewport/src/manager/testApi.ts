// The viewport part of the e2e test API (MVP-SPEC §4.8): panes, cameras, page positions of controls and manipulator
// handles, and the rendered-frame counter. The shell's test API (WP-8) delegates to these so the geometry rules
// ("a point ON the shape polyline", "a grab point on the handle") stay with the viewport.
import type { ControlId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { ManipHandle } from '../types';
import type { ViewportManager } from './ViewportManager';

export interface ViewportTestApi {
  /** M6a (B9): `shading` is the pane's shading (additive; the §4.8 type lists the M1 fields). */
  panes(): {
    id: string;
    camera: string;
    locked: boolean;
    rect: { x: number; y: number; w: number; h: number };
    shading: string;
  }[];
  cameraOf(paneId: string): { position: [number, number, number]; quaternion: [number, number, number, number] };
  /** Page CSS px of the control's best pick point (on its polyline), or null when it is not visible in the pane. */
  screenOfControl(control: string, paneId: string): { x: number; y: number } | null;
  /** Page CSS px of a grab point on a manipulator handle (rings: most horizontal tangent), or null. */
  screenOfManipulator(paneId: string, handle: ManipHandle): { x: number; y: number } | null;
  renderedFrames(): number;
  /** M6a (B9, §4.8): the RGBA colour at a page point of a pane after a render; [0, 0, 0, 0] off the canvas. */
  pixel(paneId: string, x: number, y: number): [number, number, number, number];
}

/** A ControlId, or a template key ('fk.upperArm.L') of the active character's rig. */
export function resolveControl(app: EditorApp, control: string): ControlId | null {
  if (app.store.get('controls', control as ControlId) !== undefined) return control as ControlId;
  const character = app.session.getState().activeCharacter;
  const rig = character === null ? undefined : app.store.query.rigOfCharacter(character);
  return rig === undefined ? null : (app.store.query.controlByKey(rig.id, control)?.id ?? null);
}

export function viewportTestApi(vm: ViewportManager): ViewportTestApi {
  const toPage = (paneId: string, point: { readonly x: number; readonly y: number } | null) => {
    const rect = vm.paneRect(paneId);
    return point === null || rect === null ? null : { x: rect.x + point.x, y: rect.y + point.y };
  };
  return {
    panes: () =>
      vm.paneIds().flatMap((id) => {
        const state = vm.paneState(id);
        const rect = vm.paneRect(id);
        if (state === null || rect === null) return [];
        return [
          {
            id,
            camera: state.cameraKind === 'shot' ? 'shot' : (state.preset ?? 'persp'),
            locked: state.locked,
            rect: { ...rect },
            shading: state.display.shading,
          },
        ];
      }),
    cameraOf: (paneId) => {
      const snapshot = vm.camera(paneId);
      return { position: [...snapshot.position], quaternion: [...snapshot.quaternion] };
    },
    screenOfControl: (control, paneId) => {
      const id = resolveControl(vm.app, control);
      return id === null ? null : toPage(paneId, vm.controlScreenPoint(paneId, id));
    },
    screenOfManipulator: (paneId, handle) => toPage(paneId, vm.manipulatorScreenPoint(paneId, handle)),
    renderedFrames: () => vm.renderedFrames,
    pixel: (paneId, x, y) => {
      const rect = vm.paneRect(paneId);
      if (rect === null || x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h)
        return [0, 0, 0, 0];
      return vm.readPixel(x, y) ?? [0, 0, 0, 0];
    },
  };
}
