// M7 G-a acceptance (MODELING-PLAN §7.2 G-a, §7.3) through the production kernel, headless: a 96,824-triangle
// textured AI-like GLB (procedural, `io/testing` `makeAiLikeGlb`: facing +X, one unit tall, a fragmented atlas) is
// imported and cleaned by the intake preset in one undo step to ≤ 3,000 triangles and ≤ 16 colours, closed along every
// UV seam; it exports with 0 glTF-Validator errors, Auto-Rig rigs it and its VRM passes vrm-validator; the same input
// and params give the same bytes; "Decimate first" takes a 218k-triangle file that Make editable refuses.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import {
  attachMeshes,
  type EditorApp,
  type IntakeOutcome,
  loadMeshKernel,
  quickRigOf,
} from '@ekza-studio/editor-core';
import { type ExportArtifact, parseGlb } from '@ekza-studio/io';
import { makeAiLikeGlb } from '@ekza-studio/io/testing';
import { type MeshData, topologyStats, validateMesh } from '@ekza-studio/mesh-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportCharacter, settled, vrmErrors } from './m6b.writer.support';
import { realApp, runOk, validate } from './ops.support';

type Json = Record<string, unknown>;

let model: Uint8Array;
beforeAll(async () => {
  await loadMeshKernel();
  model = makeAiLikeGlb();
});

const trianglesOf = (data: MeshData): number => data.counts.corners - 2 * data.counts.faces;

async function app(): Promise<EditorApp> {
  const { app } = realApp();
  attachMeshes(app);
  return app;
}

