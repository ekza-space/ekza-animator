'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// AUTORIG-SPEC §3.1 (D0 placeholder; D1 moves the route under the `(studio)` layout, D3 owns it after): the Auto-Rig
// shell is a client-only island loaded from `@ekza-studio/autorig`, the only importer of that package, so `/editor`
// never loads it (`autorig-shell` boundary, §7.2).
const AutoRigShell = dynamic(() => import('@ekza-studio/autorig').then((m) => m.AutoRigShell), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading Auto-Rig…</output>
  ),
});

export function AutoRigIsland(): JSX.Element {
  return <AutoRigShell studioHref="/editor" />;
}
