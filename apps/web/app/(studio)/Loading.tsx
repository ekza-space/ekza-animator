import type { JSX } from 'react';

/**
 * A route's loading text until its entry group has arrived (AUTORIG-SPEC §4.4): fixed over the page, so on a switch
 * between the two routes it covers the host for the moment the arriving shell's code loads.
 */
export function Loading(props: { readonly text: string }): JSX.Element {
  return <output className="fixed inset-0 z-50 grid place-items-center bg-app text-sm text-fg-3">{props.text}</output>;
}
