// Graders (MCP-SPEC §9.3.1, §9.3.4): independent of the tool layer (they read bone worlds and curves from a separate
// headless app). E2E-AI-01 imports the AE-01 grader from `@ekza-studio/agent-evals/graders`. D0 scaffold; P9.
export interface GradeResult {
  readonly pass: boolean;
  readonly score: number; // 0…1
  readonly notes: readonly string[];
}
