// Frame requests inside R3F's demand loop. R3F only keeps looping when a frame is requested from within a
// `useFrame` callback; a request from a global 'before' effect is consumed by the same frame, and one from an
// 'after' effect is lost when the loop stops. The gate defers requests made during a frame to the right moment:
// before/render → re-invalidate inside the render callback; after → a microtask once the loop has stopped.

export type FramePhase = 'idle' | 'before' | 'render' | 'after';

export interface FrameGate {
  readonly phase: FramePhase;
  /** Marks where R3F's loop is (global effects and the render callback call it). */
  enter(phase: FramePhase): void;
  /** Binds the root's invalidate once the canvas exists (null when it goes away). */
  bind(invalidate: (() => void) | null): void;
  /** `app.requestFrame()` lands here. */
  request(): void;
  /** Called from the render callback: true when a frame was requested before or during it. */
  takeContinuation(): boolean;
}

export function createFrameGate(): FrameGate {
  let continuation = false;
  let microtaskQueued = false;
  let phase: FramePhase = 'idle';
  let invalidate: (() => void) | null = null;
  return {
    get phase() {
      return phase;
    },
    enter(next: FramePhase): void {
      phase = next;
    },
    bind(next: (() => void) | null): void {
      invalidate = next;
    },
    request(): void {
      if (invalidate === null) return;
      if (phase === 'before' || phase === 'render') {
        continuation = true;
        return;
      }
      if (phase === 'after') {
        if (microtaskQueued) return;
        microtaskQueued = true;
        queueMicrotask(() => {
          microtaskQueued = false;
          invalidate?.();
        });
        return;
      }
      invalidate();
    },
    takeContinuation(): boolean {
      const value = continuation;
      continuation = false;
      return value;
    },
  };
}
