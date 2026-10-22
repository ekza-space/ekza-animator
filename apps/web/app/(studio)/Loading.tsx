import type { JSX } from 'react';

/** The page's loading text until the host and the route's shell have arrived (AUTORIG-SPEC §4.4). */
export function Loading(props: { readonly autorig: boolean }): JSX.Element {
  return (
    <output className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-3">
      {props.autorig ? 'Loading Auto-Rig…' : 'Loading editor…'}
    </output>
  );
}
