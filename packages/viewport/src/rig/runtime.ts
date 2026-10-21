// The Rig & Skin skeleton runtime of a viewport (M6B-SPEC §8.3, §5.7, §0.4.2; C3), in the lazy viewport-rig chunk:
// the joint overlay and the Quick Rig markers overlay in the shared scene, the pointer layer that routes presses to
// the markers tool (Quick Rig open) or the joint input (Skeleton mode) before the active tool, the held keys the tools
// read (`D` joint only, `X` grid snap), `Esc` closing Quick Rig, and the screen queries of the test API. The overlays
// rebuild lazily (a dirty flag, read before each frame's first pane and before every query).
import type { Disposer } from '@ekza-studio/anim-core';
import type { JointId, MeshId } from '@ekza-studio/doc';
import { type EditorApp, quickRigOf, rigGeometry } from '@ekza-studio/editor-core';
import { projectedCenter, type QuickRigMarker } from '@ekza-studio/rig';
import type { ViewportManager, ViewportPointerLayer } from '../manager/ViewportManager';
import { JointInput } from '../tools/rig/jointTransform/input';
import { rigSkinRuntimes } from '../tools/rig/paint';
import { startRigSkin } from '../tools/rig/paint/runtime';
import { type HeldKeys, PERSP_MARKER_HINT, QuickRigInput } from '../tools/rig/quickRig/input';
import { buildJointScene, EMPTY_SCENE, type JointPreview } from './joints/data';
import { JointOverlay } from './joints/overlay';
import { pointerRay, type Vec3 } from './joints/pane';
import { QuickRigMarkerOverlay } from './markers/overlay';

export interface ViewportRigRuntime {
  readonly joints: JointOverlay;
  readonly markers: QuickRigMarkerOverlay;
  /** Rebuilds the overlays now if anything changed. */
  ensure(): void;
  /** Milliseconds the last joint-overlay rebuild took (the §5.25 report row, ≤ 2 ms). */
  readonly rebuildMs: number;
  /** Pane CSS px of a joint's sphere centre, or null (not drawn there, off the pane). */
  screenOfJoint(joint: string, paneId: string): { x: number; y: number } | null;
  screenOfBone(joint: string, child: string, paneId: string, t: number): { x: number; y: number } | null;
  screenOfMarker(marker: QuickRigMarker, side: 'R' | 'L', paneId: string): { x: number; y: number } | null;
  /** Snap to Projected Center under a pane point (pane CSS px): the slab midpoint through the meshes, or null. */
  projectedCenter(paneId: string, x: number, y: number): Vec3 | null;
  dispose(): void;
}

const TEXT_INPUT = /^(input|textarea|select)$/i;

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return element !== null && (TEXT_INPUT.test(element.tagName ?? '') || element.isContentEditable === true);
}

/** Keys held down (by `KeyboardEvent.code`), outside text fields. */
class Held implements HeldKeys {
  private readonly codes = new Set<string>();
  readonly down = (e: KeyboardEvent): void => {
    if (!typing(e.target)) this.codes.add(e.code);
  };
  readonly up = (e: KeyboardEvent): void => {
    this.codes.delete(e.code);
  };
  readonly clear = (): void => this.codes.clear();
  isHeld(code: string): boolean {
    return this.codes.has(code);
  }
}

