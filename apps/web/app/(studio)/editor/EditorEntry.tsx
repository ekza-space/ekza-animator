'use client';

import { StudioHost, StudioShell } from '@ekza-studio/editor';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { hostProps } from '../hostProps';
import { useShellEntry } from '../StudioHostIsland';

/** `/editor`'s entry group (AUTORIG-SPEC §4.4): the page's host and Studio's shell, registered with the layout. */
export function EditorEntry(): null {
  const router = useRouter();
  const entry = useMemo(
    () => ({ Host: StudioHost, Shell: StudioShell, props: hostProps((href) => router.push(href)) }),
    [router],
  );
  useShellEntry(entry);
  return null;
}
