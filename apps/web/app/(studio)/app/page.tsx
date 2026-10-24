import type { Metadata } from 'next';
import type { JSX } from 'react';
import { HaloEntryIsland } from './HaloEntryIsland';

export const metadata: Metadata = {
  // "Ekza Studio" is the product's name (STUDIO-TOUCH-SPEC §1.1), not "… · Ekza Studio".
  title: { absolute: 'Ekza Studio' },
};

/**
 * `/app` (STUDIO-TOUCH-SPEC §20.1; T2): Ekza Studio's Simple layout. Its entry registers the host and the Halo shell
 * with the `(studio)` layout, so a switch to `/editor` or `/autorig` keeps the document and its undo history. Reached
 * by URL only until T12 turns on the new entry (ST-30).
 */
export default function HaloPage(): JSX.Element {
  return <HaloEntryIsland />;
}
