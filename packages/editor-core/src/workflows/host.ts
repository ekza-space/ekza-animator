// Long workflows run on the main thread (ADR 0005 §10): they yield to the host between units of work (clips) so the
// page keeps rendering, and report their progress for the busy indicator (`session.busy`).

/** Resolves on a later macrotask: rendering and input can run in between. */
export function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Progress callback: a fraction in [0, 1]. */
export type Progress = (fraction: number) => void;
