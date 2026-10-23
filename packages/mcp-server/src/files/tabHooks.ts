// The live tab's workspace transfers (MCP-SPEC §5.10 "Tab results" (4)–(5), §5.18): the bridge (B2) asks these hooks
// which file bytes to pre-attach to a call and performs the tab's workspace writes through them. Only paths taken
// from the call's own `path` argument are read; writes go only to targets derived from the call's own arguments —
// `project_save {path}` (default `<name>.ekzanim`) and `exports/<name>` for `project_export` — through the sandbox,
// with the agent's own `overwrite`. A tab can name neither a folder nor an overwrite.
import {
  type AgentToolDef,
  type AgentToolResult,
  deriveFileName,
  EXPORTS_DIR,
  failureFrom,
  fileExtension,
  finishResult,
} from '@ekza-studio/agent-tools';
import type { TabFileHooks } from '../bridge/link';
import type { WorkspaceSandbox } from './sandbox';

/** Tools whose `path` argument the server reads for the tab (project_open/project_import of a workspace file). */
const READS = new Set(['project_open', 'project_import']);
/** The extension a write of an export kind gets (derived names, §5.17.3). */
const EXPORT_EXTENSION: Readonly<Record<string, string>> = {
  vrma: '.vrma',
  animation_glb: '.glb',
  bake_into_model: '.vrm',
  vrm: '.vrm',
  glb: '.glb',
  omoba_kit: '.zip',
};

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function failed(error: unknown): AgentToolResult<unknown> {
  return finishResult({ ok: false, error: failureFrom(error).toError() }, null);
}

export function createTabFileHooks(sandbox: WorkspaceSandbox): TabFileHooks {
  return {
    async attach(tool: AgentToolDef, args: unknown) {
      const path = record(args)['path'];
      if (!READS.has(tool.name) || typeof path !== 'string') return [];
      const read = await sandbox.read(path);
      return [{ path, bytes: read.bytes }];
    },
    async write(tool, args, writes) {
      const call = record(args);
      if (call['delivery'] !== 'workspace' || writes.length === 0) return null;
      const overwrite = call['overwrite'] === true;
      try {
        if (tool.name === 'project_save') {
          const first = writes[0];
          if (first === undefined) return null;
          const path =
            typeof call['path'] === 'string'
              ? call['path']
              : deriveFileName(
                  first.name,
                  fileExtension(first.name) === '.ekzanim.json' ? '.ekzanim.json' : '.ekzanim',
                );
          await sandbox.write(path, first.bytes, { overwrite });
          return null;
        }
        if (tool.name === 'project_export') {
          const extension = EXPORT_EXTENSION[String(call['kind'])] ?? '.glb';
          for (const file of writes) {
            await sandbox.write(`${EXPORTS_DIR}/${deriveFileName(file.name, extension)}`, file.bytes, { overwrite });
          }
          return null;
        }
      } catch (error) {
        return failed(error);
      }
      return null;
    },
  };
}
