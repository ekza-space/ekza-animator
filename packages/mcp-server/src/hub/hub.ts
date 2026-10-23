// The hub (MCP-SPEC §4.6, §5.1, §5.8, §5.17): the process-wide state — one per process, outside the per-request
// server factory — the bridge (B2 attaches it as a `TabLink`, ../bridge/link.ts), the headless projects, the actor, the
// last client info, the connection tools and the routing. Hub-level tools: `editor_connect` (the bridge),
// `projects_list`, `project_close` and `project_open` (a new headless project, or `project: tab_…`); every other tool
// is routed by its `project` argument to the paired tab or a headless project's runtime.
import { promises as fsp } from 'node:fs';
import {
  AGENT_TOOLSET_VERSION,
  type AgentToolDef,
  type AgentToolResult,
  allTools,
  type ClientInfo,
  failureFrom,
  finishResult,
  invalidArgs,
  type ManifestTool,
  manifestToolOf,
  outputJsonSchemaOf,
  randomBase62,
  readyTools,
  AgentToolFailure,
  userSelectionOf,
  userTimeOf,
} from '@ekza-studio/agent-tools';
import type { RunActor } from '@ekza-studio/editor-core';
import { setGltfValidator, validateGltf } from '@ekza-studio/io';
import type { McpServerConfig } from '../config';
import { installLibraryFetch } from '../files/library';
import { createSampleReader } from '../files/samples';
import { createWorkspaceSandbox, type WorkspaceSandbox } from '../files/sandbox';
import { type ConfirmPolicy, HEADLESS_GRANTS } from '../headless/host';
import { createHeadlessProjectManager, type HeadlessProject, type HeadlessProjectManager } from '../headless/projects';
import type { Logger } from '../log';
import type { TabCallOptions, TabLink } from '../bridge/link';
import { routeProject } from './router';

export interface CallOptions {
  readonly signal: AbortSignal;
  readonly progress?: (done: number, total: number | null, message?: string) => void;
}

export interface AgentHub {
  readonly config: McpServerConfig;
  readonly log: Logger;
  /** The workspace sandbox (B2 pre-attaches tab reads and performs tab writes through it, §5.10). */
  readonly sandbox: WorkspaceSandbox;
  readonly projects: HeadlessProjectManager;
  /** The agent this server acts as (`RunActor`), named after the MCP client once it introduced itself. */
  actor(): RunActor;
  /** The ready tools in catalogue order (the same static list on every connection, §5.20.1). */
  listTools(): readonly ManifestTool[];
  /** True when `name` is a ready tool (unknown names are protocol errors, §5.20.2). */
  hasTool(name: string): boolean;
  /** Routes a call to the paired tab or a headless project (§5.8). Never rejects. */
  callTool(name: string, args: unknown, opts: CallOptions): Promise<AgentToolResult<unknown>>;
  /** Resource reads of a project (§5.20.3): JSON text, or `expired_handle`/`not_connected` failures (thrown). */
  readProjectResource(
    project: string,
    kind: 'summary' | 'selection' | 'time' | 'rig',
    character?: string,
  ): Promise<unknown>;
  /** The MCP client's name and version as reported (sanitised), for the bridge's `hello.ok`. */
  clientInfo(): ClientInfo | null;
  setClientInfo(info: ClientInfo | null): void;
  /** B2 (MCP-SPEC §0.4.5): the live bridge, attached when it listens; null when off. */
  attachTabLink(link: TabLink | null): void;
  tabLink(): TabLink | null;
  close(): Promise<void>;
}

export interface AgentHubOptions {
  /** A sandbox built elsewhere (tests); default from the configuration. */
  readonly sandbox?: WorkspaceSandbox;
  /** The eval harness's simulated user (never from the CLI). */
  readonly simulatedUser?: ConfirmPolicy | null;
  readonly now?: () => number;
}

const SANITISED_CLIENT = /[^A-Za-z0-9 ._()-]/g;

function clientActorName(info: ClientInfo | null): string {
  const name = info?.name.replace(SANITISED_CLIENT, '').trim().slice(0, 40) ?? '';
  return name === '' ? 'AI agent' : name;
}

