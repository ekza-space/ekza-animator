// Auto-Rig shell switch for the palette, scripts and the MCP bridge (AUTORIG-SPEC §3.4, §4.5; D1):
// `autorig.navigate {to, workspace?, from?, newTab?}` wraps the host's navigation port (`provideNavigation`,
// `hostNavigation`, eager, `workspaces/ports.ts`); without a port (headless, Node) it fails its poll with "No
// navigation in this host". UI controls call the port directly, never through this chunk. Not undoable (U): it changes
// the page, never the document.
import { EkzaError } from '@ekza-studio/anim-core';
import { GLOBAL_SCOPE, type ShellRoute } from '../../../../types';
import { isRecord } from '../../../../workflows/util';
import { hostNavigation } from '../../../../workspaces/ports';
import { type AnyOperator, defineOperator, fail, OK } from '../../define';

/** The poll reason without a navigation port (headless hosts). */
export const NO_NAVIGATION = 'No navigation in this host';

const ROUTES: readonly ShellRoute[] = ['autorig', 'studio', 'chooser'];
const EXPECTS = `expects { to: ${ROUTES.map((route) => `'${route}'`).join(' | ')} }`;

const navigate = defineOperator<'autorig.navigate'>({
  id: 'autorig.navigate',
  label: 'Switch Mode',
  description: 'Switch between Studio and Auto-Rig keeping the document, or open it in a new tab.',
  category: 'autorig',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if (hostNavigation(app) === null) return fail(NO_NAVIGATION);
    if (!isRecord(args) || !ROUTES.includes(args['to'] as ShellRoute)) return fail(EXPECTS);
    const { workspace, from, newTab } = args;
    if (workspace !== undefined && typeof workspace !== 'string') return fail('workspace must be a workspace id');
    if (from !== undefined && from !== 'studio' && from !== 'autorig') return fail("from must be 'studio' or 'autorig'");
    if (newTab !== undefined && typeof newTab !== 'boolean') return fail('newTab must be true or false');
    return OK;
  },
  async prepare({ app }, args) {
    const port = hostNavigation(app);
    if (port === null) throw new EkzaError('unsupported', NO_NAVIGATION);
    await port.go({
      to: args.to,
      ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      ...(args.from === undefined ? {} : { from: args.from }),
      ...(args.newTab === undefined ? {} : { newTab: args.newTab }),
    });
  },
  apply() {},
});

export const WIZARD_NAVIGATE_OPERATORS: readonly AnyOperator[] = [navigate];
