'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// The shell touches WebGL and `window`: client-only, like the editor island.
const ShellHarness = dynamic(() => import('@ekza-studio/editor/testing').then((m) => m.ShellHarness), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading shell harness…</output>
  ),
});

export function ShellHarnessIsland(props: { readonly snapshot: unknown; readonly skeleton: unknown }): JSX.Element {
  return <ShellHarness snapshot={props.snapshot} skeleton={props.skeleton} />;
}
