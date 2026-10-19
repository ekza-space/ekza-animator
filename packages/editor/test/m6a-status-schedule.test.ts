// M6A-SPEC §4.6 (`status?(app)`: read on human-speed changes only), MVP-SPEC §3 (no per-frame work in hot paths;
// B9): when the workspace tabs re-read their status glyphs. Deterministic timers drive the schedule frame by frame.
import { describe, expect, it } from 'vitest';
import { createStatusSchedule, STATUS_SETTLE_MS, type StatusTimers } from '../src/shell/statusSchedule';

/** Manual timers: `advance` runs every due callback in time order; `armed` counts every `set` call. */
function manualTimers(): { timers: StatusTimers; advance(ms: number): void; pending(): number; armed(): number } {
  let now = 0;
  let armed = 0;
  const queue: { at: number; fn: () => void; handle: object }[] = [];
  const timers: StatusTimers = {
    set(fn, ms) {
      armed += 1;
      const handle = {};
      queue.push({ at: now + ms, fn, handle });
      return handle;
    },
    clear(handle) {
      const index = queue.findIndex((entry) => entry.handle === handle);
      if (index >= 0) queue.splice(index, 1);
    },
  };
  return {
    timers,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending: () => queue.length,
    armed: () => armed,
  };
}

/** A drag: one preview frame every 16 ms for `ms`. */
function drag(clock: ReturnType<typeof manualTimers>, schedule: { preview(): void }, ms: number): void {
  for (let t = 0; t < ms; t += 16) {
    schedule.preview();
    clock.advance(16);
  }
}

describe('workspace status re-reads (§4.6 human speed)', () => {
  it('coalesces committed changes into one re-read at most STATUS_SETTLE_MS later', () => {
    const clock = manualTimers();
    let reads = 0;
    const schedule = createStatusSchedule(() => (reads += 1), clock.timers);
    for (let i = 0; i < 50; i += 1) schedule.committed();
    expect(reads).toBe(0);
    clock.advance(STATUS_SETTLE_MS - 1);
    expect(reads).toBe(0);
    clock.advance(1);
    expect(reads).toBe(1);
    expect(clock.armed()).toBe(1);
    // Quiet: nothing more is armed or read.
    clock.advance(STATUS_SETTLE_MS * 4);
    expect(reads).toBe(1);
    expect(clock.pending()).toBe(0);
    // A later change is read again.
    schedule.committed();
    clock.advance(STATUS_SETTLE_MS);
    expect(reads).toBe(2);
  });

  it('reads nothing during a 2 s drag of preview frames and arms one timer per window, not per frame', () => {
    const clock = manualTimers();
    let reads = 0;
    const schedule = createStatusSchedule(() => (reads += 1), clock.timers);
    drag(clock, schedule, 2000);
    expect(reads).toBe(0);
    // 125 frames, ≤ 9 windows of 250 ms.
    expect(clock.armed()).toBeLessThanOrEqual(Math.ceil(2000 / STATUS_SETTLE_MS) + 1);
    // The drag stops without a commit (cancelled): one re-read once the previews have been quiet.
    clock.advance(2 * STATUS_SETTLE_MS);
    expect(reads).toBe(1);
    clock.advance(STATUS_SETTLE_MS * 4);
    expect(reads).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it('a committed change during a drag is read at the end of its window; the drag stays unread afterwards', () => {
    const clock = manualTimers();
    let reads = 0;
    const schedule = createStatusSchedule(() => (reads += 1), clock.timers);
    drag(clock, schedule, 400);
    expect(reads).toBe(0);
    schedule.committed(); // e.g. a remote batch while the drag goes on
    drag(clock, schedule, STATUS_SETTLE_MS);
    expect(reads).toBe(1);
    drag(clock, schedule, 1000);
    expect(reads).toBe(1);
    // The drag commits: read within one window.
    schedule.committed();
    clock.advance(STATUS_SETTLE_MS);
    expect(reads).toBe(2);
  });

  it('dispose cancels a pending re-read and arms nothing afterwards', () => {
    const clock = manualTimers();
    let reads = 0;
    const schedule = createStatusSchedule(() => (reads += 1), clock.timers);
    schedule.committed();
    expect(clock.pending()).toBe(1);
    schedule.dispose();
    expect(clock.pending()).toBe(0);
    schedule.committed();
    schedule.preview();
    clock.advance(STATUS_SETTLE_MS * 4);
    expect(reads).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
