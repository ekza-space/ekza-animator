// M6A-SPEC §5.29 P1, P5, P8 on the Euler operators (Node): model-based `fc.commands` runs of 50–500 steps on
// primitives with random divisions and on synthetic non-manifold soups; every step goes through the harness
// (validity, count oracle, canonical links, remap, dirty set, incremental = full revision, exact undo and redo).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, type MeshData, primitive, writeRevision } from '../../src';
import { arbEulerStep, arbPrimitive, arbSoup, type EulerStep } from '../../src/testing';
import { checkStep, newTally, type StepTally } from './harness';

interface Model {
  steps: number;
}
interface Real {
  readonly mesh: EditMesh;
  revision: ReturnType<typeof writeRevision>;
  readonly tally: StepTally;
}

class StepCommand implements fc.Command<Model, Real> {
  constructor(readonly step: EulerStep) {}
  check(): boolean {
    return true;
  }
  run(model: Model, real: Real): void {
    real.revision = checkStep(real.mesh, this.step, real.tally, real.revision);
    model.steps++;
  }
  toString(): string {
    return JSON.stringify(this.step);
  }
}

const commands = fc.commands([arbEulerStep().map((step) => new StepCommand(step))], { maxCommands: 500, size: 'max' });

function run(start: MeshData, cmds: Iterable<fc.Command<Model, Real>>): StepTally {
  const mesh = editMeshFrom(start);
  const real: Real = { mesh, revision: writeRevision(mesh), tally: newTally() };
  fc.modelRun(() => ({ model: { steps: 0 }, real }), cmds);
  return real.tally;
}

describe('Euler operator sequences (P1, P5, P8; model-based)', () => {
  it('on primitives with random divisions', () => {
    let applied = 0;
    fc.assert(
      fc.property(arbPrimitive(), commands, ({ kind, params }, cmds) => {
        applied += run(primitive(kind, params), cmds).applied;
      }),
      { numRuns: 8 },
    );
    expect(applied).toBeGreaterThan(100);
  });

  it('on synthetic non-manifold soups', () => {
    let steps = 0;
    fc.assert(
      fc.property(arbSoup(), commands, (soup, cmds) => {
        const tally = run(soup, cmds);
        steps += tally.applied + tally.refused;
      }),
      { numRuns: 8 },
    );
    expect(steps).toBeGreaterThan(100);
  });

  it('runs 50–500 steps (fixed-length sequences from a cube)', () => {
    fc.assert(
      fc.property(fc.array(arbEulerStep(), { minLength: 50, maxLength: 500 }), (steps) => {
        const tally = run(
          primitive('cube', { subdivisionsWidth: 2 }),
          steps.map((step) => new StepCommand(step)),
        );
        expect(tally.applied + tally.refused + tally.skipped).toBe(steps.length);
      }),
      { numRuns: 3 },
    );
  });
});
