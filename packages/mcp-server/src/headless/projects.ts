// Headless projects (MCP-SPEC §4.6, §5.17.1): `prj_…` handles, at most `maxProjects` open (the next → `limit`), a
// project with no call for `projectIdleMs` is closed (its handle then answers `expired_handle`, "unsaved changes were
// discarded"), one `EditorApp` + `AgentToolRuntime` + queue per project. `--seed` makes document ids seeded and limits
// the server to one project.
import {
  AgentToolFailure,
  type AgentToolRuntimeHandle,
  createAgentToolRuntime,
  randomBase62,
} from '@ekza-studio/agent-tools';
import { seededIdSource } from '@ekza-studio/doc';
import { createHeadlessEditorApp, type EditorApp, type RunActor } from '@ekza-studio/editor-core';
import type { ValidationReport } from '@ekza-studio/io';
import type { WorkspaceSandbox } from '../files/sandbox';
import { type ConfirmPolicy, createHeadlessHost } from './host';

export interface HeadlessProject {
  readonly handle: string;
  readonly name: string;
  readonly app: EditorApp;
  readonly runtime: AgentToolRuntimeHandle;
  readonly openedAt: number;
  /** When the last call to this project ended (or it opened). */
  lastCallAt: number;
  /** Calls running now: a project is never idle-closed while one runs. */
  running: number;
}

export interface ProjectRow {
  readonly project: string;
  readonly name: string;
  readonly dirty: boolean;
  readonly readOnly: boolean;
  readonly characters: number;
  readonly idleMs: number;
}

export interface HeadlessProjectManagerOptions {
  readonly maxProjects: number;
  readonly idleMs: number;
  readonly seed: number | null;
  readonly sandbox: WorkspaceSandbox;
  readonly actor: () => RunActor;
  readonly readSample: (sample: { readonly file: string }) => Promise<Uint8Array>;
  readonly validate: ((bytes: Uint8Array) => Promise<ValidationReport>) | null;
  /** The simulated user (evals, tests): confirm cards answered by its policy, the `user` capability. */
  readonly simulatedUser?: ConfirmPolicy | null;
  readonly now?: () => number;
  /** Toasts of a project (hosts turn them into warnings; the runtime captures them per run too). */
  readonly onNotify?: (project: string, text: string) => void;
}

export interface HeadlessProjectManager {
  /** A new empty project (the caller loads into it); `limit` beyond `maxProjects`. */
  create(name: string): HeadlessProject;
  /** The open project, else `expired_handle` (closed, idle-closed or never issued). */
  get(handle: string): HeadlessProject;
  /** Closes; a dirty project needs `discardChanges` (else `confirm_required`). */
  close(handle: string, opts: { readonly discardChanges: boolean }): { readonly discarded: boolean };
  /** Closes without asking (a failed open, the process exit). */
  drop(handle: string, reason: string): void;
  list(): readonly ProjectRow[];
  readonly size: number;
  handles(): readonly string[];
  /** Closes idle projects (also run by a timer). */
  sweep(): void;
  closeAll(): void;
}

/** Closed handles remembered for their `expired_handle` message. */
const EXPIRED_MAX = 256;

export function isDirty(app: EditorApp): boolean {
  return app.session.getState().dirty === true;
}

export function createHeadlessProjectManager(opts: HeadlessProjectManagerOptions): HeadlessProjectManager {
  const now = opts.now ?? Date.now;
  const max = opts.seed === null ? opts.maxProjects : 1;
  const projects = new Map<string, HeadlessProject>();
  const expired = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const forget = (handle: string, why: string): void => {
    expired.set(handle, why);
    while (expired.size > EXPIRED_MAX) expired.delete(expired.keys().next().value as string);
  };
  const dispose = (project: HeadlessProject): void => {
    projects.delete(project.handle);
    project.runtime.dispose();
    if (projects.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const sweep = (): void => {
    const at = now();
    for (const project of projects.values()) {
      if (project.running > 0 || at - project.lastCallAt < opts.idleMs) continue;
      const dirty = isDirty(project.app);
      dispose(project);
      forget(
        project.handle,
        dirty
          ? 'The project was closed after 30 minutes without calls; unsaved changes were discarded.'
          : 'The project was closed after 30 minutes without calls.',
      );
    }
  };
  const startTimer = (): void => {
    if (timer !== null) return;
    timer = setInterval(sweep, Math.max(1_000, Math.min(60_000, Math.floor(opts.idleMs / 4))));
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  return {
    get size() {
      return projects.size;
    },
    handles: () => [...projects.keys()],
    create(name) {
      sweep();
      if (projects.size >= max) {
        throw new AgentToolFailure(
          'limit',
          `${projects.size} headless project${projects.size === 1 ? ' is' : 's are'} open (the most this server keeps).`,
          'close one with project_close (save it first with project_save), then open again',
          { detail: { max } },
        );
      }
      const handle = `prj_${randomBase62()}`;
      const app = createHeadlessEditorApp({
        readSample: opts.readSample,
        validate: opts.validate,
        ...(opts.seed === null ? {} : { idSource: seededIdSource(opts.seed) }),
        onNotify: (toast) => opts.onNotify?.(handle, toast.text),
      });
      app.session.setState({ projectName: name } as never);
      const host = createHeadlessHost({
        app,
        sandbox: opts.sandbox,
        ...(opts.simulatedUser === undefined ? {} : { simulatedUser: opts.simulatedUser }),
      });
      const runtime = createAgentToolRuntime({ app, host, actor: opts.actor() });
      const at = now();
      const project: HeadlessProject = { handle, name, app, runtime, openedAt: at, lastCallAt: at, running: 0 };
      projects.set(handle, project);
      startTimer();
      return project;
    },
    get(handle) {
      sweep();
      const project = projects.get(handle);
      if (project !== undefined) return project;
      const why = expired.get(handle);
      throw new AgentToolFailure(
        'expired_handle',
        why ?? 'This project handle is not open (closed, or from another server run).',
        'call projects_list for the open projects, or project_open again',
      );
    },
    close(handle, closeOpts) {
      const project = this.get(handle);
      const dirty = isDirty(project.app);
      if (dirty && !closeOpts.discardChanges) {
        throw new AgentToolFailure(
          'confirm_required',
          `${JSON.stringify(project.name)} has unsaved changes.`,
          'save it with project_save first, or pass discardChanges: true to close without saving',
          { detail: { title: 'Close without saving?', lost: 'Unsaved changes in this headless project.' } },
        );
      }
      dispose(project);
      forget(handle, dirty ? 'The project was closed; its unsaved changes were discarded.' : 'The project was closed.');
      return { discarded: dirty };
    },
    drop(handle, reason) {
      const project = projects.get(handle);
      if (project === undefined) return;
      dispose(project);
      forget(handle, reason);
    },
    list() {
      sweep();
      const at = now();
      return [...projects.values()].map((project) => ({
        project: project.handle,
        name: project.name,
        dirty: isDirty(project.app),
        readOnly: project.app.store.readOnly,
        characters: [...project.app.store.list('characters')].length,
        idleMs: project.running > 0 ? 0 : Math.max(0, at - project.lastCallAt),
      }));
    },
    sweep,
    closeAll() {
      for (const project of projects.values()) {
        dispose(project);
        forget(project.handle, 'The server stopped.');
      }
    },
  };
}
