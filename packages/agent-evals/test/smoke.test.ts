// MCP-SPEC §0.4.1 item 8, §9.3.2 (B1): the MVP smoke — six tasks through an in-memory MCP client ↔ server pair with
// the scripted reference agent. Reference mode: every reference script passes its grader. Adversarial mode: every
// known-bad script fails it (grader integrity). AE-R1 needs the character setup tools (B4): it runs once they are
// listed.
import { readyTools } from '@ekza-studio/agent-tools';
import { describe, expect, it } from 'vitest';
import { runTask, SMOKE_TASKS, type Task } from '../src';

/** The tools the server lists (its tools/list is the ready catalogue, §5.20.1). */
const listed: readonly string[] = readyTools().map((tool) => tool.name);
const available = (task: Task): boolean => (task.needs ?? []).every((name) => listed.includes(name));

describe('the MVP smoke (6 tasks)', () => {
  it('has the six tasks of §0.4.1', () => {
    expect(SMOKE_TASKS.map((task) => task.id)).toEqual(['AE-01', 'AE-06', 'AE-13', 'AE-19', 'AE-24', 'AE-R1']);
  });

  describe.each(SMOKE_TASKS.map((task) => [task.id, task] as const))('%s', (_id, task) => {
    it.skipIf(!available(task))('reference: the scripted solution passes its grader', async () => {
      const run = await runTask(task, task.reference);
      expect(run.grade.notes.filter((note) => note.startsWith('FAIL'))).toEqual([]);
      expect(run.grade.pass).toBe(true);
      // every edit call of the script is one AI step
      const labels = run.transcript.flatMap((entry) =>
        entry.result.undo === undefined ? [] : [entry.result.undo.label],
      );
      expect(labels.filter((label) => !label.startsWith('AI: '))).toEqual([]);
    });

    it.skipIf(!available(task)).each(task.adversarial.map((bad) => [bad.name, bad] as const))(
      'adversarial: %s fails',
      async (_name, bad) => {
        const run = await runTask(task, bad.script);
        expect(run.grade.pass).toBe(false);
      },
    );
  });
});
