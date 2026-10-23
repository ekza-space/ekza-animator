// MCP-SPEC §5.3, §5.21 (B1): the success envelopes of the hub's tools and the file tools, through the MCP client,
// validate against the outputSchema the manifest advertises (Ajv 2020-12, as SDK clients check structuredContent).
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { buildManifest } from '@ekza-studio/agent-tools';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { type Envelope, evalSession, readFixtureFile, waveScript } from '../src';

describe('success envelopes of the hub and file tools against the manifest (§5.3)', () => {
  it('validate against their outputSchema', async () => {
    const session = await evalSession();
    const { agent } = session;
    try {
      await fsp.writeFile(join(session.workspace, 'bot.vrm'), await readFixtureFile('polybot.vrm'));
      const manifest = buildManifest();
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      const checked = new Set<string>();
      const check = async (name: string, args: Record<string, unknown>): Promise<Envelope> => {
        const envelope = await agent.call(name, args);
        expect([name, envelope.ok ? 'ok' : JSON.stringify(envelope.error)]).toEqual([name, 'ok']);
        const validate = ajv.compile(manifest.tools.find((tool) => tool.name === name)?.outputSchema ?? {});
        expect([name, validate(envelope) ? 'valid' : ajv.errorsText(validate.errors)]).toEqual([name, 'valid']);
        checked.add(name);
        return envelope;
      };
      const opened = await check('project_open', { path: 'bot.vrm', name: 'Bot' });
      const project = String(opened.data?.['project']);
      await check('projects_list', {});
      await check('project_import', { sample: 'polybot' });
      await waveScript(agent, { project });
      await check('project_export', { kind: 'vrma', clips: ['wave'] });
      await check('project_save', {});
      await check('project_close', { project });
      expect([...checked].sort()).toEqual(
        manifest.tools
          .filter((tool) => tool.group === 'files' || ['projects_list', 'project_close'].includes(tool.name))
          .map((tool) => tool.name)
          .sort(),
      );
    } finally {
      await session.close();
    }
  });
});
