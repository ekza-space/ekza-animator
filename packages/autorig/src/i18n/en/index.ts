// The English message table (AUTORIG-SPEC §8.4; D0, closed): one table per owner, so parallel packages never share a
// file. Only the frame's and ①'s tables are eager (the first visit shows them); each later step's table loads with
// that step's chunks and registers itself (`steps/<step>/strings.ts`, D7 AR-D7-2), so `/autorig`'s first visit does not
// carry the strings of ②–⑤.
import type { animations } from './animations';
import type { exportStep } from './export';
import { frame } from './frame';
import type { markers } from './markers';
import { model } from './model';
import type { rig } from './rig';

/** Every section of the English table, eager or not. */
export interface EnMessages {
  readonly frame: typeof frame;
  readonly model: typeof model;
  readonly markers: typeof markers;
  readonly rig: typeof rig;
  readonly animations: typeof animations;
  readonly export: typeof exportStep;
}

/** The eager sections; the others arrive through `registerMessages`. */
export const en = { frame, model } as const;
