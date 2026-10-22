// Auto-Rig shell switch for the palette, scripts and the MCP bridge (AUTORIG-SPEC §3.4, §4.5; D0 stub, D1 replaces
// it): `autorig.navigate {to, workspace?, from?, newTab?}` wraps the host's navigation port (`provideNavigation`,
// `hostNavigation`, eager, D1); without a port (headless) it fails its poll with "No navigation in this host". UI
// controls call the port directly, never through this chunk.
import type { AnyOperator } from '../../define';
import { wizardStub } from './compose';

export const WIZARD_NAVIGATE_OPERATORS: readonly AnyOperator[] = [wizardStub('autorig.navigate', 'Switch Mode')];
