// Playback-row glyphs (16×16, currentColor). Local until the ui package ships its icon set (WP-8).
import type { JSX } from 'react';

export type TimelineIconName =
  | 'start'
  | 'prevKey'
  | 'prevFrame'
  | 'playBack'
  | 'play'
  | 'stop'
  | 'nextFrame'
  | 'nextKey'
  | 'end'
  | 'once'
  | 'loop'
  | 'oscillate';

const PATHS: Readonly<Record<TimelineIconName, JSX.Element>> = {
  start: (
    <>
      <rect x="2.5" y="3" width="1.6" height="10" />
      <path d="M13 3v10L5 8z" />
    </>
  ),
  prevKey: (
    <>
      <path d="M8 3v10L2 8z" />
      <path d="M11.5 5l2.5 3-2.5 3L9 8z" />
    </>
  ),
  prevFrame: (
    <>
      <path d="M11 3v10L4 8z" />
      <rect x="12" y="3" width="1.6" height="10" />
    </>
  ),
  playBack: <path d="M12 3v10L4 8z" />,
  play: <path d="M4 3v10l8-5z" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  nextFrame: (
    <>
      <rect x="2.4" y="3" width="1.6" height="10" />
      <path d="M5 3v10l7-5z" />
    </>
  ),
  nextKey: (
    <>
      <path d="M8 3v10l6-5z" />
      <path d="M4.5 5L7 8l-2.5 3L2 8z" />
    </>
  ),
  end: (
    <>
      <path d="M3 3v10l8-5z" />
      <rect x="11.9" y="3" width="1.6" height="10" />
    </>
  ),
  once: (
    <>
      <path d="M2 7.25h8v1.5H2z" />
      <path d="M9 4.5L12.5 8 9 11.5z" />
      <rect x="12.5" y="3.5" width="1.5" height="9" />
    </>
  ),
  loop: <path d="M8 3a5 5 0 1 1-4.33 2.5l1.3.75A3.5 3.5 0 1 0 8 4.5V6.5L5 3.75 8 1z" fillRule="evenodd" />,
  oscillate: (
    <>
      <path d="M2 5.25h9v1.5H2z" />
      <path d="M10 2.5L13.5 6 10 9.5z" />
      <path d="M5 9.25h9v1.5H5z" />
      <path d="M6 6.5L2.5 10 6 13.5z" />
    </>
  ),
};

export function TimelineIcon(props: { readonly name: TimelineIconName }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false">
      {PATHS[props.name]}
    </svg>
  );
}