async function dataOf(a: EditorApp, mesh: MeshId): Promise<MeshData> {
  for (let i = 0; i < 400; i++) {
    const data = a.meshes.get(mesh)?.data() ?? null;
    if (data !== null) return data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no data for ${mesh}`);
}

function bounds(data: MeshData): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < data.counts.points; p++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, data.position[3 * p + k] as number);
      hi[k] = Math.max(hi[k] as number, data.position[3 * p + k] as number);
    }
  }
  return { lo, hi };
}

/** Import (one step), then the intake preset (one step) for a character from a Tripo-like +X export. */
async function imported(a: EditorApp): Promise<{ meshes: MeshId[]; outcome: IntakeOutcome }> {
  const { meshes } = (await runOk(a, 'mesh.importStatic', { bytes: model, name: 'generated.glb' })) as {
    meshes: MeshId[];
  };
  const outcome = (await runOk(a, 'mesh.intake', { meshes, preset: 'character', forward: '+x' })) as IntakeOutcome;
  return { meshes, outcome };
}

describe('M7 G-a: the intake preset on an AI-like model', () => {
  it('the input: 96,824 triangles, textured, 0 validator errors', async () => {
    expect((await validate(model)).errors).toBe(0);
    const json = (await parseGlb(model)).json as Json;
    expect(json['images']).toHaveLength(1);
    const a = await app();
    const { meshes } = (await runOk(a, 'mesh.importStatic', { bytes: model, name: 'generated.glb' })) as {
      meshes: MeshId[];
    };
    const data = await dataOf(a, meshes[0] as MeshId);
    expect(trianglesOf(data)).toBe(96_824);
    expect(topologyStats(data)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, shells: 1 });
  });

  it('≤ 3,000 triangles, ≤ 16 colours, no cracks, +Z forward at 1.70 m on the origin, one undo step', async () => {
    const a = await app();
    const { meshes, outcome } = await imported(a);
    const mesh = meshes[0] as MeshId;
    expect(a.history.peekUndo()?.label).toBe('Intake');
    const data = await dataOf(a, mesh);
    expect(validateMesh(data)).toEqual([]);
    expect(trianglesOf(data)).toBeLessThanOrEqual(3000);
    expect(trianglesOf(data)).toBeGreaterThanOrEqual(2990);
    expect(outcome.triangles).toEqual({ before: 96_824, after: trianglesOf(data) });
    // No cracks: still one closed shell without non-manifold edges (a seam crack would open a border).
    expect(topologyStats(data)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, shells: 1 });
    // ≤ 16 colours in one new palette, every face on a live slot.
    expect(outcome.colours).toBeGreaterThan(4);
    expect(outcome.colours).toBeLessThanOrEqual(16);
    const record = a.store.get('meshes', mesh);
    expect(record).toMatchObject({ palette: outcome.palette, material: { preset: 'unlit' }, source: null });
    const swatches = a.store.query.swatchesOfPalette(outcome.palette as never);
    expect(swatches).toHaveLength(outcome.colours as number);
    const paint = data.layers.get('paint')?.data as Uint16Array;
    expect(Math.max(...paint)).toBeLessThan(swatches.length);
    // Normalized: 1.70 m, standing on y = 0, centred on X/Z, identity placement (normalize is exact; the reduce
    // after it may pull the extreme points in by a millimetre or two).
    const { lo, hi } = bounds(data);
    expect(Math.abs((hi[1] as number) - (lo[1] as number) - 1.7)).toBeLessThan(0.01);
    expect(Math.abs(lo[1] as number)).toBeLessThan(0.005);
    expect(Math.abs(((lo[0] as number) + (hi[0] as number)) / 2)).toBeLessThan(0.01);
    expect(Math.abs(((lo[2] as number) + (hi[2] as number)) / 2)).toBeLessThan(0.01);
    expect(record?.placement).toEqual({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    // The chain's steps and the AI-marks flag for the provenance.
    expect(outcome.steps.map((step) => step.kind)).toEqual(['normalize', 'reduce', 'quadrangulate', 'paletteBake']);
    expect(outcome.aiMarksMayBeAltered).toBe(true);
    expect(outcome.worker).toBe(false);
    process.stdout.write(
      `m7ga intake (Node, this thread): ${outcome.steps
        .map((s) => `${s.kind} ${s.ms.toFixed(1)} ms ${s.trianglesBefore}→${s.trianglesAfter} ${JSON.stringify(s.facts)}`)
        .join('\n  ')}\n  chain ${outcome.ms.toFixed(1)} ms\n`,
    );
    // Undo restores the import exactly.
    a.history.undo();
    expect(trianglesOf(await dataOf(a, mesh))).toBe(96_824);
    expect(a.store.get('meshes', mesh)?.palette).toBeNull();
  });

  it('exports with 0 validator errors and is deterministic: the same input and params give the same bytes', async () => {
    const runs: { manifest: string; bytes: Uint8Array; colours: unknown }[] = [];
    for (let i = 0; i < 2; i++) {
      const a = await app();
      const { meshes, outcome } = await imported(a);
      const [artifact] = (await runOk(a, 'file.exportModel', {
        objects: meshes,
        fileName: 'generated-clean',
        profile: 'local/generic',
      })) as ExportArtifact[];
      if (artifact === undefined) throw new Error('no artifact');
      expect(artifact.validation?.errors).toBe(0);
      expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
      const record = a.store.get('meshes', meshes[0] as MeshId);
      runs.push({
        manifest: record?.data?.manifest ?? '',
        bytes: artifact.bytes,
        colours: a.store.query.swatchesOfPalette(outcome.palette as never).map((s) => s.srgb),
      });
      a.dispose();
    }
    expect(runs[1]?.manifest).toBe(runs[0]?.manifest);
    expect(runs[1]?.colours).toEqual(runs[0]?.colours);
    expect(Buffer.compare(Buffer.from(runs[1]?.bytes ?? []), Buffer.from(runs[0]?.bytes ?? []))).toBe(0);
  });

  it('Auto-Rig takes the result: markers guessed, rigged and bound, a clean VRM 1.0', async () => {
    const a = await app();
    await a.rig.load();
    const { meshes } = await imported(a);
    await runOk(a, 'workspace.set', { workspace: 'rig' });
    const report = (await runOk(a, 'autorig.inspect', { meshes })) as { checks: Record<string, unknown> };
    expect(report.checks).toMatchObject({ centred: true, grounded: true, facing: true, upright: true, scale: 'ok' });
    await runOk(a, 'skel.quickRig.start', { meshes });
    expect(quickRigOf(a)?.preview).not.toBeNull();
    const rigged = (await runOk(a, 'autorig.rig', { straighten: false })) as { character: CharacterId };
    await settled(a);
    await runOk(a, 'char.setVrmMeta', {
      character: rigged.character,
      patch: { authors: ['Tester'], licensePreset: 'cc0' },
    });
    const artifact = await exportCharacter(a, {
      character: rigged.character,
      profile: 'ekza/space-avatar-v1',
      format: 'vrm',
    });
    expect(await vrmErrors(artifact.bytes)).toEqual([]);
    expect(artifact.validation?.errors ?? 0).toBe(0);
  });
});

describe('M7 G-a: Decimate first (imports over 200,000 triangles)', () => {
  it('Make editable refuses a 217,854-triangle file; mesh.intake {bytes} imports and cleans it in one step', async () => {
    const heavy = makeAiLikeGlb({ subdivisions: 21, textureSize: 512 });
    const a = await app();
    const refused = await a.runUntyped('mesh.importStatic', { bytes: heavy, name: 'heavy.glb' });
    expect(refused).toMatchObject({ status: 'failed', error: { code: 'too-large' } });
    const t0 = performance.now();
    const outcome = (await runOk(a, 'mesh.intake', {
      bytes: heavy,
      name: 'heavy.glb',
      preset: 'hero',
      forward: '+x',
    })) as IntakeOutcome;
    const ms = performance.now() - t0;
    expect(a.history.peekUndo()?.label).toBe('Intake');
    expect(outcome.triangles.before).toBe(217_854);
    expect(outcome.triangles.after).toBeLessThanOrEqual(10_000);
    const data = await dataOf(a, outcome.meshes[0] as MeshId);
    expect(topologyStats(data)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0 });
    process.stdout.write(`m7ga decimate first 217,854 → ${outcome.triangles.after}: chain ${outcome.ms.toFixed(0)} ms, run ${ms.toFixed(0)} ms\n`);
    // One step: undo removes the import too.
    a.history.undo();
    expect(a.store.list('meshes').filter((mesh) => mesh.deleted === null)).toHaveLength(0);
  });
});

describe('M7 G-a: the single operators', () => {
  it('reduce, normalize, palette bake each make one step; polls say why they cannot run', async () => {
    const a = await app();
    const { meshes } = (await runOk(a, 'mesh.importStatic', { bytes: model, name: 'generated.glb' })) as {
      meshes: MeshId[];
    };
    expect(a.operators.poll('mesh.reduce', undefined, { meshes: [] })).toEqual({ ok: false, reason: 'Select a mesh' });
    const reduced = (await runOk(a, 'mesh.reduce', { meshes, preset: 'prop' })) as IntakeOutcome;
    expect(reduced.triangles.after).toBeLessThanOrEqual(500);
    expect(a.history.peekUndo()?.label).toBe('Reduce');
    expect(a.operators.poll('mesh.reduce', undefined, { meshes, preset: 'prop' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^Already under the budget/),
    });
    await runOk(a, 'mesh.normalize', { meshes, height: 1.2, forward: '+x' });
    expect(a.history.peekUndo()?.label).toBe('Normalize');
    const { hi, lo } = bounds(await dataOf(a, meshes[0] as MeshId));
    expect((hi[1] as number) - (lo[1] as number)).toBeCloseTo(1.2, 4);
    const baked = (await runOk(a, 'mesh.paletteBake', { meshes, colours: 6 })) as IntakeOutcome;
    expect(baked.colours).toBeLessThanOrEqual(6);
    expect(a.history.peekUndo()?.label).toBe('Palette Bake');
    // A palette-coloured mesh is paintable and re-bakes from its swatches.
    const again = (await runOk(a, 'mesh.paletteBake', { meshes, colours: 3 })) as IntakeOutcome;
    expect(again.colours).toBeLessThanOrEqual(3);
  });

  it('texture downsize keeps the texture at ≤ 512 px in a new model asset (0 validator errors)', async () => {
    const a = await app();
    const { meshes } = (await runOk(a, 'mesh.importStatic', { bytes: model, name: 'generated.glb' })) as {
      meshes: MeshId[];
    };
    const before = a.store.get('meshes', meshes[0] as MeshId)?.material as { assetSlots: { asset: string }[] };
    const outcome = (await runOk(a, 'mesh.textureDownsize', { meshes, size: 512 })) as IntakeOutcome;
    expect(outcome.aiMarksMayBeAltered).toBe(true);
    const after = a.store.get('meshes', meshes[0] as MeshId)?.material as { assetSlots: { asset: string }[] };
    expect(after.assetSlots[0]?.asset).not.toBe(before.assetSlots[0]?.asset);
    const bytes = await a.services.assets.get(after.assetSlots[0]?.asset as never);
    expect((await validate(bytes)).errors).toBe(0);
    const json = (await parseGlb(bytes)).json as Json;
    expect(json['images']).toHaveLength(1);
    expect(bytes.byteLength).toBeLessThan(model.byteLength);
  });
});
