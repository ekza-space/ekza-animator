// mesh.io (M6A-SPEC §5.21–§5.22, §9 B8): bake into model with edited meshes through `file.export` on the production
// kernel — the surgeon keeps every untouched JSON value and the BIN prefix of Polybot, Seed-san and the UAL mannequin,
// the validator finds no new errors, new vertices are normalized and morph targets keep NORMAL; a Make editable
// without edits bakes exactly as M2a did (v1); export → re-import → re-bake keeps the geometry with the original
// baseline (the headless twin of E2E-MOD-31), also after an earlier bake emptied a material slot.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import type { EditorApp } from '@ekza-studio/editor-core';
import {
  compareValidation,
  type ExportArtifact,
  type ExportRequest,
  type GlbContainer,
  parseGlb,
} from '@ekza-studio/io';
import { describe, expect, it } from 'vitest';
import {
  AccessorReader,
  binPrefixKept,
  deleteFacesAndCommit,
  keyedClip,
  makeEditable,
  meshData,
  preservationProblems,
  splitAndCommit,
} from './mesh.io.support';
import { importFixture, realApp, runOk, runtimeOf, validate } from './ops.support';

type Json = Record<string, unknown>;

function request(character: CharacterId, clips: readonly ClipId[]): ExportRequest {
  return {
    kind: 'bake-into-model',
    character,
    clips,
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  };
}

async function bake(app: EditorApp, character: CharacterId, clip: ClipId): Promise<ExportArtifact> {
  const [artifact] = (await runOk(app, 'file.export', request(character, [clip]))) as readonly ExportArtifact[];
  if (artifact === undefined) throw new Error('no artifact');
  return artifact;
}

const markerOf = (c: GlbContainer, version: 1 | 2): Json | undefined =>
  (c.json.asset.extras as Record<string, Json> | undefined)?.[`ekza_animator_bake_v${version}`];

