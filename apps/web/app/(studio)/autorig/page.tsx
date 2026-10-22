import type { Metadata } from 'next';
import type { JSX } from 'react';
import { AutoRigEntryIsland } from './AutoRigEntryIsland';

export const metadata: Metadata = {
  title: 'Auto-Rig',
};

/** `/autorig` (AUTORIG-SPEC §3.1): its entry registers the host and the Auto-Rig shell with the `(studio)` layout. */
export default function AutoRigPage(): JSX.Element {
  return <AutoRigEntryIsland />;
}
