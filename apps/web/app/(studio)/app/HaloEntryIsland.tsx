'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';
import { Loading } from '../Loading';

// STUDIO-TOUCH-SPEC §20.1, §20.6 (T2): the Halo shell's entry group — the only importer of @ekza-studio/halo, so
// `/editor` and `/autorig` never load it (`halo-shell` boundary). Client-only, like the other two routes'.
const HaloEntry = dynamic(() => import('./HaloEntry').then((m) => m.HaloEntry), {
  ssr: false,
  loading: () => <Loading text="Loading Ekza Studio…" />,
});

export function HaloEntryIsland(): JSX.Element {
  return <HaloEntry />;
}
