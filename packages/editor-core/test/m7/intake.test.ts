// M7 G-a (MODELING-PLAN §7.2; DECISIONS M7-GA-CONTRACT-*): the intake operators' polls (plain reasons, no throw),
// one undo step per run that Adjust Last re-runs from the original, and the worker path: a job posted to an intake
// worker (here a port that answers with mesh-wasm's own handler) gives the same bytes as the inline run.
import type { MeshId } from '@ekza-studio/doc';
import { handleIntakeRequest, type IntakeWorkerRequest } from '@ekza-studio/mesh-wasm/worker';
import { describe, expect, it } from 'vitest';
import type { EditorApp, IntakeOutcome, IntakeWorkerHost, IntakeWorkerPort } from '../../src';
import { meshTestApp } from '../mesh/support';

const INTAKE = ['mesh.normalize', 'mesh.reduce', 'mesh.paletteBake', 'mesh.textureDownsize', 'mesh.intake'];

async function ok<T>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** A Model scene with one 32 × 32 sphere (1,984 triangles), selected. */
async function sphereApp(): Promise<{ app: EditorApp; mesh: MeshId }> {
  const { app } = await meshTestApp();
  await ok(app, 'workspace.set', { workspace: 'model' });
  const created = await ok<{ readonly mesh: MeshId }>(app, 'mesh.create.sphere', {
    subdivisionsAxis: 32,
    subdivisionsHeight: 32,
  });
  return { app, mesh: created.mesh };
}

/** A worker port that answers with mesh-wasm's handler, asynchronously, like a real worker. */
function fakeWorker(posted: IntakeWorkerRequest[]): IntakeWorkerPort {
  const port: IntakeWorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      posted.push(message);
      void handleIntakeRequest(message).then(({ response }) => port.onmessage?.({ data: response }));
    },
    terminate() {},
  };
  return port;
}

describe('the intake operators (M7 G-a)', () => {
  it('poll-fail with plain reasons and never throw on junk arguments', async () => {
    const { app } = await meshTestApp();
    for (const id of INTAKE) {
      for (const args of [undefined, {}, { meshes: ['msh_X'] }]) {
        const result = await app.runUntyped(id, args);
        expect([id, result.status === 'cancelled' ? result.reason : result.status]).toEqual([id, 'Select a mesh']);
      }
      const junk = await app.runUntyped(id, 42);
      expect(junk.status).toBe('cancelled');
    }
    expect(app.history.canUndo()).toBe(false);
  });

  it('reduce: one undo step, adjustable from the original, and "Already under the budget" when done', async () => {
    const { app, mesh } = await sphereApp();
    const before = app.meshes.get(mesh)?.data()?.counts.faces;
    const first = await ok<IntakeOutcome>(app, 'mesh.reduce', { meshes: [mesh], triangles: 400 });
    expect(first.triangles).toEqual({ before: 1984, after: 400 });
    expect(app.history.peekUndo()?.label).toBe('Reduce');
    // Adjust Last re-runs from the original mesh, not from the reduced one.
    await ok(app, 'edit.adjustLast', { args: { triangles: 1000 } });
    const data = app.meshes.get(mesh)?.data();
    expect((data?.counts.corners ?? 0) - 2 * (data?.counts.faces ?? 0)).toBe(1000);
    const verdict = app.operators.poll('mesh.reduce', undefined, { meshes: [mesh], triangles: 2000 });
    expect(verdict).toEqual({ ok: false, reason: 'Already under the budget (1,000 triangles)' });
    app.history.undo();
    expect(app.meshes.get(mesh)?.data()?.counts.faces).toBe(before);
  });

  it('the worker path gives the same bytes as the inline run', async () => {
    const inline = await sphereApp();
    const a = await ok<IntakeOutcome>(inline.app, 'mesh.intake', { meshes: [inline.mesh], preset: 'prop' });
    expect(a.worker).toBe(false);
    const posted: IntakeWorkerRequest[] = [];
    const viaWorker = await sphereApp();
    (viaWorker.app.meshes as unknown as IntakeWorkerHost).intakeWorker = () => fakeWorker(posted);
    const b = await ok<IntakeOutcome>(viaWorker.app, 'mesh.intake', { meshes: [viaWorker.mesh], preset: 'prop' });
    expect(b.worker).toBe(true);
    expect(posted).toHaveLength(1);
    // The document's data was copied before the transfer: the original revision still reads.
    expect(posted[0]?.job.meshes[0]?.data.position).not.toBe(
      viaWorker.app.meshes.get(viaWorker.mesh)?.data()?.position,
    );
    expect(b.triangles).toEqual(a.triangles);
    expect(viaWorker.app.store.get('meshes', viaWorker.mesh)?.data?.manifest).toBe(
      inline.app.store.get('meshes', inline.mesh)?.data?.manifest,
    );
  });
});
