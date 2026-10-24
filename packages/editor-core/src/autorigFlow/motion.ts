// The motion test (AUTORIG-SPEC §5.4, L3; moved from Auto-Rig ③ by T5b; STUDIO-TOUCH-SPEC §12.2 step 6): as soon as the
// rig is checked the character plays a loop through C12's library preview (`library.preview {character, clip}`,
// channel source `preview`: no document write, no undo step) — Walk, Sword attack or Dance from the starter pack. C12
// stops the preview on any document change; while the test runs, the driver starts it again once the change has
// committed (a committed batch, never a gesture's preview batches). Stopping the test stops the preview it played.
// React-free: the wizard's `useMotionTest` and Halo's *Test with* chip drive it.
import type { CharacterId } from '@ekza-studio/doc';
import type { AutoRigFlowHost } from './host';

/** The motion test's clips (starter-pack ids, §5.4): Walk, Sword attack, Dance. */
export const MOTION_CLIPS = ['walk', 'sword-attack', 'dance'] as const;

/** The motion test's default clip. */
export const DEFAULT_MOTION_CLIP = 'walk';

/** What the driver reports: playing (null), or the library could not play the clip. */
export type MotionTestState = null | 'unavailable';

/** A running motion test: `stop()` ends it and stops the preview it played (resolves when that stop ran). */
export interface MotionTest {
  stop(): Promise<void>;
}

/**
 * Plays `clip` on `character` until `stop()`, restarting it after document changes. `report` hears whether it plays
 * (null) or the library is unreachable (`'unavailable'`); a cancelled preview reports nothing.
 */
export function startMotionTest(
  host: Pick<AutoRigFlowHost, 'app' | 'quiet'>,
  character: CharacterId,
  clip: string,
  report: (state: MotionTestState) => void = () => {},
): MotionTest {
  const { app } = host;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const start = async (): Promise<void> => {
    try {
      if (!app.library.loaded) await app.library.load();
    } catch {
      if (alive) report('unavailable');
      return;
    }
    if (!alive) return;
    const playing = app.library.service.preview;
    if (playing !== null && playing.character === character && playing.clip === clip) return;
    const result = await host.quiet('library.preview', { character, clip });
    if (!alive) return;
    if (result.status === 'finished') report(null);
    else if (result.status === 'failed' && result.error.code !== 'cancelled') report('unavailable');
  };
  void start();
  const off = app.store.subscribe((batch) => {
    if (batch.origin === 'preview' || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (alive && (!app.library.loaded || app.library.service.preview === null)) void start();
    }, 0);
  });
  return {
    async stop() {
      if (!alive) return;
      alive = false;
      off();
      if (timer !== null) clearTimeout(timer);
      if (app.library.loaded && app.library.service.preview?.character === character) {
        await host.quiet('library.stop');
      }
    },
  };
}
