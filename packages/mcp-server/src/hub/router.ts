// Project routing (MCP-SPEC §4.6, §5.1): a project handle → the paired tab or a headless project. Omitted: the only
// open project (the paired tab counts); none → `not_connected`; several → `ambiguous` with the handles as
// candidates; an unknown, closed or idle-closed handle → `expired_handle`.
import { AgentToolFailure } from '@ekza-studio/agent-tools';
import type { HeadlessProject, HeadlessProjectManager } from '../headless/projects';
import type { TabLink } from './link';

export type ProjectTarget =
  | { readonly kind: 'tab'; readonly handle: string; readonly tab: TabLink }
  | { readonly kind: 'headless'; readonly handle: string; readonly project: HeadlessProject };

export interface RouteSources {
  readonly tab: TabLink | null;
  readonly projects: HeadlessProjectManager;
}

export function routeProject(handle: string | undefined, sources: RouteSources): ProjectTarget {
  const { tab, projects } = sources;
  if (handle === undefined) {
    const handles = projects.handles();
    const count = handles.length + (tab === null ? 0 : 1);
    if (count === 0) {
      throw new AgentToolFailure(
        'not_connected',
        'No editor is paired and no project is open.',
        'call project_open {path} with an .ekzanim, .vrm or .glb in the workspace folder (or {sample: "polybot"}), ' +
          'or editor_connect with the code the user gives you',
      );
    }
    if (count > 1) {
      const candidates = [...(tab === null ? [] : [`${tab.handle} (the editor tab)`]), ...handles].slice(0, 5);
      throw new AgentToolFailure(
        'ambiguous',
        `${count} projects are open.`,
        'pass project with one of the handles (projects_list shows their names)',
        { candidates },
      );
    }
    if (tab !== null) return { kind: 'tab', handle: tab.handle, tab };
    const only = handles[0] as string;
    return { kind: 'headless', handle: only, project: projects.get(only) };
  }
  if (handle.startsWith('tab_')) {
    if (tab !== null && tab.handle === handle) return { kind: 'tab', handle, tab };
    throw new AgentToolFailure(
      'expired_handle',
      'This editor pairing has ended.',
      'ask the user for a new pairing code and call editor_connect, or use a headless project',
    );
  }
  return { kind: 'headless', handle, project: projects.get(handle) };
}
