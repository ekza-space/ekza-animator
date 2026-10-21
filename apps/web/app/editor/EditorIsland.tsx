'use client';

import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// The editor touches WebGL, workers and `window`: it is a client-only island, never server-rendered.
const Editor = dynamic(() => import('@ekza-studio/editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">Loading editor…</output>
  ),
});

/** Inlined at build time: e2e builds expose the test API on `?e2e=1` (MVP-SPEC §4.8). */
const E2E_BUILD = process.env.NEXT_PUBLIC_EKZA_E2E === '1';
/** M6a (M6A-SPEC §3 rule 8): development and e2e builds validate every mesh commit. */
const KERNEL_DEBUG = process.env.NODE_ENV !== 'production' || E2E_BUILD;

export function EditorIsland(): JSX.Element {
  return (
    <Editor
      decoderPath="/decoders/"
      samplesPath="/samples/"
      libraryPath="/library/"
      e2e={E2E_BUILD}
      kernelDebug={KERNEL_DEBUG}
    />
  );
}
