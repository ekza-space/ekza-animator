'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';
import { Loading } from '../Loading';

// AUTORIG-SPEC §3.1, §7.2: the Auto-Rig shell's entry group — the only importer of @ekza-studio/autorig, so `/editor`
// never loads it (`autorig-shell` boundary). Client-only, like the editor's.
const AutoRigEntry = dynamic(() => import('./AutoRigEntry').then((m) => m.AutoRigEntry), {
  ssr: false,
  loading: () => <Loading text="Loading Auto-Rig…" />,
});

export function AutoRigEntryIsland(): JSX.Element {
  return <AutoRigEntry />;
}
