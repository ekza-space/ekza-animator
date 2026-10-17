// Deterministic randomness for the conformance suite and the test network. The suite registers through the host
// runner's globals and therefore cannot import fast-check (see docs/wp-notes/wp-2.md); this module provides the small
// part of it the suite needs: seeded generation, many runs, and list shrinking with a reproducible failure report.

/** mulberry32: small, fast, good enough for test data. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [min, max]. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(items.length)] as T;
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** A derived generator (independent stream for a sub-task). */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export interface PropertyOptions {
  readonly seed: number;
  readonly runs: number;
  /** Shrinking attempts after a failure (each re-runs the property). */
  readonly maxShrinks?: number;
}

/**
 * Runs `check` on `runs` generated lists of steps. On failure the list is shrunk (chunks, then single steps removed
 * while the failure persists) and an error names the seed, the run and the minimal steps.
 */
export async function checkSteps<Step>(
  name: string,
  opts: PropertyOptions,
  generate: (rng: Rng) => Step[],
  check: (steps: readonly Step[], rng: Rng) => void | Promise<void>,
  describeStep: (step: Step) => string = (step) => JSON.stringify(step),
): Promise<void> {
  for (let run = 0; run < opts.runs; run++) {
    const runSeed = (opts.seed + Math.imul(run, 0x9e3779b1)) >>> 0;
    const steps = generate(new Rng(runSeed));
    const failure = await failureOf(() => check(steps, new Rng(runSeed ^ 0x5bd1e995)));
    if (failure === null) continue;
    let minimal = steps;
    let minimalFailure = failure;
    let budget = opts.maxShrinks ?? 200;
    for (
      let chunk = Math.max(1, Math.floor(minimal.length / 2));
      chunk >= 1 && budget > 0;
      chunk = Math.floor(chunk / 2)
    ) {
      for (let start = 0; start < minimal.length && budget > 0; ) {
        const candidate = [...minimal.slice(0, start), ...minimal.slice(start + chunk)];
        budget--;
        const candidateFailure = await failureOf(() => check(candidate, new Rng(runSeed ^ 0x5bd1e995)));
        if (candidateFailure !== null) {
          minimal = candidate;
          minimalFailure = candidateFailure;
        } else {
          start += chunk;
        }
      }
    }
    const lines = minimal.map((step, i) => `  ${i}: ${describeStep(step)}`).join('\n');
    const message =
      minimalFailure instanceof Error
        ? minimalFailure.message
        : typeof minimalFailure === 'string'
          ? minimalFailure
          : JSON.stringify(minimalFailure);
    throw new Error(
      `${name} failed (seed ${opts.seed}, run ${run}, run seed ${runSeed}) after ${minimal.length} steps:\n${lines}\n${message}`,
      { cause: minimalFailure },
    );
  }
}

async function failureOf(fn: () => void | Promise<void>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error ?? new Error('thrown undefined');
  }
}
