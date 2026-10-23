// The reference script of the `rig_and_animate` prompt (MCP-SPEC §5.20.4, §0.4.4; B4, shared at INT): the agent-tools
// setup tests run it over a tool runtime, the AE-R1 eval over the MCP client ↔ server pair (agent-evals).
import type { AgentToolResult } from '../types';

export type RigAndAnimateCall = (name: string, args: unknown) => Promise<AgentToolResult<unknown>>;

function ok<T = Record<string, unknown>>(result: AgentToolResult<unknown>): T {
  if (!result.ok) throw new Error(`tool failed: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

export interface RigAndAnimateOptions {
  readonly sample: 'cube_lad' | 'polybot_tpose' | 'polybot_apose';
  readonly clip?: string;
  readonly author?: string;
  readonly license?: 'cc0' | 'cc-by-4.0' | 'personal';
}

/**
 * The reference script of the `rig_and_animate` prompt (MCP-SPEC §5.20.4, §0.4.4; the AE-R1 task): import a sample,
 * then exactly the plan's calls — model_inspect, history_checkpoint, the listed model_fix calls, rig_create,
 * library_list, library_use, project_export {kind: 'vrm'} — each result checked as it comes. Returns every result by
 * tool (the last of each).
 */
export async function rigAndAnimateScript(
  call: RigAndAnimateCall,
  opts: RigAndAnimateOptions,
): Promise<Readonly<Record<string, AgentToolResult<unknown>>>> {
  const out: Record<string, AgentToolResult<unknown>> = {};
  const step = async (name: string, args: unknown): Promise<Record<string, unknown>> => {
    const result = await call(name, args);
    out[name] = result;
    return ok(result);
  };
  await step('project_import', { sample: opts.sample });
  const report = (await step('model_inspect', {})) as { fixes: { fix: string }[] };
  await step('history_checkpoint', { label: `Rig and add ${opts.clip ?? 'walk'}` });
  for (const { fix } of report.fixes) {
    await step('model_fix', fix === 'scale' ? { fix, heightM: 1.7 } : { fix });
  }
  const rig = (await step('rig_create', {})) as { character: string };
  const library = (await step('library_list', {})) as { clips: { id: string }[] };
  const clip = opts.clip ?? 'walk';
  if (!library.clips.some((entry) => entry.id === clip)) throw new Error(`no library clip ${clip}`);
  await step('library_use', { character: rig.character, clip });
  await step('project_export', {
    character: rig.character,
    kind: 'vrm',
    meta: { authors: [opts.author ?? 'Ekza Studio tests'], license: opts.license ?? 'cc0' },
  });
  return out;
}
