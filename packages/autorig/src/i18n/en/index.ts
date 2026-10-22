// The English message table (AUTORIG-SPEC §8.4; D0, closed): one table per owner merged here, so parallel packages
// never share a file.
import { animations } from './animations';
import { exportStep } from './export';
import { frame } from './frame';
import { markers } from './markers';
import { model } from './model';
import { rig } from './rig';

export const en = { frame, model, markers, rig, animations, export: exportStep } as const;
