// @ekza-animator/agent-evals (MCP-SPEC §9.3): the evaluation suite of the agent bridge — a harness over an in-process
// MCP client ↔ server pair, fixture builders, independent graders, 25 graded tasks (AE-01…AE-25) with held-out
// variants, a reference script per prompt, and the reference / adversarial / fuzz / schema-lint / invariant modes.
// D0 lands the scaffold; P9 builds the suite.

/** The task ids of §9.3.3. */
export const TASK_IDS = Array.from(
  { length: 25 },
  (_, i) => `AE-${String(i + 1).padStart(2, '0')}`,
) as readonly string[];

/** The CI modes of §9.3.2 (the manual real-model drivers are not run in CI). */
export const CI_MODES = ['reference', 'adversarial', 'fuzz', 'schema-lint', 'invariant'] as const;
export type CiMode = (typeof CI_MODES)[number];
