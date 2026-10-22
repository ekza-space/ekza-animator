// The whole Studio editor in one tree — `StudioHost` with the `StudioShell` as its route shell (AUTORIG-SPEC §4.4,
// D1) — for the production `Editor` component, the dev/e2e shell harness and the shell's component tests. The app's
// `/editor` route mounts the same two pieces through the `(studio)` layout instead, with the shell as a lazy child.
import type { JSX } from 'react';
import { type CreateAppArgs, StudioHost, type StudioHostProps } from '../host/StudioHost';
import type { PanelRegistry } from '../panels/types';
import { StudioShell } from './EditorShell';
import type { Shell } from './types';

export type { CreateAppArgs };

export interface EditorRootProps extends Omit<StudioHostProps, 'children' | 'createApp'> {
  readonly createApp: NonNullable<StudioHostProps['createApp']>;
  readonly panels?: PanelRegistry;
  /** Called once the shell is mounted, with its disposer-free handle (harnesses expose it to specs). */
  readonly onShell?: (shell: Shell) => (() => void) | undefined;
}

export function EditorRoot(props: EditorRootProps): JSX.Element {
  const { panels, onShell, ...host } = props;
  return (
    <StudioHost {...host}>
      <StudioShell {...(panels === undefined ? {} : { panels })} onShell={onShell} />
    </StudioHost>
  );
}
