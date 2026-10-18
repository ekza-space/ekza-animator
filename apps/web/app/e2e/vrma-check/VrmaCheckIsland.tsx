'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// three.js loaders and `window`: client-only, like the editor island.
const VrmaCheck = dynamic(() => import('./VrmaCheck').then((m) => m.VrmaCheck), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading VRMA check…</output>
  ),
});

export function VrmaCheckIsland(): JSX.Element {
  return <VrmaCheck />;
}
