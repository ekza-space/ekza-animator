// English strings of the wizard frame: header, stepper, footer, progress sheet (AUTORIG-SPEC §5.1, §8.4; D0 landed
// the placeholder page's strings, D3 owns the table).
import type { MessageTable } from '../index';

export const frame = {
  product: 'Auto-Rig',
  placeholderTitle: 'Auto-Rig is on its way',
  placeholderBody:
    'A simple mode to rig a character, try animations and export a VRM for OMOBA and Ekza Space. Until it is ready, ' +
    'Studio has every tool it will use.',
  openStudio: 'Open Studio',
} as const satisfies MessageTable;
