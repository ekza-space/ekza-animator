// The host's navigation port (AUTORIG-SPEC §3.4, §4.4; D1; eager and small): switches between the two shells of the
// `(studio)` layout. A same-page switch is a client navigation (`push`, Next's `router.push`): the layout — and with it
// the EditorApp, the undo history, the selection, the cameras, autosave and the WebGL context — stays, only the shell
// below it changes. Before the push the leaving shell closes its menus and the host closes its dialogs and palette.
// The new-tab flow and the page-load fallback (no `push`: a harness, or the two-island design) hand the document over
// through a one-shot handoff record (`./handoff`, a lazy chunk). The chooser is a plain page load.
import type { AutoRigSubject, HandoffInfo, NavigationRequest, WorkspaceId } from '@ekza-studio/editor-core';
import type { HostNavigation, HostShell } from './types';

/** URL parameters that belong to one route's arrival; every other one (e2e switches, `ns`, …) is kept. */
const ARRIVAL_PARAMS = ['ws', 'handoff', 'from', 'step', 'sample', 'chooser'] as const;

/** The route path and query of a request: `/editor?…&ws=animate` or `/autorig?…&from=studio`. */
export function routeHref(request: NavigationRequest, search: string): string {
  if (request.to === 'chooser') return '/?chooser=1';
  const query = new URLSearchParams(search);
  for (const name of ARRIVAL_PARAMS) query.delete(name);
  if (request.to === 'studio' && request.workspace !== undefined) query.set('ws', request.workspace);
  if (request.from !== undefined) query.set('from', request.from);
  const text = query.toString();
  return `${request.to === 'studio' ? '/editor' : '/autorig'}${text === '' ? '' : `?${text}`}`;
}

export interface NavigationOptions {
  /** A same-page client navigation (Next's `router.push`); absent: every switch hands over through a record. */
  readonly push?: ((href: string) => void) | undefined;
  /** Seams for tests; default the window's. */
  readonly location?: Pick<Location, 'search' | 'assign'>;
  readonly open?: (url: string, target: string) => Window | null;
}

export function createNavigation(
  host: Pick<HostShell, 'mounted' | 'commandPalette' | 'ui' | 'keyboard' | 'runFromUi' | 'app'>,
  opts: NavigationOptions = {},
): HostNavigation {
  let subject: AutoRigSubject | null = null;
  let workspace: WorkspaceId | null = null;
  let received: HandoffInfo | null = null;
  const loc = (): Pick<Location, 'search' | 'assign'> => opts.location ?? window.location;

  /** The leaving shell's cleanup (§4.2 entry order): its menus and tool sessions, then the host's overlays. */
  const leave = (): void => {
    host.mounted.getState()?.leave?.();
    host.commandPalette.close();
    host.ui.getState().confirm?.resolve(false);
    if (host.app.session.getState().dialog !== null) void host.runFromUi('ui.close');
    host.keyboard.reset();
  };

  return {
    async go(request: NavigationRequest): Promise<void> {
      // The new tab opens now, inside the user's gesture (a tab opened after an await is a blocked pop-up).
      const tab = request.newTab === true ? (opts.open ?? window.open.bind(window))('', '_blank') : null;
      const href = routeHref(request, loc().search);
      if (request.to === 'chooser') {
        if (tab === null) loc().assign(href);
        else tab.location.href = href;
        return;
      }
      if (tab !== null || request.newTab === true || opts.push === undefined) {
        const { handOver } = await import('./handoff');
        await handOver(host, request, href, tab, opts.location);
        return;
      }
      leave();
      subject = request.subject ?? null;
      workspace = request.workspace ?? null;
      opts.push(href);
    },
    takeSubject(): AutoRigSubject | null {
      const taken = subject;
      subject = null;
      return taken;
    },
    takeWorkspace(): WorkspaceId | null {
      const taken = workspace;
      workspace = null;
      return taken;
    },
    arrive(info: HandoffInfo): void {
      received = info;
      subject = info.subject;
      workspace = info.workspace;
    },
    takeHandoffInfo(): HandoffInfo | null {
      const taken = received;
      received = null;
      return taken;
    },
  };
}
