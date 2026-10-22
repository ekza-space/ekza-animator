'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';
import { Loading } from './Loading';

function LoadingRoute(): JSX.Element {
  return <Loading autorig={usePathname().startsWith('/autorig')} />;
}

// The host touches WebGL, workers and `window`: a client-only island, never server-rendered. Its chunk group carries
// the `ekza-studio-host` marker (AUTORIG-SPEC §7.2 rule 4); the route's shell loads from inside it.
const StudioHostEntry = dynamic(() => import('./StudioHostEntry').then((m) => m.StudioHostEntry), {
  ssr: false,
  loading: () => <LoadingRoute />,
});

export function StudioHostIsland(props: { readonly children: ReactNode }): JSX.Element {
  return <StudioHostEntry>{props.children}</StudioHostEntry>;
}
