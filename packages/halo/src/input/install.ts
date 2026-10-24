// The Halo shell's input on the page's viewport (STUDIO-TOUCH-SPEC §5, §20.4; a lazy chunk the shell loads at start):
// the pointer arbiter in the manager's one stage slot (fingers and the Pencil), the mouse's navigation override (a left
// drag on empty space orbits, Alt falls through to the user's profile, §4.5), right-click as the flick ring (the
// marking-menu seam), the Thumb key's virtual modifiers, and trackpad pinch as dolly — ignored while two fingers are
// down (C15). The disposer removes all of it, so Studio Pro on the same page navigates as before.
import type { EditorApp } from '@ekza-studio/editor-core';
import { type CompassSlot, slotToward } from '@ekza-studio/ui/touch';
import {
  createPointerArbiter,
  type NavGesture,
  type NavigationOverride,
  type PanePointerPress,
  type PointerArbiter,
  type ViewportManager,
} from '@ekza-studio/viewport';
import type { Grammar } from '../halo/grammar';
import { en } from '../i18n/en';
import type { ShellContext } from '../shell/context';
import { writeInput, storageOf } from '../shell/mirror';
import { PANE } from '../shell/stage';
import { haloArbiterConfig } from './arbiter';
import { claimOf } from './claims';
import { createThumbController, type ThumbController } from './thumb';

export interface InputHandle {
  readonly thumb: ThumbController;
  /** A mouse press on empty space that may stay a click (the pane reports its release). */
  mouseEmpty(): { readonly pointerId: number; readonly clientX: number; readonly clientY: number } | null;
  clearMouseEmpty(): void;
  /** WebKit's gesturestart / gesturechange / gestureend on the pane (C15, S21). */
  gesture(e: Event): void;
  dispose(): void;
}

const pointerTypeOf = (e: object): string => ('pointerType' in e ? String(e.pointerType) : 'mouse');

/** The mouse's override (§4.5): Alt chords stay the profile's; middle drag pans; left drag on empty space orbits. */
function mouseOverride(
  app: EditorApp,
  vm: ViewportManager,
  ctx: ShellContext,
  onEmpty: (press: { pointerId: number; clientX: number; clientY: number }) => void,
): NavigationOverride {
  return {
    gesture(e, paneId, at): NavGesture | null {
      // fingers and the Pencil were decided by the arbiter (its replays reach the tool as they are)
      const type = pointerTypeOf(e);
      if (type === 'touch' || type === 'pen') return null;
      if (e.altKey) return null;
      if (e.button === 1) return 'track';
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return null;
      const preset = vm.paneState(paneId)?.preset ?? 'persp';
      if (preset !== 'persp') return null;
      const s = app.session.getState();
      const hit = vm.pick(paneId, at.x, at.y);
      const claim = claimOf(app, {
        paneId,
        x: at.x,
        y: at.y,
        hit,
        tool: s.tools.viewport,
        selectedControls: s.selection.controls,
        jointsSelected: s.selection.joints.length > 0,
        overMesh: () => vm.isOverMesh(paneId, at.x, at.y),
        marquee: ctx.store.get().thumb.latch !== 'off',
      });
      // a mouse click selects what it is on (the tool's click): only empty space orbits on a left drag
      if (claim !== 'navigate' || hit !== null || vm.isOverMesh(paneId, at.x, at.y)) return null;
      const ev = e as unknown as { pointerId?: number; clientX?: number; clientY?: number };
      onEmpty({ pointerId: ev.pointerId ?? 1, clientX: ev.clientX ?? 0, clientY: ev.clientY ?? 0 });
      return 'tumble';
    },
  };
}

