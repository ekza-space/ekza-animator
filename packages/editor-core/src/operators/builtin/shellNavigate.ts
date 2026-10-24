// The host-level shell switch (STUDIO-TOUCH-SPEC §20.3 item 11, §16; T2): `shell.navigate {to, workspace?, from?,
// newTab?, then?}` wraps the host's navigation port (`hostNavigation`) for every route — Ekza Studio (`halo`, `/app`),
// Studio Pro (`studio`, `/editor`), Auto-Rig (`autorig`) and the chooser — for the palette, search and scripts. The
// page host registers it next to `ui.open` and `prefs.set` (`registerShellNavigate`), so it exists wherever a
// navigation port can. It is denied to agents (`agent` below, and unclassified in the agent policy table), so the MCP
// toolset does not change; `autorig.navigate` keeps its own routes and schema. Not undoable (U): it changes the page,
// never the document. A UI control calls the port directly from its tap handler instead (a tab opened after an await
// is a blocked pop-up; see `autorig.navigate`'s note on `newTab`).
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import { type EditorApp, GLOBAL_SCOPE, type ShellKind, type ShellRoute } from '../../types';
import { isRecord } from '../../workflows/util';
import { hostNavigation } from '../../workspaces/ports';
import { type AnyOperator, defineOperator, fail, OK } from './define';

/** The poll reason without a navigation port (a headless app, a harness without a host). */
export const NO_SHELL_NAVIGATION = 'No navigation in this host';

/** Every route `shell.navigate` switches to. */
export const SHELL_ROUTES: readonly ShellRoute[] = ['halo', 'studio', 'autorig', 'chooser'];
const KINDS: readonly ShellKind[] = ['halo', 'studio', 'autorig'];
const ARRIVALS = ['preset', 'panel', 'dialog'] as const;

const quoted = (ids: readonly string[]): string => ids.map((id) => `'${id}'`).join(' | ');
const EXPECTS = `expects { to: ${quoted(SHELL_ROUTES)} }`;

/** `then`: `{ kind: 'preset', preset }`, `{ kind: 'panel', panel }` or `{ kind: 'dialog', dialog }` (an id string). */
function isArrival(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = ARRIVALS.find((candidate) => candidate === value['kind']);
  return kind !== undefined && typeof value[kind] === 'string' && value[kind] !== '';
}

const navigate = defineOperator<'shell.navigate'>({
  id: 'shell.navigate',
  label: 'Switch Layout',
  description:
    'Switch between Ekza Studio, Studio Pro and Auto-Rig keeping the document, or open it in a new tab.',
  category: 'ui',
  scope: GLOBAL_SCOPE,
  aliases: ['Pro layout', 'Simple layout', 'Switch Mode'],
  agent: { policy: 'denied', reason: "switches the user's layout; agents work in the shell the user has open" },
  poll({ app }, args) {
    if (hostNavigation(app) === null) return fail(NO_SHELL_NAVIGATION);
    if (!isRecord(args) || !SHELL_ROUTES.includes(args.to)) return fail(EXPECTS);
    const { workspace, from, newTab, then } = args;
    if (workspace !== undefined && typeof workspace !== 'string') return fail('workspace must be a workspace id');
    if (from !== undefined && !KINDS.includes(from)) return fail(`from must be ${quoted(KINDS)}`);
    if (newTab !== undefined && typeof newTab !== 'boolean') return fail('newTab must be true or false');
    if (then !== undefined && !isArrival(then)) {
      return fail(`then expects { kind: ${quoted(ARRIVALS)}, <kind>: an id }`);
    }
    return OK;
  },
  async prepare({ app }, args) {
    const port = hostNavigation(app);
    if (port === null) throw new EkzaError('unsupported', NO_SHELL_NAVIGATION);
    await port.go({
      to: args.to,
      ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      ...(args.from === undefined ? {} : { from: args.from }),
      ...(args.newTab === undefined ? {} : { newTab: args.newTab }),
      ...(args.then === undefined ? {} : { then: args.then }),
    });
  },
  apply() {},
});

export const SHELL_NAVIGATE_OPERATORS: readonly AnyOperator[] = [navigate];

/** Registers `shell.navigate` (the page host, on every route); the disposer removes it. */
export function registerShellNavigate(app: EditorApp): Disposer {
  const disposers = SHELL_NAVIGATE_OPERATORS.map((def) => app.contribute({ kind: 'operator', def }));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
