// The workspace sandbox (MCP-SPEC §5.17.3): lexical checks before any filesystem call, realpath inside realpath'd
// roots, the extension allow-list, overwrites with a `.ekza-trash/` backup, size caps; refuses `/`, the home folder
// and system folders as a default root. D0 stub; P6 implements.
import { EkzaError } from '@ekza-animator/anim-core';

export interface WorkspaceSandbox {
  readonly root: string;
  read(path: string): Promise<{ readonly path: string; readonly bytes: Uint8Array }>;
  write(
    path: string,
    bytes: Uint8Array,
    opts: { readonly overwrite: boolean },
  ): Promise<{ readonly path: string; readonly backup: string | null }>;
}

export function createWorkspaceSandbox(_opts: {
  readonly root: string;
  readonly readOnlyRoots: readonly string[];
}): WorkspaceSandbox {
  throw new EkzaError('not-implemented', 'ekza-animator-mcp.createWorkspaceSandbox');
}