export function createRigRuntime(app: EditorApp, vm: ViewportManager): ViewportRigRuntime {
  const joints = new JointOverlay(vm, app);
  const markers = new QuickRigMarkerOverlay(vm, app);
  const held = new Held();
  let preview: JointPreview | null = null;
  let dirty = true;
  let rebuildMs = 0;
  let markerState = quickRigOf(app);
  markers.update(markerState);

  const invalidate = (): void => {
    dirty = true;
    vm.invalidate();
  };
  const ensure = (): void => {
    const state = quickRigOf(app);
    if (state !== markerState) {
      markerState = state;
      markers.update(state);
    }
    if (!dirty) return;
    dirty = false;
    const t0 = performance.now();
    // Outside Rig & Skin nothing is drawn or picked: no rebuild there.
    joints.setData(app.session.getState().workspace === 'rig' ? buildJointScene(app, { preview }) : EMPTY_SCENE);
    rebuildMs = performance.now() - t0;
  };

  const quick = new QuickRigInput(app, vm, markers, held);
  const jointInput = new JointInput(
    app,
    vm,
    {
      overlay: joints,
      setPreview(next) {
        preview = next;
        invalidate();
      },
      setMarquee: (paneId, rect) => vm.toolHost.setMarquee(paneId, rect),
      toast: (text) => app.services.notify.toast({ kind: 'info', text }),
    },
    held,
  );

  let owner: 'quick' | 'joints' | null = null;
  const canvas = vm.renderer.domElement;
  const setHint = (hint: string | null): void => {
    if (hint === null) {
      if (canvas.title === PERSP_MARKER_HINT) canvas.removeAttribute('title');
    } else if (canvas.title !== hint) canvas.title = hint;
  };
  const layer: ViewportPointerLayer = {
    pointerDown(e) {
      ensure();
      if (quick.active) {
        if (quick.pointerDown(e)) {
          owner = 'quick';
          return true;
        }
        return false;
      }
      if (jointInput.active && jointInput.pointerDown(e)) {
        owner = 'joints';
        return true;
      }
      return false;
    },
    pointerMove(e) {
      if (owner === 'quick') quick.pointerMove(e);
      else if (owner === 'joints') jointInput.pointerMove(e);
    },
    pointerUp(e) {
      const was = owner;
      owner = null;
      if (was === 'quick') quick.pointerUp(e);
      else if (was === 'joints') jointInput.pointerUp(e);
    },
    cancel() {
      const was = owner;
      owner = null;
      if (was === 'quick') quick.cancel();
      else if (was === 'joints') jointInput.cancel();
    },
    hover(paneId, x, y) {
      ensure();
      if (quick.active) {
        setHint(quick.hoverHint(paneId, x, y));
        if (markers.setHover(quick.markerAt(paneId, x, y))) vm.invalidate();
        return;
      }
      setHint(null);
      const state = app.session.getState();
      const hovering = state.workspace === 'rig' ? joints.pick(paneId, x, y, { lockedToo: true }) : null;
      const joint = hovering !== null && hovering.kind !== 'missing' ? hovering.joint : null;
      if (joints.setHover(joint)) vm.invalidate();
    },
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    held.down(e);
    if (e.code !== 'Escape' || typing(e.target)) return;
    if (quickRigOf(app) === null || quick.dragging || app.session.getState().dialog !== null) return;
    void app.runUntyped('skel.quickRig.cancel');
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', held.up, { capture: true });
  window.addEventListener('blur', held.clear);

  const jointsHost = {
    root: joints.root,
    applyPane: (display: Parameters<JointOverlay['applyPane']>[0], paneId: string) => {
      ensure();
      joints.applyPane(display, paneId);
    },
    dispose: () => {},
  };
  const markersHost = {
    root: markers.root,
    applyPane: (display: Parameters<QuickRigMarkerOverlay['applyPane']>[0], paneId: string) => {
      ensure();
      markers.applyPane(display, paneId);
    },
    dispose: () => {},
  };
  // §5.24 Skeleton mode display (a pane option): the mesh in x-ray and the controls hidden while the mode is on; the
  // flags a pane had come back when the mode is left (unless the user changed them meanwhile).
  const skeletonDisplay = new Map<string, { readonly xray: boolean; readonly controls: boolean }>();
  const applySkeletonDisplay = (on: boolean): void => {
    if (on) {
      for (const paneId of vm.paneIds()) {
        const display = vm.paneState(paneId)?.display;
        if (display === undefined || skeletonDisplay.has(paneId)) continue;
        skeletonDisplay.set(paneId, { xray: display.xray, controls: display.controls });
        if (!display.xray || display.controls)
          vm.updatePane(paneId, { display: { ...display, xray: true, controls: false } });
      }
      return;
    }
    for (const [paneId, before] of skeletonDisplay) {
      const display = vm.paneState(paneId)?.display;
      if (display !== undefined && display.xray && !display.controls) {
        vm.updatePane(paneId, { display: { ...display, xray: before.xray, controls: before.controls } });
      }
    }
    skeletonDisplay.clear();
  };
  const skeletonMode = (): boolean => {
    const state = app.session.getState();
    return state.workspace === 'rig' && state.rig.mode === 'skeleton';
  };
  if (skeletonMode()) applySkeletonDisplay(true);

  const disposers: Disposer[] = [
    vm.addMeshLayer(jointsHost),
    vm.addMeshLayer(markersHost),
    vm.setPointerLayer(layer),
    app.store.subscribe(() => invalidate()),
    app.session.subscribe((state, previous) => {
      if (state.rig.mode !== previous.rig.mode && previous.workspace === 'rig' && state.workspace === 'rig') {
        applySkeletonDisplay(state.rig.mode === 'skeleton');
      }
      if (
        state.workspace !== previous.workspace ||
        state.rig !== previous.rig ||
        state.selection.joints !== previous.selection.joints ||
        state.tools !== previous.tools
      ) {
        invalidate();
      }
    }),
    app.prefs.subscribe((state, previous) => {
      if (state.rigging !== previous.rigging) invalidate();
    }),
    app.evaluation.subscribe(() => {
      if (app.session.getState().workspace === 'rig') invalidate();
    }),
    () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', held.up, { capture: true });
      window.removeEventListener('blur', held.clear);
      setHint(null);
    },
  ];

  // C6's Skin mode runtime (the skinned and weight display, Paint Skin Weights, the brush ring) starts with this chunk:
  // one eager Rig & Skin hook loads both (INT, §0.4.9 — C6's own subscription was a second eager copy of C3's).
  const skin = startRigSkin(app, vm);
  rigSkinRuntimes.set(app, skin);
  disposers.push(() => {
    skin.dispose();
    if (rigSkinRuntimes.get(app) === skin) rigSkinRuntimes.delete(app);
  });

  const pageless = (point: { x: number; y: number } | null): { x: number; y: number } | null =>
    point === null ? null : { x: point.x, y: point.y };

  return {
    joints,
    markers,
    ensure,
    get rebuildMs() {
      return rebuildMs;
    },
    screenOfJoint(joint, paneId) {
      ensure();
      return pageless(joints.screenOf(joint as JointId, paneId));
    },
    screenOfBone(joint, child, paneId, t) {
      ensure();
      return pageless(joints.screenOfBone(joint as JointId, child, paneId, t));
    },
    screenOfMarker(marker, side, paneId) {
      ensure();
      return pageless(markers.screenOf(marker, side, paneId));
    },
    projectedCenter(paneId, x, y) {
      const view = vm.paneView(paneId);
      if (view === null) return null;
      const state = app.session.getState();
      const character = state.rig.character;
      const meshes: readonly MeshId[] =
        quickRigOf(app)?.meshes ??
        (character === null
          ? app.store.query.meshesOfOwner('scene').map((mesh) => mesh.id)
          : app.store.query.meshesOfOwner(character).map((mesh) => mesh.id));
      if (meshes.length === 0) return null;
      try {
        const geometry = rigGeometry(app, app.store, meshes);
        const ray = pointerRay(view, x, y);
        return projectedCenter(geometry.bvh, ray.origin, ray.dir, {
          mode: 'new',
          fallbackRadius: 0.05 * Math.max(geometry.height, 0.1),
        });
      } catch {
        return null;
      }
    },
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      joints.dispose();
      markers.dispose();
    },
  };
}
