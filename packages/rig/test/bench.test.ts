import { describe, expect, it } from 'vitest';
import { autoRig, compileRig } from '../src';
import { IDS, richHumanoid } from './helpers';

// ARCHITECTURE §14: pose evaluation of one humanoid ≤ 0.5 ms. Reported as an annotation, never a CI gate.
describe('bench: RigProgram.evaluate', () => {
  it('reports the mean evaluation time of a humanoid rig', async ({ annotate }) => {
    const skeleton = richHumanoid();
    const program = compileRig(autoRig(skeleton, IDS), skeleton);
    const ch = program.allocChannels();
    for (let i = 0; i < ch.values.length; i++) if (i % 9 >= 3 && i % 9 < 6) ch.values[i] = Math.sin(i) * 0.4;
    const pose = program.allocPose();
    for (let i = 0; i < 200; i++) program.evaluate(ch, pose);
    const runs = 2000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) program.evaluate(ch, pose);
    const ms = (performance.now() - start) / runs;
    await annotate(
      `evaluate: ${ms.toFixed(4)} ms/pose (${program.controls.length} controls, ${program.nodeCount} nodes; budget 0.5 ms)`,
    );
    expect(pose.version).toBe(runs + 200);
  });
});
