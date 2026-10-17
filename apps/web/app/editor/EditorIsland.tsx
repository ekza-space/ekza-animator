'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// The editor touches WebGL, workers and `window`: it is a client-only island, never server-rendered.
const Editor = dynamic(() => import('@ekza-animator/editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading editor…</output>
  ),
});

/** Inlined at build time: e2e builds expose the test API on `?e2e=1` (MVP-SPEC §4.8). */
const E2E_BUILD = process.env.NEXT_PUBLIC_EKZA_E2E === '1';

export function EditorIsland(): JSX.Element {
  return <Editor decoderPath="/decoders/" samplesPath="/samples/" e2e={E2E_BUILD} />;
}
