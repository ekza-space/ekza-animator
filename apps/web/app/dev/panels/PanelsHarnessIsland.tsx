'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// The harness reads the URL and touches `window`: client-only, like the editor island.
const PanelHarness = dynamic(() => import('@ekza-studio/editor/testing').then((m) => m.PanelHarness), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading panel harness…</output>
  ),
});

export function PanelsHarnessIsland(props: { readonly snapshot: unknown; readonly skeleton: unknown }): JSX.Element {
  return <PanelHarness snapshot={props.snapshot} skeleton={props.skeleton} />;
}
