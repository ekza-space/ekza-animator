// Auto-Rig shell switch for the palette, scripts and the MCP bridge (AUTORIG-SPEC §3.4, §4.5; D1):
// `autorig.navigate {to, workspace?, from?, newTab?}` wraps the host's navigation port (`provideNavigation`,
// `hostNavigation`, eager, `workspaces/ports.ts`); without a port (headless, Node) it fails its poll with "No
// navigation in this host". UI controls call the port directly, never through this chunk. Not undoable (U): it changes
// the page, never the document.
//
// Limitation of `newTab: true` here (AR-D1-14): the port opens the tab in `prepare`, after the runner has awaited this
// chunk (on its first use) and anything before it, so from the palette or the MCP bridge the user gesture's transient
// activation may have expired and the browser blocks the pop-up. The port then hands over through the record in this
// tab (the page-load fallback: the document arrives, the source page is replaced). A UI control that must open a tab
// calls the port directly from its own click handler, as the shipped buttons do.
import { EkzaError } from '@ekza-studio/anim-core';
import { GLOBAL_SCOPE, type ShellRoute } from '../../../../types';
import { isRecord } from '../../../../workflows/util';
import { hostNavigation } from '../../../../workspaces/ports';
import { type AnyOperator, defineOperator, fail, OK } from '../../define';

/** The poll reason without a navigation port (headless hosts). */
export const NO_NAVIGATION = 'No navigation in this host';

// STUDIO-TOUCH-SPEC §20.3 item 11 (T2): unchanged — `halo` is not one of its routes (its agent schema stays as it is);
// every route, Halo's included, is `shell.navigate`'s (`../../shellNavigate.ts`).
const ROUTES: readonly Exclude<ShellRoute, 'halo'>[] = ['autorig', 'studio', 'chooser'];
const EXPECTS = `expects { to: ${ROUTES.map((route) => `'${route}'`).join(' | ')} }`;

const navigate = defineOperator<'autorig.navigate'>({
  id: 'autorig.navigate',
  label: 'Switch Mode',
  description: 'Switch between Studio and Auto-Rig keeping the document, or open it in a new tab.',
  category: 'autorig',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if (hostNavigation(app) === null) return fail(NO_NAVIGATION);
    if (!isRecord(args) || !ROUTES.includes(args.to)) return fail(EXPECTS);
    const { workspace, from, newTab } = args;
    if (workspace !== undefined && typeof workspace !== 'string') return fail('workspace must be a workspace id');
    if (from !== undefined && from !== 'studio' && from !== 'autorig') {
      return fail("from must be 'studio' or 'autorig'");
    }
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
