// The AgentHost of headless projects (MCP-SPEC §4.4, §4.6, §5.9, §5.17): grants { read, edit, files, workspace }
// (View needs the user's editor), files through the workspace sandbox, confirmations through `confirm: true` arguments
// (no `confirm` capability). The eval harness's simulated user (§9.3.1) adds the `user` and `confirm` capabilities and
// answers confirm cards by its policy.
import type { AgentFileHost, AgentHost, Grants, HostCapability } from '@ekza-studio/agent-tools';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { WorkspaceSandbox } from '../files/sandbox';

export const HEADLESS_GRANTS: Grants = Object.freeze({
  read: true,
  edit: true,
  files: true,
  view: false,
  workspace: true,
});

/** The simulated user's answers (evals and tests only, never reachable from the CLI). */
export interface ConfirmPolicy {
  current(): 'allow' | 'deny';
}

/** The sandbox as an AgentFileHost; `write` also reports the `.ekza-trash/` backup (§6.10 `backup`). */
export function sandboxFileHost(sandbox: WorkspaceSandbox): AgentFileHost {
  return {
    read: (path) => sandbox.read(path),
    write: (path, bytes, opts) => sandbox.write(path, bytes, { overwrite: opts.overwrite }),
  };
}

export function createHeadlessHost(opts: {
  readonly app: EditorApp;
  readonly sandbox: WorkspaceSandbox;
  /** The simulated user (§9.3.1): the host reports `user` and `confirm`, and answers cards by the policy. */
  readonly simulatedUser?: ConfirmPolicy | null;
}): AgentHost {
  const { app } = opts;
  const user = opts.simulatedUser ?? null;
  const capabilities = new Set<HostCapability>(['files.workspace']);
  if (user !== null) {
    capabilities.add('user');
    capabilities.add('confirm');
  }
  return {
    mode: 'headless',
    capabilities,
    grants: () => HEADLESS_GRANTS,
    paused: () => false,
    // A headless document has no pointer: only a preview the simulated user started can be active.
    waitForGesture(signal, maxMs) {
      if (app.store.preview?.active !== true) return Promise.resolve(true);
      return new Promise((resolve) => {
        const started = Date.now();
        const tick = (): void => {
          if (signal.aborted) return resolve(false);
          if (app.store.preview?.active !== true) return resolve(true);
          if (Date.now() - started >= maxMs) return resolve(false);
          setTimeout(tick, 20);
        };
        tick();
      });
    },
    confirm: () => Promise.resolve(user === null ? 'deny' : user.current()),
    files: sandboxFileHost(opts.sandbox),
  };
}
