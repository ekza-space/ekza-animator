// @ekza-studio/agent-evals (MCP-SPEC §9.3): the evaluation suite of the agent bridge — a harness over an in-process
// MCP client ↔ server pair, fixture builders, independent graders, graded tasks with reference and adversarial
// scripts. The MVP runs the smoke of §0.4.1 item 8 (six tasks, the scripted reference agent); the full 25 tasks with
// held-out variants, the fuzzer and the real-model drivers are P9's (deferred, §0.4.2).

/** The task ids of §9.3.3. */
export const TASK_IDS = Array.from(
  { length: 25 },
  (_, i) => `AE-${String(i + 1).padStart(2, '0')}`,
) as readonly string[];

/** The CI modes of §9.3.2 (the manual real-model drivers are not run in CI). */
export const CI_MODES = ['reference', 'adversarial', 'fuzz', 'schema-lint', 'invariant'] as const;
export type CiMode = (typeof CI_MODES)[number];

export {
  type Agent,
  type Envelope,
  type EvalSession,
  type EvalSessionOptions,
  evalSession,
  type TranscriptEntry,
  tempWorkspace,
} from './drivers/scripted';
export {
  charactersReady,
  FIXTURES_DIR,
  type FixtureApp,
  type OpenedProject,
  openProject,
  projectBytes,
  readFixtureFile,
  type SampleName,
  sampleApp,
  type UserKey,
  userClip,
  userKeys,
} from './fixtures/project';
export { waveScript, type WaveOptions } from './scripts/wave';
export { AE01, AE06, AE13, AE19, AE24, AER1, HOSTILE, SMOKE_TASKS } from './tasks/smoke';
export { type GradeInput, runTask, type Task, type TaskRun } from './tasks/task';
