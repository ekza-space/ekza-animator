'use client';

import { StudioHost } from '@ekza-studio/editor/host';
import { HaloShell } from '@ekza-studio/halo';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { hostProps } from '../hostProps';
import { useShellEntry } from '../StudioHostIsland';

/** `/app`'s entry group (STUDIO-TOUCH-SPEC §20.1): the page's host and the Halo shell, registered with the layout. */
export function HaloEntry(): null {
  const router = useRouter();
  const entry = useMemo(
    () => ({ Host: StudioHost, Shell: HaloShell, props: hostProps((href) => router.push(href)) }),
    [router],
  );
  useShellEntry(entry);
  return null;
}
