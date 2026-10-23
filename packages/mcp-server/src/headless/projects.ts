// Headless projects (MCP-SPEC §4.6, §5.17.1): `prj_…` handles, ≤ 4 open, idle close, one AgentToolRuntime per project.
// D0 stub; P6 implements.
import { EkzaError } from '@ekza-studio/anim-core';

export interface HeadlessProjectManager {
  open(opts: {
    readonly path?: string;
    readonly sample?: string;
    readonly name?: string;
  }): Promise<{ readonly project: string }>;
  close(project: string, opts?: { readonly discardChanges?: boolean }): Promise<void>;
  list(): readonly { readonly project: string; readonly name: string; readonly dirty: boolean }[];
}

export function createHeadlessProjectManager(): HeadlessProjectManager {
  throw new EkzaError('not-implemented', 'ekza-studio-mcp.createHeadlessProjectManager');
}
