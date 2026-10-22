// The Auto-Rig shell (AUTORIG-SPEC §4.1, §5.1; D0 stub, D3 replaces it): the wizard frame over the host's EditorApp
// (`@ekza-studio/editor/host`), its pane grid, steps and progress. D0's stub renders the placeholder page of
// `/autorig` (no editor code), so the route builds and `check:size` measures it; it references the shell marker so the
// `autorig-shell` boundary is recognisable in every build.
import { createElement, type JSX } from 'react';
import { messages } from '../i18n';
import { AUTORIG_SHELL_MARKER } from '../types';

export interface AutoRigShellProps {
  /** Where "Open Studio" goes (default `/editor`). */
  readonly studioHref?: string;
}

export function AutoRigShell(props: AutoRigShellProps): JSX.Element {
  const t = messages().frame;
  return createElement(
    'main',
    {
      'data-shell': AUTORIG_SHELL_MARKER,
      'data-testid': 'autorig-placeholder',
      className: 'grid min-h-dvh place-items-center bg-app p-4 text-fg',
    },
    createElement(
      'section',
      { className: 'flex max-w-md flex-col gap-3', 'aria-labelledby': 'autorig-title' },
      createElement('h1', { id: 'autorig-title', className: 'text-lg font-semibold' }, t.placeholderTitle),
      createElement('p', { className: 'text-sm text-fg-2' }, t.placeholderBody),
      createElement(
        'a',
        {
          href: props.studioHref ?? '/editor',
          className: 'text-sm text-accent-text underline-offset-4 hover:underline',
        },
        t.openStudio,
      ),
    ),
  );
}
