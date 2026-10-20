'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// three.js loaders and `window`: client-only, like the editor island.
const ModelCheck = dynamic(() => import('./ModelCheck').then((m) => m.ModelCheck), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading model check…</output>
  ),
});

export function ModelCheckIsland(): JSX.Element {
  return <ModelCheck />;
}
