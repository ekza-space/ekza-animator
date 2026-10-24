// Halo's pointer arbiter config (STUDIO-TOUCH-SPEC §5.1–§5.4, §20.4; T1's stage): the §5.4 numbers by pointer type
// (`POINTER_TOLERANCE`; the mouse's multi-tap window is Studio Pro's 500 ms, ST-T1-3), the brush delay, palm rejection,
// the quick pinch (off with *Reduce gestures* or its own toggle), and the handlers that hand each decided gesture to the
// grammar. Built and installed by `./install` (a lazy chunk); Studio Pro installs no stage.
import type { EditorApp } from '@ekza-studio/editor-core';
import { type ArbiterConfig, type ArbiterRouting, POINTER_TOLERANCE } from '@ekza-studio/viewport';
import type { Grammar } from '../halo/grammar';
import type { HaloStore } from '../shell/store';
import { claimOf } from './claims';
import type { ThumbController } from './thumb';

export const LONG_PRESS_MS = 450;
export const BRUSH_DELAY_MS = 120;
export const TWO_FINGER_TAP_MS = 250;
export const PALM_MS = 500;
export const PALM_CONTACT_PX = 30;
export const QUICK_PINCH = { ms: 300, scale: 0.7 } as const;

export interface ArbiterDeps {
  readonly app: EditorApp;
  readonly store: HaloStore;
  readonly grammar: Grammar;
  readonly thumb: ThumbController;
  readonly overMesh: (paneId: string, x: number, y: number) => boolean;
  /** The first Pencil press (§5.1: routing switches to Pencil edits, with a toast). */
  readonly penFound: () => void;
}

export function haloArbiterConfig(deps: ArbiterDeps): ArbiterConfig {
  const { app, store, grammar, thumb } = deps;
  const input = store.get().input;
  const quick = input.quickPinch && !input.reduceGestures;
  return {
    buffered: ['touch', 'pen'],
    slopPx: { touch: POINTER_TOLERANCE.touch.slopPx, pen: POINTER_TOLERANCE.pen.slopPx },
    longPressMs: LONG_PRESS_MS,
    multiTapMs: {
      touch: POINTER_TOLERANCE.touch.multiTapMs,
      pen: POINTER_TOLERANCE.pen.multiTapMs,
      mouse: POINTER_TOLERANCE.mouse.multiTapMs,
    },
    multiTapPx: {
      touch: POINTER_TOLERANCE.touch.multiTapPx,
      pen: POINTER_TOLERANCE.pen.multiTapPx,
      mouse: POINTER_TOLERANCE.mouse.multiTapPx,
    },
    brushDelayMs: BRUSH_DELAY_MS,
    twoFingerTapMs: TWO_FINGER_TAP_MS,
    palmMs: PALM_MS,
    palmContactPx: PALM_CONTACT_PX,
    ...(quick ? { quickPinch: QUICK_PINCH } : {}),
    onQuickPinch: () => grammar.quickPinch(),
    routing: (): ArbiterRouting => store.get().input.routing,
    claims(press) {
      if (press.pointerType === 'pen') deps.penFound();
      thumb.forDrag();
      const s = app.session.getState();
      return claimOf(app, {
        paneId: press.paneId,
        x: press.x,
        y: press.y,
        hit: press.hit,
        tool: s.tools.viewport,
        selectedControls: s.selection.controls,
        jointsSelected: s.selection.joints.length > 0,
        overMesh: () => deps.overMesh(press.paneId, press.x, press.y),
        marquee: store.get().thumb.latch !== 'off',
      });
    },
    onTap(tap) {
      thumb.forTap();
      grammar.notePointer(tap.pointerType);
      return grammar.tap(tap);
    },
    onDoubleTap: (tap) => grammar.doubleTap(tap),
    onLongPress: (tap) => grammar.longPress(tap),
    onTwoFingerTap: () => grammar.twoFingerTap(),
  };
}
