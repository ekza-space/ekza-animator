// Make editable (M6A-SPEC §6.2, §5.21; B8 owns the operator, B13 the Outliner button and the report dialog).
//
// `mesh.makeEditable {character, meshIndex}` creates the record of one of a character's glTF meshes lazily, in its
// own transaction, with the derived id `derivedId('mesh', 'asset', [characterId], '', meshIndex)` (so a re-run or an
// M3 peer never duplicates it), `owner: {character}`, `source: {asset, mesh}`, the imported skin, the asset's material
// slots and its first revision as `data`. Importing or animating a character writes no mesh record (rule 10).
// `prepare` loads the kernel and the lazy mesh entry and builds the MeshData (licence gate, weld, layers, hard edges,
// report); a refusal fails the run with its reason and writes nothing.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetMaterialRef, CharacterId, MeshId, MeshRecord } from '@ekza-animator/doc';
import { type MakeEditableReport, readVrmLicense } from '@ekza-animator/io';
import type { MeshData } from '@ekza-animator/mesh-core';
import { isAssetCharacter } from '../../characters/registry';
import { loadMeshKernel } from '../../mesh';
import type { EditorApp, PollResult } from '../../types';
import { loadWritePath } from '../../workflows/export';
import { assetMeshId } from '../../workflows/meshDisplay';
import { orderAfter } from '../../workflows/records';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';

interface Prepared {
  readonly data: MeshData;
  readonly slots: readonly AssetMaterialRef[];
  readonly report: MakeEditableReport;
  readonly name: string;
  readonly skin: number | null;
  readonly placement: MeshRecord['placement'];
}

/** The last Make editable report per app (B13's report dialog reads it). */
const reports = new WeakMap<EditorApp, { readonly mesh: MeshId; readonly report: MakeEditableReport }>();

/** The report of the app's last successful Make editable run, or null. */
export function lastMakeEditableReport(
  app: EditorApp,
): { readonly mesh: MeshId; readonly report: MakeEditableReport } | null {
  return reports.get(app) ?? null;
}

function argsProblem(args: unknown): string | null {
  if (!isRecord(args)) return 'expects { character, meshIndex }';
  if (typeof args['character'] !== 'string') return 'expects a character';
  const index = args['meshIndex'];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return 'expects a glTF mesh index ≥ 0';
  return null;
}

/** The glTF meshes of the character's model (its loaded container). */
function gltfMeshes(app: EditorApp, character: CharacterId): readonly unknown[] | null {
  const meshes = app.characters.get(character)?.container.json['meshes'];
  return Array.isArray(meshes) ? (meshes as unknown[]) : null;
}

/** Same wording as the lazy `editLicence` gate, checked here so the poll fails before anything loads. */
function licenceProblem(app: EditorApp, character: CharacterId): string | null {
  const runtime = app.characters.get(character);
  if (runtime === undefined) return null;
  let licence: ReturnType<typeof readVrmLicense>;
  try {
    licence = readVrmLicense(runtime.container);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (licence?.modification !== 'prohibited') return null;
  return "This avatar's licence does not allow modification; its meshes stay read-only (animation-only exports are still allowed)";
}

function poll(app: EditorApp, args: unknown): PollResult {
  const shape = argsProblem(args);
  if (shape !== null) return fail(shape);
  const editable = pollEditable(app);
  if (editable !== true) return editable;
  const { character: id, meshIndex } = args as { readonly character: CharacterId; readonly meshIndex: number };
  const character = app.store.get('characters', id);
  if (character === undefined) return fail('The character does not exist');
  if (!isAssetCharacter(character)) return fail('Only imported characters have glTF meshes to make editable');
  if (app.characters.get(id) === undefined) return fail(`${character.name} is still loading`);
  const meshes = gltfMeshes(app, id) ?? [];
  if (meshIndex >= meshes.length) return fail(`${character.name} has no glTF mesh ${meshIndex}`);
  if (app.store.get('meshes', assetMeshId(id, meshIndex)) !== undefined) return fail('This mesh is already editable');
  const licence = licenceProblem(app, id);
  return licence === null ? OK : fail(licence);
}

/** Placement of the record (object transform under the character root): identity for skinned meshes (glTF ignores
 *  their node transform), else the world rest transform of the first node using the mesh. */
function placementOf(json: Readonly<Record<string, unknown>>, meshIndex: number): MeshRecord['placement'] {
  const identity = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
  const nodes = Array.isArray(json['nodes']) ? (json['nodes'] as unknown[]) : [];
  const index = nodes.findIndex((node) => isRecord(node) && node['mesh'] === meshIndex);
  const node = nodes[index];
  if (!isRecord(node) || node['skin'] !== undefined) return identity;
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (isRecord(n) && Array.isArray(n['children']))
      for (const c of n['children'] as unknown[]) parentOf.set(c as number, i);
  });
  // Compose TRS up the chain (matrix nodes count as identity: rare on mesh nodes of avatars).
  let t: [number, number, number] = [0, 0, 0];
  let q: [number, number, number, number] = [0, 0, 0, 1];
  let s: [number, number, number] = [1, 1, 1];
  const chain: Readonly<Record<string, unknown>>[] = [];
  for (let i: number | undefined = index; i !== undefined; i = parentOf.get(i)) {
    const n = nodes[i];
    if (isRecord(n)) chain.unshift(n);
    if (chain.length > nodes.length) break;
  }
  for (const n of chain) {
    const nt = (Array.isArray(n['translation']) ? n['translation'] : [0, 0, 0]) as number[];
    const nq = (Array.isArray(n['rotation']) ? n['rotation'] : [0, 0, 0, 1]) as number[];
    const ns = (Array.isArray(n['scale']) ? n['scale'] : [1, 1, 1]) as number[];
    const scaled: [number, number, number] = [(nt[0] ?? 0) * s[0], (nt[1] ?? 0) * s[1], (nt[2] ?? 0) * s[2]];
    const rotated = rotate(q, scaled);
    t = [t[0] + rotated[0], t[1] + rotated[1], t[2] + rotated[2]];
    q = multiply(q, [nq[0] ?? 0, nq[1] ?? 0, nq[2] ?? 0, nq[3] ?? 1]);
    s = [s[0] * (ns[0] ?? 1), s[1] * (ns[1] ?? 1), s[2] * (ns[2] ?? 1)];
  }
  return { t, q, s };
}