/** Right-click (or the trackpad's secondary click) opens the ring at the cursor; a right drag flicks (§5.2). */
function ringMenus(ctx: ShellContext, grammar: Grammar): (press: PanePointerPress) => boolean {
  return (press) => {
    if (press.button !== 2) return false;
    grammar.notePointer('mouse');
    const center = { x: press.x, y: press.y };
    grammar.secondary(center, press.pointerId);
    const hot = (e: PointerEvent): CompassSlot | null =>
      slotToward(e.clientX - press.clientX, e.clientY - press.clientY, grammar.slots());
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== press.pointerId) return;
      const halo = ctx.store.get().halo;
      if (halo?.mode !== 'ring') return;
      const slot = hot(e);
      if (slot !== (halo.hot ?? null)) ctx.store.set({ halo: { ...halo, hot: slot } });
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== press.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const slot = hot(e);
      const halo = ctx.store.get().halo;
      if (slot === null || halo?.mode !== 'ring' || ctx.store.get().input.reduceGestures) {
        if (halo?.mode === 'ring') ctx.store.set({ halo: { ...halo, hot: null } });
        return;
      }
      if (!grammar.runSlot(slot)) ctx.store.set({ halo: { ...halo, hot: null } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return true;
  };
}

/** WebKit's `GestureEvent` (trackpad pinch on iPad, also fired for touchscreen pinches, S21). */
interface GestureLike extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function installInput(ctx: ShellContext, grammar: Grammar, vm: ViewportManager): InputHandle {
  const { app, store } = ctx;
  const thumb = createThumbController(app, store);
  const offSource = vm.setModifierSource(thumb.source);
  let empty: { pointerId: number; clientX: number; clientY: number } | null = null;

  const penFound = (): void => {
    const ui = store.get();
    if (ui.penSeen) return;
    store.set({ penSeen: true });
    if (ui.input.routing !== 'shared') return;
    store.set({ input: { ...ui.input, routing: 'pencilEdits' } });
    ctx.toasts.push({
      key: 'pen',
      text: en.toast.penFound,
      durationMs: 8000,
      action: {
        label: en.toast.change,
        run: () => {
          const input = { ...store.get().input, routing: 'shared' as const };
          store.set({ input });
          writeInput(storageOf('local'), input);
        },
      },
    });
  };

  let arbiter: PointerArbiter | null = null;
  let offStage: (() => void) | null = null;
  const installStage = (): void => {
    offStage?.();
    const config = haloArbiterConfig({
      app,
      store,
      grammar,
      thumb,
      overMesh: (paneId, x, y) => vm.isOverMesh(paneId, x, y),
      penFound,
    });
    const stage = createPointerArbiter<PointerEvent>(config);
    offStage = vm.setPointerArbiter((host) => {
      arbiter = stage(host);
      return arbiter;
    });
  };
  installStage();
  // the quick pinch is a config field: a changed input setting rebuilds the stage
  const offInput = store.subscribe((next, previous) => {
    if (
      next.input.quickPinch !== previous.input.quickPinch ||
      next.input.reduceGestures !== previous.input.reduceGestures
    )
      installStage();
  });

  vm.setNavigationOverride(
    mouseOverride(app, vm, ctx, (press) => {
      empty = press;
    }),
  );
  vm.setPointerMenus(ringMenus(ctx, grammar));

  // C15 / S21: a trackpad pinch dollies inside the canvas; a touchscreen pinch is the arbiter's (two pointers held)
  let lastScale = 1;
  const gesture = (e: Event): void => {
    if (e.type === 'gesturestart') {
      lastScale = 1;
      return;
    }
    if (e.type === 'gestureend') {
      vm.endNavigate(PANE);
      return;
    }
    if ((arbiter?.touches() ?? 0) >= 2) return;
    const g = e as GestureLike;
    if (!(g.scale > 0) || lastScale <= 0) return;
    const rect = vm.paneRect(PANE);
    const at = rect === null ? undefined : { x: g.clientX - rect.x, y: g.clientY - rect.y };
    vm.navigate(PANE, 'dolly', Math.log(g.scale / lastScale), 0, at);
    lastScale = g.scale;
  };

  return {
    thumb,
    mouseEmpty: () => empty,
    clearMouseEmpty() {
      empty = null;
    },
    gesture,
    dispose() {
      offInput();
      offStage?.();
      offStage = null;
      vm.setNavigationOverride(null);
      vm.setPointerMenus(null);
      offSource();
      thumb.dispose();
    },
  };
}
