// A graded task (MCP-SPEC §9.3.1, §0.4.1 item 8): a starting document built by the simulated user, a reference script
// (the scripted agent's solution), known-bad adversarial scripts, and a grader over the saved result.
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { Agent, EvalSession, TranscriptEntry } from '../drivers/scripted';
import { evalSession } from '../drivers/scripted';
import {
  type FixtureApp,
  FIXTURES_DIR,
  type OpenedProject,
  openProject,
  projectBytes,
  type SampleName,
  sampleApp,
} from '../fixtures/project';
import type { GradeResult } from '../graders';

export interface GradeInput {
  /** The starting document, opened fresh. */
  readonly before: OpenedProject | null;
  /** The agent's final document (the harness saved it), opened fresh. */
  readonly after: OpenedProject;
  readonly transcript: readonly TranscriptEntry[];
  readonly workspace: string;
}

export interface Task {
  readonly id: string;
  readonly prompt: string;
  /** The sample the document starts from; null: an empty project (the script imports what it needs). */
  readonly sample: SampleName | null;
  /** The simulated user's edits before the agent starts. */
  readonly setup?: (fx: FixtureApp) => Promise<void> | void;
  /** Tools the task needs listed (else it is skipped: another package has not landed them). */
  readonly needs?: readonly string[];
  readonly reference: (agent: Agent) => Promise<void>;
  readonly adversarial: readonly { readonly name: string; readonly script: (agent: Agent) => Promise<void> }[];
  readonly grade: (input: GradeInput) => GradeResult | Promise<GradeResult>;
}

export interface TaskRun {
  readonly grade: GradeResult;
  readonly transcript: readonly TranscriptEntry[];
  readonly calls: number;
}

/** Runs one script on a task: build the document, open it, play the script, save, grade. */
export async function runTask(task: Task, script: (agent: Agent) => Promise<void>): Promise<TaskRun> {
  let session: EvalSession | null = null;
  try {
    let before: OpenedProject | null = null;
    session = await evalSession({ samplesDir: FIXTURES_DIR });
    if (task.sample !== null) {
      const fx = await sampleApp(task.sample, 7);
      await task.setup?.(fx);
      const bytes = await projectBytes(fx.app);
      await fsp.writeFile(join(session.workspace, 'task.ekzanim'), bytes);
      before = await openProject(bytes);
      const opened = await session.harness('project_open', { path: 'task.ekzanim' });
      if (!opened.ok) throw new Error(`the task project did not open: ${JSON.stringify(opened.error)}`);
    } else {
      const opened = await session.harness('project_open', {});
      if (!opened.ok) throw new Error(`the empty project did not open: ${JSON.stringify(opened.error)}`);
    }
    await script(session.agent);
    const saved = await session.harness('project_save', { path: 'result.ekzanim', overwrite: true });
    if (!saved.ok) throw new Error(`the harness could not save the result: ${JSON.stringify(saved.error)}`);
    const after = await openProject(new Uint8Array(await fsp.readFile(join(session.workspace, 'result.ekzanim'))));
    const grade = await task.grade({ before, after, transcript: session.transcript, workspace: session.workspace });
    return { grade, transcript: [...session.transcript], calls: session.transcript.length };
  } finally {
    await session?.close();
  }
}
