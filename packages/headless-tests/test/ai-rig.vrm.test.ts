// MCP-SPEC §0.4.4, MVP-AC-3 (M-AI B4), headless in Node: the operator runs the character setup tools make, under an
// agent actor, on the headless editor (`createHeadlessEditorApp`, no worker): `autorig.intake` of the static Polybot
// (T- and A-pose) and the Cube Lad → `autorig.inspect` → Quick Rig → `autorig.rig` (Create Skeleton, Bind Skin in
// Node, + Straighten for the A-pose) → `autorig.clip.add` walk → `char.setVrmMeta` → `autorig.export` ekza-vrm. Every
// step is an `AI: …` step of the agent; the bind skinned the mesh; the VRM 1.0 passes glTF-Validator and vrm-validator
// with 0 errors and every `vrm.*` lint, reads back 15+ humanoid bones, and is written to `test-results/ai-rig/` for the
// local OMOBA check (`node tooling/omoba-validate.mjs test-results/ai-rig/*.vrm`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type CharacterId, type MeshId, seededIdSource } from '@ekza-studio/doc';
import {
  type AutoRigExportResult,
  type AutoRigRigResult,
  createHeadlessEditorApp,
  type EditorApp,
  type IntakeReport,
  type RunActor,
  type RunContext,
} from '@ekza-studio/editor-core';
import { parseGlb } from '@ekza-studio/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vrmErrors } from './m6b.writer.support';
import { validate } from './ops.support';

const AGENT: RunActor = { kind: 'agent', id: 'agt_HeadlessRig001', name: 'Headless rig' };
const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('test-results/ai-rig/', ROOT);
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, ROOT)));

let realFetch: typeof globalThis.fetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  // the clip library's default base `/library/` (the web app's public folder)
  globalThis.fetch = ((url: string | URL) => {
    const bytes = file(`apps/web/public${String(url)}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    } as unknown as Response);
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** One run as the tools make it: the agent actor, the tool's access ('view' where the Rig & Skin session changes). */
async function agentRun<T = unknown>(app: EditorApp, id: string, args: unknown, access: 'edit' | 'view' = 'edit') {
  const ctx: RunContext = { source: 'api', actor: AGENT, access };
  const result = await app.runUntyped(id, args, ctx);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

async function characterReady(app: EditorApp, character: CharacterId): Promise<void> {
  for (let i = 0; i < 500 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (app.characters.get(character) === undefined) throw new Error('no character runtime');
}

const CASES = [
  { model: 'polybot-unskinned-tpose.glb', out: 'polybot-tpose.vrm', straighten: false },
  { model: 'polybot-unskinned.glb', out: 'polybot-apose.vrm', straighten: true },
  { model: 'cube-lad.glb', out: 'cube-lad.vrm', straighten: false },
] as const;

describe('MVP-AC-3 in Node: an agent rigs a static model, adds a walk and exports a valid VRM 1.0', () => {
  for (const { model, out, straighten } of CASES) {
    it(`${model}`, async () => {
      const downloads: { fileName: string; bytes: Uint8Array }[] = [];
      const app = createHeadlessEditorApp({
        validate,
        idSource: seededIdSource(17),
        onDownload: (download) => downloads.push(download),
      });
      // project_import {sample}
      const intake = await agentRun<IntakeReport>(
        app,
        'autorig.intake',
        { bytes: file(`fixtures/models/${model}`), name: model },
        'view',
      );
      expect(intake.kind).toBe('static');
      const meshes = intake.meshes as MeshId[];
      // model_inspect
      const report = await agentRun<IntakeReport>(app, 'autorig.inspect', { meshes });
      expect(report.checks).toMatchObject({ centred: true, grounded: true, facing: true, upright: true, scale: 'ok' });
      expect(report.pose?.kind).toBe(straighten ? 'a' : 't');
      // rig_create
      await app.rig.load();
      await agentRun(app, 'skel.quickRig.start', { meshes }, 'view');
      const rig = await agentRun<AutoRigRigResult>(app, 'autorig.rig', { straighten, rigidParts: false }, 'view');
      await characterReady(app, rig.character);
      const bound = app.store.query.meshesOfOwner(rig.character).filter((mesh) => mesh.deleted === null);
      expect(bound.length).toBeGreaterThan(0);
      expect(bound.every((mesh) => mesh.skin !== null && 'skeleton' in mesh.skin)).toBe(true);
      // library_use {clip: 'walk'} (headless: a View run, the clip becomes the active one)
      const added = await agentRun<{ clip: string }>(
        app,
        'autorig.clip.add',
        {
          character: rig.character,
          clip: 'walk',
          params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
        },
        'view',
      );
      expect(app.store.get('clips', added.clip as never)?.name).toBe('Walk');
      // project_export {kind: 'vrm', meta}
      await agentRun(app, 'char.setVrmMeta', {
        character: rig.character,
        patch: { authors: ['Ekza Studio tests'], licensePreset: 'cc0' },
      });
      const exported = await agentRun<AutoRigExportResult>(app, 'autorig.export', {
        character: rig.character,
        target: 'ekza-vrm',
        fileName: out.replace(/\.vrm$/, ''),
      });
      expect(exported.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
      const [download] = downloads;
      expect(download?.fileName).toBe(out);
      const bytes = download?.bytes ?? new Uint8Array(0);

      const gltf = await validate(bytes);
      expect(gltf.issues.filter((issue) => issue.severity === 0)).toEqual([]);
      expect(await vrmErrors(bytes)).toEqual([]);
      const json = (await parseGlb(bytes)).json as {
        extensions?: { VRMC_vrm?: { specVersion?: string; humanoid?: { humanBones?: Record<string, unknown> } } };
      };
      expect(json.extensions?.VRMC_vrm?.specVersion).toBe('1.0');
      expect(Object.keys(json.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {}).length).toBeGreaterThanOrEqual(15);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(new URL(out, OUT), bytes);

      // every step is the agent's AI step
      expect(app.history.entries().undo.map((step) => [step.label, step.actor?.id])).toEqual(
        [
          'AI: Import Static Model',
          'AI: Create Skeleton',
          'AI: Bind Skin',
          ...(straighten ? ['AI: Straighten to T-Pose'] : []),
          'AI: Use Clip Walk',
          'AI: VRM Meta',
        ].map((label) => [label, AGENT.id]),
      );
      app.dispose();
    }, 60_000);
  }
});