function multiply(a: readonly number[], b: readonly number[]): [number, number, number, number] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotate(q: readonly number[], v: readonly number[]): [number, number, number] {
  const p = multiply(multiply(q, [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, 0]), [
    -(q[0] ?? 0),
    -(q[1] ?? 0),
    -(q[2] ?? 0),
    q[3] ?? 1,
  ]);
  return [p[0], p[1], p[2]];
}

/** A unique record name among the owner's live meshes (≤ 64 characters; ' 2', ' 3' … on a clash). */
function uniqueName(app: EditorApp, character: CharacterId, wanted: string): string {
  const taken = new Set(app.store.query.meshesOfOwner(character).map((record) => record.name));
  const base = (wanted.trim() === '' ? 'Mesh' : wanted.trim()).slice(0, 60);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

const makeEditable = defineOperator<'mesh.makeEditable', Prepared>({
  id: 'mesh.makeEditable',
  label: 'Make Editable',
  description: "Turns a character's glTF mesh into an editable mesh record.",
  category: 'mesh',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true },
  extraArgs: ['character', 'meshIndex'],
  undoLabel: () => 'Make Editable',
  poll: ({ app }, args) => poll(app, args),
  async prepare({ app }, args) {
    const runtime = app.characters.get(args.character);
    if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
    app.session.setState({ busy: { label: 'Making the mesh editable…', progress: null } });
    try {
      await loadMeshKernel();
      const io = await (await loadWritePath()).loadMeshIo();
      const result = await io.meshFromGltf(runtime.container, args.meshIndex);
      if ('refused' in result) throw new EkzaError(result.code, result.reason);
      const json = runtime.container.json;
      const mesh = (json['meshes'] as unknown[])[args.meshIndex];
      const name = isRecord(mesh) && typeof mesh['name'] === 'string' ? mesh['name'] : `Mesh ${args.meshIndex}`;
      const nodes = Array.isArray(json['nodes']) ? (json['nodes'] as unknown[]) : [];
      const skinned = nodes.find(
        (node) => isRecord(node) && node['mesh'] === args.meshIndex && typeof node['skin'] === 'number',
      );
      return {
        data: result.data,
        slots: result.slots,
        report: result.report,
        name,
        skin: isRecord(skinned) ? (skinned['skin'] as number) : null,
        placement: placementOf(json, args.meshIndex),
      };
    } finally {
      if (app.session.getState().busy?.label === 'Making the mesh editable…') app.session.setState({ busy: null });
    }
  },
  apply({ app, tx }, args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'mesh.makeEditable runs in a transaction');
    const character = app.store.get('characters', args.character);
    if (character === undefined || !isAssetCharacter(character)) {
      throw new EkzaError('unsupported', 'The character does not exist');
    }
    const id = assetMeshId(character.id, args.meshIndex);
    if (tx.get('meshes', id) !== undefined) throw new EkzaError('unsupported', 'This mesh is already editable');
    const record: MeshRecord = {
      id,
      name: uniqueName(app, character.id, prepared.name),
      owner: { character: character.id },
      parent: null,
      order: orderAfter(app.store.query.meshesOfOwner(character.id).map((mesh) => mesh.order)),
      placement: prepared.placement,
      pivot: [0, 0, 0],
      source: { asset: character.asset, mesh: args.meshIndex },
      data: null,
      faceted: false,
      generator: null,
      palette: null,
      material: { assetSlots: prepared.slots.map((slot) => ({ asset: character.asset, material: slot.material })) },
      colourOutput: 'palette-texture',
      skin: prepared.skin === null ? null : { asset: character.asset, skin: prepared.skin },
      budget: null,
      handheld: null,
      deleted: null,
    };
    tx.put('meshes', record);
    app.meshes.writeData(tx, id, prepared.data);
    reports.set(app, { mesh: id, report: prepared.report });
    return { mesh: id, report: prepared.report };
  },
});

export const MAKE_EDITABLE_OPERATORS: readonly AnyOperator[] = [makeEditable];
