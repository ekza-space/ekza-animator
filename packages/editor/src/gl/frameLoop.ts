// One frame of the editor (ARCHITECTURE §10 "Frame loop"): first the tasks scheduled before this frame run
// (`app.flushScheduled`: coalesced gesture updates, M2A-SPEC §4.5 / M-1), then the playback clock advances and the
// evaluation service evaluates dirty characters once; after the GL render the 2D canvases redraw. R3F's single rAF
// drives it (`addEffect` / `addAfterEffect`); without WebGL a plain rAF scheduler drives the same hooks, so the Graph
// Editor and time slider still work.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { FrameCallback, FrameHooks } from '../shell/types';

export function createFrameHooks(app: EditorApp, onError: (error: unknown) => void): FrameHooks {
  const before = new Set<FrameCallback>();
  const after = new Set<FrameCallback>();
  const run = (callbacks: Set<FrameCallback>, timestamp: number): void => {
    for (const callback of callbacks) {
      try {
        callback(timestamp);
      } catch (error) {
        onError(error);
      }
    }
  };
  return {
    before,
    after,
    runBefore(timestamp: number): void {
      try {
        app.flushScheduled();
      } catch (error) {
        onError(error);
      }
      try {
        app.playback.advance(timestamp);
        app.evaluation.tick();
      } catch (error) {
        onError(error);
      }
      run(before, timestamp);
      // Playback keeps the demand loop alive; an idle editor renders nothing (ARCHITECTURE §14).
      if (app.playback.running) app.requestFrame();
    },
    runAfter(timestamp: number): void {
      run(after, timestamp);
    },
  };
}

export interface FallbackScheduler {
  /** Schedules one frame (coalesced with an already scheduled one). */
  request(): void;
  dispose(): void;
}

/** rAF-driven frames for editors without a WebGL canvas. */
export function createFallbackScheduler(hooks: FrameHooks): FallbackScheduler {
  let handle: number | null = null;
  let disposed = false;
  const tick = (timestamp: number): void => {
    handle = null;
    if (disposed) return;
    hooks.runBefore(timestamp);
    hooks.runAfter(timestamp);
  };
  return {
    request(): void {
      if (disposed || handle !== null) return;
      handle = requestAnimationFrame(tick);
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
