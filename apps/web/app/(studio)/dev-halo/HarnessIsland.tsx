'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';
import { Loading } from '../Loading';

// The harness's entry group (client-only, like the three routes' entries): only this dev route imports it.
const HarnessEntry = dynamic(() => import('./HarnessEntry').then((m) => m.HarnessEntry), {
  ssr: false,
  loading: () => <Loading text="Loading the T6b harness…" />,
});

export function HarnessIsland(): JSX.Element {
  return <HarnessEntry />;
}
