'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';
import { Loading } from '../Loading';

// The editor touches WebGL, workers and `window`: a client-only island, never server-rendered (one chunk group).
const EditorEntry = dynamic(() => import('./EditorEntry').then((m) => m.EditorEntry), {
  ssr: false,
  loading: () => <Loading text="Loading editor…" />,
});

export function EditorEntryIsland(): JSX.Element {
  return <EditorEntry />;
}
