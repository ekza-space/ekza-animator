import type { Metadata } from 'next';
import type { JSX } from 'react';
import { AutoRigIsland } from './AutoRigIsland';

export const metadata: Metadata = {
  title: 'Auto-Rig',
};

/** `/autorig` (AUTORIG-SPEC §3.1): the Auto-Rig wizard. D0's placeholder mounts the shell stub. */
export default function AutoRigPage(): JSX.Element {
  return <AutoRigIsland />;
}
