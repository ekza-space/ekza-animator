// MVP-AC-1 (MCP-SPEC §0.4.6; B1): headless, through an in-memory MCP client ↔ server pair — `project_open {sample:
// 'polybot'}`; the wave script of E2E-AI-01 step 5; `keys_read`; `project_save` into the workspace; `project_open` of
// the saved file; `project_export {kind: 'vrma'}`. Pass: the AE-01 grader passes; the reopened keys equal (1e-9);
// gltf-validator reports 0 errors; the read-back `maxRotErrorRad` ≤ 1e-4.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as gltfValidator from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import { evalSession, openProject, waveScript } from '../src';
import { gradeWave } from '../src/graders';

type KeyRow = [number, number, string, string, string];
interface Curves {
  readonly curves: readonly { readonly control: string; readonly channel: string; readonly keys: readonly KeyRow[] }[];
}

describe.each(['legacy', 'modern'] as const)('MVP-AC-1 (%s era)', (era) => {
  it('waves headless, saves, reopens the same keys and exports a valid VRMA', async () => {
    const session = await evalSession({ era });
    const { agent, workspace } = session;
    try {
      const opened = await agent.ok<{ project: string }>('project_open', { sample: 'polybot' });
      await waveScript(agent, { project: opened.project });
      const targets = { controls: ['fk.upperArm.L', 'fk.lowerArm.L'] };
      const keys = await agent.ok<Curves>('keys_read', { project: opened.project, clip: 'wave', targets });
      expect(keys.curves.length).toBeGreaterThan(0);
      expect(keys.curves.flatMap((curve) => curve.keys)).toHaveLength(
        keys.curves.reduce((total, curve) => total + curve.keys.length, 0),
      );
      const saved = await agent.ok<{ path: string; delivered: string }>('project_save', {
        project: opened.project,
        path: 'wave.ekzanim',
      });
      expect(saved).toMatchObject({ path: 'wave.ekzanim', delivered: 'workspace' });

      // AE-01's grader on the saved bytes, in a separate app (never the agent's runtime)
      const graded = await openProject(new Uint8Array(await readFile(join(workspace, 'wave.ekzanim'))));
      const wave = gradeWave(graded.app, graded.character, graded.clip('wave'));
      expect(wave.notes.filter((note) => note.startsWith('FAIL'))).toEqual([]);

      const reopened = await agent.ok<{ project: string; migratedFrom: number | null }>('project_open', {
        path: 'wave.ekzanim',
      });
      expect(reopened.project).not.toBe(opened.project);
      expect(reopened.migratedFrom).toBeNull();
      const again = await agent.ok<Curves>('keys_read', { project: reopened.project, clip: 'wave', targets });
      expect(again.curves.map((curve) => [curve.control, curve.channel])).toEqual(
        keys.curves.map((curve) => [curve.control, curve.channel]),
      );
      again.curves.forEach((curve, i) => {
        const before = keys.curves[i]?.keys ?? [];
        expect(curve.keys).toHaveLength(before.length);
        curve.keys.forEach((key, j) => {
          const was = before[j] as KeyRow;
          expect(Math.abs(key[0] - was[0])).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(key[1] - was[1])).toBeLessThanOrEqual(1e-9);
          expect(key.slice(2)).toEqual(was.slice(2));
        });
      });

      const exported = await agent.ok<{
        artifacts: { path: string; readBack: { ok: boolean; maxRotErrorRad: number }; lints: { severity: string }[] }[];
      }>('project_export', { project: reopened.project, kind: 'vrma', clips: ['wave'] });
      expect(exported.artifacts).toHaveLength(1);
      const artifact = exported.artifacts[0];
      expect(artifact?.path).toBe('exports/wave.vrma');
      expect(artifact?.readBack.ok).toBe(true);
      expect(artifact?.readBack.maxRotErrorRad).toBeLessThanOrEqual(1e-4);
      expect(artifact?.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
      const bytes = new Uint8Array(await readFile(join(workspace, 'exports', 'wave.vrma')));
      const report = await gltfValidator.validateBytes(bytes, { maxIssues: 0, writeTimestamp: false });
      expect(report.issues.numErrors).toBe(0);
      // one AI step per edit call of the wave script (checkpoint excluded), labelled
      const steps = session.transcript.filter((entry) => entry.result.undo !== undefined);
      expect(steps.map((entry) => entry.result.undo?.label.startsWith('AI: '))).toEqual(steps.map(() => true));
      expect(steps.length).toBe(8);
    } finally {
      await session.close();
    }
  });
});
