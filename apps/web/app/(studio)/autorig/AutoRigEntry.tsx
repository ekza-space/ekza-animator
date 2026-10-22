'use client';

import { AutoRigShell } from '@ekza-studio/autorig';
import { StudioHost } from '@ekza-studio/editor/host';
import { useRouter } from 'next/navigation';
import { type JSX, useMemo } from 'react';
import { hostProps } from '../hostProps';
import { useShellEntry } from '../StudioHostIsland';

/** The Auto-Rig wizard as the route's shell (AUTORIG-SPEC §4.1, §5; D3). */
function Shell(): JSX.Element {
  return <AutoRigShell />;
}

/** `/autorig`'s entry group (AUTORIG-SPEC §4.4): the page's host and the Auto-Rig shell, registered with the layout. */
export function AutoRigEntry(): null {
  const router = useRouter();
  const entry = useMemo(() => ({ Host: StudioHost, Shell, props: hostProps((href) => router.push(href)) }), [router]);
  useShellEntry(entry);
  return null;
}