/** Loads gltf-validator for `--validate` (external to the bundle; optional). */
async function loadValidator(log: Logger): Promise<((bytes: Uint8Array) => ReturnType<typeof validateGltf>) | null> {
  try {
    // a non-literal specifier: the optional peer stays outside the bundle and needs no type declarations
    const specifier = 'gltf-validator';
    const loaded = (await import(specifier)) as Parameters<typeof setGltfValidator>[0];
    setGltfValidator(loaded);
    return (bytes) => validateGltf(bytes);
  } catch {
    log.warn('--validate: gltf-validator is not installed; exports are checked by the read-back only');
    return null;
  }
}

export async function createAgentHub(
  config: McpServerConfig,
  log: Logger,
  opts: AgentHubOptions = {},
): Promise<AgentHub> {
  const tools = readyTools(allTools());
  const listed = tools.map(manifestToolOf);
  const byName = new Map<string, AgentToolDef>(tools.map((tool) => [tool.name, tool]));
  const now = opts.now ?? Date.now;
  let client: ClientInfo | null = null;
  let bridge: TabLink | null = null;
  const actorId = `agt_${randomBase62(12)}`;
  const actor = (): RunActor => ({ kind: 'agent', id: actorId, name: clientActorName(client) });
  const sandbox =
    opts.sandbox ??
    (await createWorkspaceSandbox({
      root: config.workspace,
      readOnlyRoots: config.readOnlyRoots,
      source: config.workspaceSource,
    }));
  if (!sandbox.enabled) {
    log.warn(
      `workspace ${sandbox.root} is the home folder, / or a system folder: file tools are off (start with --workspace <folder>)`,
    );
  }
  const validate = config.validate ? await loadValidator(log) : null;
  // the clip library of headless projects (library_list, library_use): served from disk, no network
  const uninstallFetch = installLibraryFetch();
  const projects = createHeadlessProjectManager({
    maxProjects: config.maxProjects,
    idleMs: config.projectIdleMs,
    seed: config.seed,
    sandbox,
    actor,
    readSample: createSampleReader({ samplesDir: config.samplesDir }),
    validate,
    ...(opts.simulatedUser === undefined ? {} : { simulatedUser: opts.simulatedUser }),
    now,
  });

  const finish = (tool: AgentToolDef, result: AgentToolResult<unknown>): AgentToolResult<unknown> =>
    finishResult(result, { maxTokens: tool.budget.maxTokens, schema: outputJsonSchemaOf(tool.output) });
  const failure = (error: unknown): AgentToolResult<unknown> => {
    try {
      return finishResult({ ok: false, error: failureFrom(error).toError() }, null);
    } catch {
      return {
        ok: false,
        error: { code: 'internal', message: 'The tool failed unexpectedly.', hint: 'report this', retryable: false },
      };
    }
  };

  /** The bridge while a tab is paired (the hub routes `tab_…` handles to it). */
  const tab = (): TabLink | null => ((bridge?.tab() ?? null) === null ? null : bridge);

  const runProject = async (
    project: HeadlessProject,
    name: string,
    args: unknown,
    callOpts: CallOptions,
  ): Promise<AgentToolResult<unknown>> => {
    project.running++;
    try {
      return await project.runtime.call(name, args, callOpts);
    } finally {
      project.running--;
      project.lastCallAt = now();
    }
  };

  const listProjects = (): AgentToolResult<unknown> => {
    const status =
      bridge === null ? { status: 'off' as const, port: null } : { status: bridge.status(), port: bridge.port };
    const rows: Record<string, unknown>[] = [];
    const paired = bridge?.tab() ?? null;
    if (paired !== null) {
      rows.push({
        project: paired.handle,
        kind: 'tab',
        name: paired.project,
        dirty: false,
        readOnly: false,
        characters: 0,
        grants: paired.grants,
        toolset: paired.toolset,
        idleMs: null,
        origin: paired.origin,
      });
    }
    for (const row of projects.list()) {
      rows.push({
        ...row,
        kind: 'headless',
        grants: HEADLESS_GRANTS,
        toolset: AGENT_TOOLSET_VERSION,
        origin: null,
      });
    }
    return {
      ok: true,
      data: { bridge: status, projects: rows },
      ...(rows.length === 0
        ? { next: 'Nothing is open: project_open {sample: "polybot"} or {path}, or editor_connect with a code.' }
        : {}),
    };
  };

  const projectNameOf = (args: Readonly<Record<string, unknown>>): string => {
    const name = args['name'];
    if (typeof name === 'string' && name.trim() !== '') return name.trim().slice(0, 64);
    const path = args['path'];
    if (typeof path === 'string') {
      const base = path.split(/[\\/]/).pop() ?? path;
      const stem = base.replace(/\.ekzanim\.json$/i, '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
      if (stem.trim() !== '') return stem.slice(0, 64);
    }
    const sample = args['sample'];
    return typeof sample === 'string' ? sample : 'Untitled';
  };

  const openHeadless = async (
    tool: AgentToolDef,
    args: Readonly<Record<string, unknown>>,
    callOpts: CallOptions,
  ): Promise<AgentToolResult<unknown>> => {
    const name = projectNameOf(args);
    const project = projects.create(name);
    const { project: _drop, ...rest } = args;
    void _drop;
    let result: AgentToolResult<unknown>;
    try {
      result = await runProject(project, 'project_open', rest, callOpts);
    } catch (error) {
      projects.drop(project.handle, 'The project failed to open.');
      throw error;
    }
    if (!result.ok) {
      projects.drop(project.handle, 'The project failed to open.');
      return result;
    }
    // a model or sample opens as a project named after it; an .ekzanim keeps the name saved in it unless given
    if (typeof args['name'] === 'string' || project.app.session.getState().projectName === 'Untitled') {
      project.app.session.setState({ projectName: name } as never);
    }
    const data = result.data as Record<string, unknown>;
    const summary = data['summary'] as { project?: Record<string, unknown> } | undefined;
    const patchedSummary =
      summary?.project === undefined
        ? summary
        : { ...summary, project: { ...summary.project, name: project.app.session.getState().projectName } };
    return finish(tool, { ...result, data: { ...data, project: project.handle, summary: patchedSummary } });
  };

  const closeProject = async (
    tool: AgentToolDef,
    args: Readonly<Record<string, unknown>>,
  ): Promise<AgentToolResult<unknown>> => {
    const handle = args['project'] as string;
    const discard = args['discardChanges'] === true;
    if (handle.startsWith('tab_')) {
      if (bridge === null || !bridge.unpair(handle)) {
        throw new AgentToolFailure(
          'expired_handle',
          'This editor pairing has ended.',
          'projects_list shows what is open; ask the user for a new code to pair again',
        );
      }
      return finish(tool, { ok: true, data: { closed: handle, discarded: false } });
    }
    const { discarded } = projects.close(handle, { discardChanges: discard });
    return finish(tool, { ok: true, data: { closed: handle, discarded } });
  };

  const audit = (name: string, project: string | null, result: AgentToolResult<unknown>, startedAt: number): void => {
    if (config.auditLog === null) return;
    const line = JSON.stringify({
      at: new Date(startedAt).toISOString(),
      tool: name,
      project,
      ok: result.ok,
      ...(result.ok ? {} : { code: result.error.code }),
      ms: Date.now() - startedAt,
    });
    fsp.appendFile(config.auditLog, `${line}\n`, { mode: 0o600 }).catch(() => {});
  };

  const dispatch = async (
    tool: AgentToolDef,
    raw: Readonly<Record<string, unknown>>,
    callOpts: CallOptions,
  ): Promise<AgentToolResult<unknown>> => {
    // §5.8 1: the server validates first (cheap rejection), then routes.
    const parsed = tool.input.safeParse(raw);
    if (!parsed.success) throw invalidArgs(tool, parsed.error);
    const args = parsed.data as Readonly<Record<string, unknown>>;
    switch (tool.name) {
      case 'editor_connect': {
        if (bridge === null) {
          throw new AgentToolFailure(
            'not_connected',
            'The editor bridge is off on this server.',
            'the server runs headless (--no-bridge, or all bridge ports were in use): use project_open',
          );
        }
        return bridge.claim(args['code'] as string, callOpts);
      }
      case 'projects_list':
        return finish(tool, listProjects());
      case 'project_close':
        return closeProject(tool, args);
      case 'project_open': {
        const handle = args['project'];
        if (typeof handle === 'string') {
          const target = routeProject(handle, { tab: tab(), projects });
          if (target.kind === 'headless') {
            throw new AgentToolFailure(
              'invalid_args',
              'project_open never replaces a headless project.',
              'omit project for a new headless project, or pass the tab_… handle of the paired editor',
              { detail: { path: 'project' } },
            );
          }
          return target.tab.call(tool, raw, callOpts);
        }
        return openHeadless(tool, args, callOpts);
      }
      default: {
        const handle = typeof args['project'] === 'string' ? args['project'] : undefined;
        const target = routeProject(handle, { tab: tab(), projects });
        if (target.kind === 'tab') return target.tab.call(tool, raw, callOpts);
        return runProject(target.project, tool.name, raw, callOpts);
      }
    }
  };

  return {
    config,
    log,
    sandbox,
    projects,
    actor,
    listTools: () => listed,
    hasTool: (name) => byName.has(name),
    async callTool(name, rawArgs, callOpts) {
      const startedAt = Date.now();
      const tool = byName.get(name);
      const raw =
        typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
          ? (rawArgs as Readonly<Record<string, unknown>>)
          : {};
      let result: AgentToolResult<unknown>;
      try {
        if (tool === undefined) {
          throw new AgentToolFailure('unsupported', 'There is no such tool.', 'tools/list lists the tools', {
            retryable: false,
          });
        }
        if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
          const parsed = tool.input.safeParse(rawArgs);
          if (!parsed.success) throw invalidArgs(tool, parsed.error);
        }
        result = await dispatch(tool, raw, callOpts);
      } catch (error) {
        result = failure(error);
      }
      audit(name, typeof raw['project'] === 'string' ? raw['project'] : null, result, startedAt);
      return result;
    },
    async readProjectResource(handle, kind, character) {
      const target = routeProject(handle, { tab: tab(), projects });
      const callOpts: TabCallOptions = { signal: new AbortController().signal };
      const call = (name: string, args: Readonly<Record<string, unknown>>): Promise<AgentToolResult<unknown>> => {
        if (target.kind === 'headless') return runProject(target.project, name, args, callOpts);
        const def = byName.get(name);
        if (def === undefined) throw new AgentToolFailure('unsupported', `${name} is not available.`, 'use tools');
        return target.tab.call(def, { ...args, project: handle }, callOpts);
      };
      const dataOf = (result: AgentToolResult<unknown>): unknown => {
        if (!result.ok) throw new AgentToolFailure(result.error.code, result.error.message, result.error.hint);
        return result.data;
      };
      if (kind === 'summary') return dataOf(await call('scene_summary', {}));
      if (kind === 'rig') {
        return dataOf(
          await call('rig_describe', { detail: 'detailed', ...(character === undefined ? {} : { character }) }),
        );
      }
      if (target.kind === 'headless') {
        const app = target.project.app;
        const userSession = opts.simulatedUser !== undefined && opts.simulatedUser !== null;
        if (kind === 'selection') {
          return userSession
            ? { ...userTimeOf(app), ...userSelectionOf(app) }
            : {
                character: null,
                clip: null,
                controls: [],
                keys: [],
                keyCount: 0,
                truncated: false,
                channels: [],
                band: null,
              };
        }
        return userSession
          ? userTimeOf(app)
          : { character: null, clip: null, frame: null, playing: false, playbackRange: null, band: null };
      }
      // live: the user's part of scene_summary (§5.20.3, read under the Read grant)
      const summary = dataOf(await call('scene_summary', {})) as { user?: Record<string, unknown> };
      const user = summary.user ?? {};
      if (kind === 'selection') {
        return {
          character: user['activeCharacter'] ?? null,
          clip: user['activeClip'] ?? null,
          ...(user['selection'] as Record<string, unknown> | undefined),
          band: user['band'] ?? null,
        };
      }
      return {
        character: user['activeCharacter'] ?? null,
        clip: user['activeClip'] ?? null,
        frame: user['frame'] ?? null,
        playing: user['playing'] ?? false,
        band: user['band'] ?? null,
      };
    },
    clientInfo: () => client,
    setClientInfo(info) {
      client = info;
    },
    attachTabLink(next) {
      bridge = next;
    },
    tabLink: () => bridge,
    async close() {
      projects.closeAll();
      uninstallFetch();
      const current = bridge;
      bridge = null;
      if (current !== null) await current.close().catch(() => {});
    },
  };
}