describe('mesh.io: bake into model with edited meshes', () => {
  for (const [fixture, mesh] of [
    ['polybot.vrm', 0],
    ['seed-san.vrm', 2],
    ['quaternius-ual.glb', 0],
  ] as const) {
    it(`${fixture}: untouched JSON and BIN prefix, no new validator errors, marker v2`, async () => {
      const { app } = realApp();
      const { character } = await importFixture(app, fixture);
      const clip = await keyedClip(app, character);
      const id = await makeEditable(app, character, mesh);
      const edited = splitAndCommit(app, id, 50);
      const artifact = await bake(app, character, clip);
      expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
      expect(artifact.readBack?.ok).toBe(true);
      const source = await parseGlb(readFixture(fixture));
      const out = await parseGlb(artifact.bytes);
      expect(preservationProblems(source, out, [mesh])).toEqual([]);
      expect(binPrefixKept(source, out)).toBe(true);
      expect(compareValidation(await validate(source.bytes), await validate(artifact.bytes))).toEqual([]);
      expect(artifact.validation?.errors).toBe(0); // the host's validator ran in the export (the sources have none)
      expect(markerOf(out, 2)).toMatchObject({ version: 2, baseSha256: source.sha256 });
      expect(markerOf(out, 1)).toBeUndefined();
      // The edited mesh reads back with the edit's triangle count.
      const primitives = ((out.json['meshes'] as Json[])[mesh]?.['primitives'] ?? []) as Json[];
      const accessors = out.json['accessors'] as Json[];
      const triangles = primitives.reduce(
        (sum, p) => sum + ((accessors[p['indices'] as number]?.['count'] as number) ?? 0) / 3,
        0,
      );
      expect(triangles).toBe(edited.counts.faces);
      app.dispose();
    });
  }

  it('Polybot: morph targets keep NORMAL and the new vertices are normalized', async () => {
    const { app } = realApp({ validator: false });
    const { character } = await importFixture(app, 'polybot.vrm');
    const clip = await keyedClip(app, character);
    const id = await makeEditable(app, character, 0);
    splitAndCommit(app, id, 80);
    const out = await parseGlb((await bake(app, character, clip)).bytes);
    const reader = new AccessorReader(out);
    const primitive = (out.json['meshes'] as { primitives: Json[] }[])[0]?.primitives[0] as Json;
    const attributes = primitive['attributes'] as Record<string, number>;
    const count = reader.count(attributes['POSITION'] as number);
    for (const target of primitive['targets'] as Record<string, number>[]) {
      const normal = reader.floats(target['NORMAL'] as number);
      expect(normal.length).toBe(3 * count);
      expect(normal.every(Number.isFinite)).toBe(true);
    }
    const weights = reader.floats(attributes['WEIGHTS_0'] as number);
    for (let v = 0; v < count; v++) {
      const sum =
        (weights[4 * v] as number) +
        (weights[4 * v + 1] as number) +
        (weights[4 * v + 2] as number) +
        (weights[4 * v + 3] as number);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    }
    app.dispose();
  });

  it('a mesh made editable but not edited bakes exactly like M2a (marker v1, same bytes)', async () => {
    const plain = realApp({ validator: false });
    const a = await importFixture(plain.app, 'polybot.vrm');
    const clipA = await keyedClip(plain.app, a.character);
    const reference = await bake(plain.app, a.character, clipA);

    const editable = realApp({ validator: false });
    const b = await importFixture(editable.app, 'polybot.vrm');
    const clipB = await keyedClip(editable.app, b.character);
    await makeEditable(editable.app, b.character, 0);
    const artifact = await bake(editable.app, b.character, clipB);
    expect(Buffer.compare(Buffer.from(artifact.bytes), Buffer.from(reference.bytes))).toBe(0);
    expect(markerOf(await parseGlb(artifact.bytes), 1)).toBeDefined();
    plain.app.dispose();
    editable.app.dispose();
  });

  it('export → re-import → re-bake keeps the edited geometry over the original baseline (E2E-MOD-31 twin)', async () => {
    const { app } = realApp();
    const { character } = await importFixture(app, 'polybot.vrm');
    const clip = await keyedClip(app, character);
    const id = await makeEditable(app, character, 0);
    const edited = splitAndCommit(app, id, 60);
    const a = await bake(app, character, clip);
    app.dispose();

    const second = realApp();
    const imported = (await runOk(second.app, 'file.importModel', { name: 'a.vrm', bytes: a.bytes })) as {
      character: CharacterId;
    };
    await runtimeOf(second.app, imported.character);
    const clip2 = await keyedClip(second.app, imported.character, 'idle');
    const b = await bake(second.app, imported.character, clip2);
    expect(b.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    const source = await parseGlb(readFixture('polybot.vrm'));
    const fileB = await parseGlb(b.bytes);
    expect(markerOf(fileB, 2)).toMatchObject({
      baseSha256: source.sha256,
      baseAccessors: (source.json['accessors'] as unknown[]).length,
      baseBinLength: ((source.json['buffers'] as Json[])[0]?.['byteLength'] as number) ?? 0,
    });
    expect(compareValidation(await validate(source.bytes), await validate(b.bytes))).toEqual([]);
    expect(b.validation?.errors).toBe(0);
    expect(preservationProblems(source, fileB, [0])).toEqual([]);
    // Making B editable gives A's geometry: the same triangles at the same positions.
    const mesh = await makeEditable(second.app, imported.character, 0);
    expect(meshData(second.app, mesh).counts.faces).toBe(edited.counts.faces);
    const positions = (data: ReturnType<typeof meshData>): string[] => {
      const out: string[] = [];
      for (let c = 0; c < data.counts.corners; c++) {
        const p = data.cornerVert[c] as number;
        out.push([0, 1, 2].map((k) => (data.position[3 * p + k] as number).toFixed(6)).join(','));
      }
      return out.sort();
    };
    expect(positions(meshData(second.app, mesh))).toEqual(positions(edited));
    second.app.dispose();
  });

  it('a re-bake of a re-imported file whose bake emptied a material slot keeps every face on its material', async () => {
    // Seed-san's head (mesh 2) has materials [2, 3, 4]; A deletes the faces of slot 1, so A's head has [2, 4] and a
    // Make editable on A numbers its slots 0 → 2, 1 → 4. The re-bake rolls A back to the original primitives first.
    const head = 2;
    const materialsOf = (c: GlbContainer): unknown[] =>
      (((c.json['meshes'] as Json[])[head] as Json)['primitives'] as Json[]).map((p) => p['material']);
    const { app } = realApp({ validator: false });
    const { character } = await importFixture(app, 'seed-san.vrm');
    const clip = await keyedClip(app, character);
    const id = await makeEditable(app, character, head);
    deleteFacesAndCommit(app, id, (data, f) => data.faceMaterial[f] === 1);
    const a = await bake(app, character, clip);
    app.dispose();
    const fileA = await parseGlb(a.bytes);
    expect(materialsOf(fileA)).toEqual([2, 4]);

    const second = realApp();
    const imported = (await runOk(second.app, 'file.importModel', { name: 'a.vrm', bytes: a.bytes })) as {
      character: CharacterId;
    };
    await runtimeOf(second.app, imported.character);
    const clip2 = await keyedClip(second.app, imported.character, 'idle');
    const mesh = await makeEditable(second.app, imported.character, head);
    const edited = splitAndCommit(second.app, mesh, 8);
    const b = await bake(second.app, imported.character, clip2);
    expect(b.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(b.validation?.errors).toBe(0);
    const fileB = await parseGlb(b.bytes);
    expect(materialsOf(fileB)).toEqual([2, 4]);
    const triangles = (c: GlbContainer): number[] =>
      (((c.json['meshes'] as Json[])[head] as Json)['primitives'] as Json[]).map(
        (p) => ((c.json['accessors'] as Json[])[p['indices'] as number]?.['count'] as number) / 3,
      );
    const perSlot = [0, 1].map((slot) => {
      let n = 0;
      for (let f = 0; f < edited.counts.faces; f++) if (edited.faceMaterial[f] === slot) n++;
      return n;
    });
    expect(triangles(fileB)).toEqual(perSlot);
    const source = await parseGlb(readFixture('seed-san.vrm'));
    expect(compareValidation(await validate(source.bytes), await validate(b.bytes))).toEqual([]);
    second.app.dispose();
  });
});
