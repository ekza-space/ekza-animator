// Fixtures of the character setup tool tests (MCP-SPEC §0.4.4; B4): a headless editor whose `readSample` serves the
// Auto-Rig samples and the VRM samples from `fixtures/`, the starter animation library served from
// `apps/web/public/library/` (the clip library fetches it), a headless host with a memory workspace, a runtime over the
// catalogue plus the setup kinds of project_import/project_export, and the reference script of the `rig_and_animate`
// prompt (AE-R1 runs the same calls through the MCP pair, B1).
import { readFileSync } from 'node:fs';
import { seededIdSource } from '@ekza-studio/doc';
import { createHeadlessEditorApp, type EditorApp, type SampleDef } from '@ekza-studio/editor-core';
import {
  type AgentFileHost,
  type AgentHost,
  type AgentToolResult,
  type AgentToolRuntimeHandle,
  allTools,
  createAgentToolRuntime,
} from '../src';
import { AGENT, testHost } from './support';

const ROOT = new URL('../../../', import.meta.url);
export const repoFile = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, ROOT)));

/** `readSample` of the headless server: the bundled fixtures by file name (Auto-Rig samples and VRM samples). */
export function readSetupSample(sample: SampleDef): Promise<Uint8Array> {
  return Promise.resolve(repoFile(`fixtures/models/${sample.file}`));
}

type FetchLike = typeof globalThis.fetch;
let realFetch: FetchLike | null = null;

/** Serves `/library/…` (the clip library's default base) from `apps/web/public/library/`; returns the restore. */
export function serveLibrary(): () => void {
  realFetch ??= globalThis.fetch;
  const served = ((url: string | URL) => {
    const path = String(url);
    if (!path.startsWith('/library/')) return Promise.reject(new Error(`unexpected fetch ${path}`));
    const bytes = repoFile(`apps/web/public${path}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    } as unknown as Response);
  }) as FetchLike;
  globalThis.fetch = served;
  return () => {
    if (realFetch !== null) globalThis.fetch = realFetch;
  };
}

export function setupApp(seed = 5): EditorApp {
  return createHeadlessEditorApp({ readSample: readSetupSample, idSource: seededIdSource(seed) });
}

export interface Workspace {
  readonly files: Map<string, Uint8Array>;
  readonly host: AgentFileHost;
}

/** A memory workspace: reads its own files, then the repository's `fixtures/models/`; writes into the map. */
export function memoryWorkspace(): Workspace {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    host: {
      read(path) {
        const own = files.get(path);
        if (own !== undefined) return Promise.resolve({ path, bytes: own });
        return Promise.resolve({ path, bytes: repoFile(`fixtures/models/${path}`) });
      },
      write(path, bytes, opts) {
        if (files.has(path) && !opts.overwrite) return Promise.reject(new Error(`${path} exists`));
        files.set(path, bytes);
        return Promise.resolve({ path });
      },
    },
  };
}

export function setupHost(workspace: Workspace | null = memoryWorkspace(), base: AgentHost = testHost()): AgentHost {
  return { ...base, files: workspace?.host ?? null };
}

/** The catalogue (B1's project_import / project_export hand the setup kinds to B4's hooks since INT). */
export function setupTools() {
  return allTools();
}

export function setupRuntime(app: EditorApp, host: AgentHost = setupHost()): AgentToolRuntimeHandle {
  return createAgentToolRuntime({ app, host, actor: AGENT, tools: setupTools() });
}

export type Call = (name: string, args: unknown) => Promise<AgentToolResult<unknown>>;

export function caller(runtime: AgentToolRuntimeHandle): Call {
  return (name, args) => runtime.call(name, args, { signal: new AbortController().signal });
}

export function ok<T = Record<string, unknown>>(result: AgentToolResult<unknown>): T {
  if (!result.ok) throw new Error(`tool failed: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

// the reference script moved to src/text/rigAndAnimate.ts (INT): AE-R1 and these tests share it
export { rigAndAnimateScript, type RigAndAnimateOptions as ScriptOptions } from '../src';
