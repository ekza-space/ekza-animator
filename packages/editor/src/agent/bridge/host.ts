// The live AgentHost (MCP-SPEC §4.4, §5.8, §5.9): the tab's grants and pause, the gesture wait (the user's drag or an
// M6a mesh preview session), the confirm card (through the session store; one card at a time, queued behind each
// other), and files — workspace reads from the bytes the server attached to the current call, workspace writes queued
// for the call's result (the server derives the targets), downloads after the user's confirmation.
import type { AgentFileHost, AgentHost, ConfirmPrompt, Grants, HostCapability } from '@ekza-studio/agent-tools';
import type { EditorApp } from '@ekza-studio/editor-core';

export type ConfirmAnswer = 'allow' | 'deny' | 'timeout' | 'resolved';

export interface LiveHostDeps {
  readonly app: EditorApp;
  grants(): Grants;
  paused(): boolean;
  /** Shows the card and resolves with the user's answer (`deny` when the signal aborts). */
  ask(prompt: ConfirmPrompt, signal: AbortSignal, resolvedWhen?: () => boolean): Promise<ConfirmAnswer>;
  /** The files of the edit/files call running now (queued calls run one at a time, §5.8 3). */
  currentFiles(): {
    readonly attached: ReadonlyMap<string, Uint8Array>;
    readonly writes: { name: string; bytes: Uint8Array }[];
  } | null;
  /** Hands bytes to the browser as a download. */
  download(fileName: string, bytes: Uint8Array, mime: string): void;
  readonly capture: boolean;
}

const GESTURE_POLL_MS = 50;

function idle(app: EditorApp): boolean {
  return app.store.preview?.active !== true && app.meshes.session === null;
}

const baseName = (path: string): string => path.split(/[/\\]/).pop() ?? path;

export function createLiveHost(deps: LiveHostDeps): AgentHost {
  const capabilities = new Set<HostCapability>([
    'user',
    'confirm',
    'presence',
    'view',
    'files.download',
    'files.workspace',
  ]);
  if (deps.capture) capabilities.add('capture.shaded');
  const files: AgentFileHost = {
    read(path) {
      const bytes = deps.currentFiles()?.attached.get(path);
      if (bytes === undefined) {
        return Promise.reject(new Error(`${baseName(path)} was not attached by the server`));
      }
      return Promise.resolve({ path, bytes });
    },
    write(path, bytes) {
      const current = deps.currentFiles();
      if (current === null) return Promise.reject(new Error('no files call is running'));
      current.writes.push({ name: baseName(path), bytes });
      return Promise.resolve({ path });
    },
    async download(fileName, bytes, mime, signal) {
      const answer = await deps.ask(
        {
          title: `AI wants to download "${fileName}"`,
          detail: 'The file goes to your downloads folder.',
          danger: false,
        },
        signal,
      );
      if (answer !== 'allow') return { accepted: false };
      deps.download(fileName, bytes, mime);
      return { accepted: true };
    },
  };
  return {
    mode: 'live',
    capabilities,
    grants: () => deps.grants(),
    paused: () => deps.paused(),
    waitForGesture(signal, maxMs) {
      if (idle(deps.app)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (idle(deps.app)) finish(true);
          else if (signal.aborted || Date.now() - started >= maxMs) finish(false);
        }, GESTURE_POLL_MS);
        const finish = (value: boolean): void => {
          clearInterval(timer);
          resolve(value);
        };
      });
    },
    confirm: (prompt, signal, opts) => deps.ask(prompt, signal, opts?.resolvedWhen),
    files,
  };
}
