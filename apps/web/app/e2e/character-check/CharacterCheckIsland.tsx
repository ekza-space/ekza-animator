'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// three.js loaders and `window`: client-only, like the editor island.
const CharacterCheck = dynamic(() => import('./CharacterCheck').then((m) => m.CharacterCheck), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading character check…</output>
  ),
});

export function CharacterCheckIsland(): JSX.Element {
  return <CharacterCheck />;
}
