'use client';

import { StudioHost } from '@ekza-studio/editor/host';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, lazy, type ReactNode, useCallback } from 'react';
import { Loading } from './Loading';

// The `(studio)` layout's host (AUTORIG-SPEC §4.4, D1): `StudioHost` once per page load, the route's shell below it.
// Each shell is a `React.lazy` group loaded from here, inside the host's chunk group, so it shares every module the
// host already has (the kernel, three.js, the viewport) instead of carrying a copy: the Studio shell (`ekza-studio-shell`:
// dockview, panels, menus) only on `/editor`, the Auto-Rig shell (`ekza-autorig-shell`) only on `/autorig`.
const StudioShell = lazy(() => import('@ekza-studio/editor').then((m) => ({ default: m.StudioShell })));
const AutoRigShell = lazy(() => import('@ekza-studio/autorig').then((m) => ({ default: m.AutoRigShell })));

/** Inlined at build time: e2e builds expose the test API on `?e2e=1` (MVP-SPEC §4.8). */
const E2E_BUILD = process.env.NEXT_PUBLIC_EKZA_E2E === '1';
/** M6a (M6A-SPEC §3 rule 8): development and e2e builds validate every mesh commit. */
const KERNEL_DEBUG = process.env.NODE_ENV !== 'production' || E2E_BUILD;

export function StudioHostEntry(props: { readonly children?: ReactNode }): JSX.Element {
  const autorig = usePathname().startsWith('/autorig');
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  return (
    <StudioHost
      decoderPath="/decoders/"
      samplesPath="/samples/"
      libraryPath="/library/"
      e2e={E2E_BUILD}
      kernelDebug={KERNEL_DEBUG}
      navigate={navigate}
      fallback={<Loading autorig={autorig} />}
    >
      {autorig ? <AutoRigShell studioHref="/editor" /> : <StudioShell />}
      {props.children}
    </StudioHost>
  );
}
