// The intake operators' bodies (MODELING-PLAN §7.2 G-a), a lazy module: `prepare` builds the job from the document —
// the targets' current revisions, world matrices, base colours (decoded textures) or palette colours — runs it in the
// intake worker and, for texture downsizing, writes the re-encoded model asset to the asset store; `apply` writes the
// result in the run's one transaction: new revisions (`writeData`), placements made identity in world after a
// normalize (non-target children compensated), the baked palette and its swatches, the meshes' colour fields and, for
// `mesh.intake {bytes}`, the imported records themselves (one undo step for import and intake).
import { mat4Compose, type ReadonlyXf, xfIdentity, xfMultiply } from '@ekza-studio/anim-core';
import {
  type AssetId,
  type AssetRecord,
  derivedId,
  fractionalIndex,
  type MeshId,
  type MeshMaterial,
  type MeshRecord,
  type PaletteId,
  type ReadView,
  SWATCH_SHADER_DEFAULTS,
  type SwatchRecord,
  type Tx,
} from '@ekza-studio/doc';
import type { CharacterAssetMaterial } from '@ekza-studio/io';
import type {
  BaseColourSource,
  IntakeJob,
  IntakeMeshIn,
  IntakeResult,
  IntakeStep,
  NormalizeArgs,
  ReduceArgs,
  RgbaImage,
  SignedAxis,
} from '@ekza-studio/mesh-wasm';
import { worldPlacement } from '../mesh/context';
import { loadMeshKernel } from '../mesh/kernel';
import { localFromWorld } from '../mesh/records';
import { runSeed } from '../mesh/seed';
import type { IntakeOperatorId } from '../operators/builtin/intake';
import { lastOrder, swatchIdFor } from '../operators/builtin/palette';
import type * as CharacterModuleType from '../operators/builtin/rig/character';
import type { ImportPlan } from '../operators/builtin/rig/character';
import type { ApplyContext, EditorApp, MeshRuntimeRegistry, OperatorContext } from '../types';
import { loadWritePath } from '../workflows/export';
import { runIntake } from './client';
import { loadMeshWasm, type MeshWasm } from './load';
import {
  DECIMATE_FIRST_MAX,
  INTAKE_BUDGETS,
  INTAKE_HEIGHTS,
  type IntakeArgs,
  type IntakeOutcome,
  type IntakePreset,
} from './types';

type WritePath = Awaited<ReturnType<typeof loadWritePath>>;
type CharacterModule = typeof CharacterModuleType;

const UNITS: Readonly<Record<string, number>> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };
const AXES = new Set<string>(['+x', '-x', '+y', '-y', '+z', '-z']);
const PRESETS = new Set<string>(['prop', 'character', 'hero']);

/** What `prepare` hands to `apply`. */
export interface IntakePrepared {
  readonly targets: readonly MeshId[];
  /** `mesh.intake {bytes}`: the import plan and the module that writes it. */
  readonly imported: { readonly plan: ImportPlan; readonly character: CharacterModule } | null;
  readonly result: IntakeResult | null;
  readonly worker: boolean;
  /** Texture downsize: the new model asset per replaced asset. */
  readonly assets: ReadonlyMap<AssetId, AssetRecord>;
  readonly warnings: readonly string[];
  readonly downsized: boolean;
}

// ---------- args ----------

const str = (args: IntakeArgs, name: string, fallback: string, allowed?: ReadonlySet<string>): string => {
  const value = args[name];
  return typeof value === 'string' && (allowed === undefined || allowed.has(value)) ? value : fallback;
};
const num = (args: IntakeArgs, name: string, fallback: number): number => {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const nullableNum = (args: IntakeArgs, name: string): number | null => {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const bool = (args: IntakeArgs, name: string, fallback: boolean): boolean => {
  const value = args[name];
  return typeof value === 'boolean' ? value : fallback;
};

const presetOf = (args: IntakeArgs): IntakePreset => str(args, 'preset', 'character', PRESETS) as IntakePreset;

function normalizeArgs(args: IntakeArgs, height: number | null): NormalizeArgs {
  return {
    forward: str(args, 'forward', '+z', AXES) as SignedAxis,
    up: str(args, 'up', '+y', AXES) as SignedAxis,
    unit: UNITS[str(args, 'unit', 'm')] ?? 1,
    height,
    origin: str(
      args,
      'origin',
      'bottom-center',
      new Set(['bottom-center', 'center', 'keep']),
    ) as NormalizeArgs['origin'],
  };
}

function reduceArgs(args: IntakeArgs): ReduceArgs {
  const regularize = args['regularize'];
  return {
    triangles: Math.max(4, Math.floor(nullableNum(args, 'triangles') ?? INTAKE_BUDGETS[presetOf(args)])),
    uvWeight: num(args, 'uvWeight', 1),
    normalWeight: num(args, 'normalWeight', 0.5),
    lockSeams: bool(args, 'lockSeams', false),
    lockPalette: bool(args, 'lockPalette', true),
    lockBorder: bool(args, 'lockBorder', false),
    regularize: typeof regularize === 'boolean' ? regularize : null,
    prune: bool(args, 'prune', false),
    hardAngle: num(args, 'hardAngle', (60 * Math.PI) / 180),
  };
}

/** The chain of an operator. */
export function stepsOf(id: IntakeOperatorId, args: IntakeArgs): IntakeStep[] {
  const colours = Math.max(1, Math.floor(num(args, 'colours', 16)));
  switch (id) {
    case 'mesh.normalize':
      return [{ kind: 'normalize', args: normalizeArgs(args, nullableNum(args, 'height')) }];
    case 'mesh.reduce':
      return [{ kind: 'reduce', args: reduceArgs(args) }];
    case 'mesh.paletteBake':
      return [{ kind: 'paletteBake', args: { colours, samples: Math.max(1, Math.floor(num(args, 'samples', 6))) } }];
    case 'mesh.textureDownsize':
      return [];
    case 'mesh.intake': {
      const preset = presetOf(args);
      const steps: IntakeStep[] = [
        { kind: 'normalize', args: normalizeArgs(args, nullableNum(args, 'height') ?? INTAKE_HEIGHTS[preset]) },
        { kind: 'reduce', args: { ...reduceArgs(args), regularize: null } },
      ];
      if (bool(args, 'quadrangulate', true))
        steps.push({ kind: 'quadrangulate', args: { angle: (30 * Math.PI) / 180 } });
      if (str(args, 'texture', 'palette') === 'palette')
        steps.push({ kind: 'paletteBake', args: { colours, samples: 6 } });
      return steps;
    }
  }
}

// ---------- reading the document ----------

/** A mesh's current revision, waiting for its blobs when they are not resident. */
async function readyData(meshes: MeshRuntimeRegistry, record: MeshRecord) {
  await loadMeshKernel();
  const runtime = meshes.get(record.id);
  if (runtime !== undefined && runtime.state === 'loading') {
    await new Promise<void>((resolve) => {
      const off = runtime.subscribe((event) => {
        if (event.type === 'state' && event.state !== 'loading') {
          off();
          resolve();
        }
      });
      if (runtime.state !== 'loading') {
        off();
        resolve();
      }
    });
  }
  const data = runtime?.data() ?? null;
  if (data === null) throw new Error(`${record.name}: ${runtime?.error ?? 'its mesh data is not available'}`);
  return data;
}

/** The browser's image decoder (editor-core has no DOM lib: the shapes it uses). */
interface ImageDecoding {
  createImageBitmap(
    blob: unknown,
    options: Readonly<Record<string, string>>,
  ): Promise<{ readonly width: number; readonly height: number; close(): void }>;
  readonly Blob: new (parts: readonly unknown[], options: { readonly type: string }) => unknown;
  readonly OffscreenCanvas: new (
    width: number,
    height: number,
  ) => {
    getContext(kind: '2d'): {
      drawImage(image: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, w: number, h: number): { readonly data: Uint8ClampedArray };
    } | null;
  };
}

/**
 * RGBA pixels of an image: PNG by io's reader (the same bytes everywhere), other formats (JPEG, WebP) by the browser's
 * decoder without colour conversion; null where neither can read it (JPEG in Node).
 */
export async function decodeImage(write: WritePath, bytes: Uint8Array, mimeType: string): Promise<RgbaImage | null> {
  if (write.isPng(bytes)) {
    try {
      return write.decodePng(bytes);
    } catch {
      return null;
    }
  }
  const host = globalThis as unknown as Partial<ImageDecoding>;
  if (
    typeof host.createImageBitmap !== 'function' ||
    typeof host.OffscreenCanvas !== 'function' ||
    typeof host.Blob !== 'function'
  ) {
    return null;
  }
  try {
    const bitmap = await host.createImageBitmap(new host.Blob([bytes], { type: mimeType || 'image/jpeg' }), {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const context = new host.OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const image = { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(pixels.data) };
    bitmap.close();
    return image;
  } catch {
    return null;
  }
}

/** The base colours of the meshes' material slots (deduplicated by asset and material) and the slots' indices. */
async function baseColours(
  write: WritePath,
  slotsOf: readonly MeshMaterial[],
  bytesOf: (asset: AssetId) => Promise<Uint8Array | null>,
  warnings: string[],
): Promise<{ readonly sources: BaseColourSource[]; readonly materials: (number | null)[][] }> {
  const sources: BaseColourSource[] = [];
  const index = new Map<string, number | null>();
  const images = new Map<string, Promise<RgbaImage | null>>();
  const materials: (number | null)[][] = [];
  for (const material of slotsOf) {
    const out: (number | null)[] = [];
    if (!('assetSlots' in material)) {
      materials.push(out);
      continue;
    }
    for (const slot of material.assetSlots) {
      const key = `${slot.asset}:${slot.material}`;
      if (!index.has(key)) {
        const bytes = await bytesOf(slot.asset);
        let read: CharacterAssetMaterial | null = null;
        if (bytes !== null) {
          try {
            read = write.characterAssetMaterials(bytes, [slot.material], slot.asset)[0] ?? null;
          } catch {
            read = null;
          }
        }
        if (read === null) index.set(key, null);
        else {
          let texture: BaseColourSource['texture'] = null;
          const info = read.baseColorTexture;
          if (info !== null) {
            let image = images.get(info.key);
            if (image === undefined) {
              image = decodeImage(write, info.image, info.mimeType);
              images.set(info.key, image);
            }
            const decoded = await image;
            if (decoded === null) {
              warnings.push(
                `The ${info.mimeType || 'image'} texture of ${read.name} could not be read here: its colour factor is used`,
              );
            } else {
              texture = {
                image: decoded,
                texCoord: info.texCoord,
                wrapS: info.sampler.wrapS,
                wrapT: info.sampler.wrapT,
              };
            }
          }
          const factor = read.baseColorFactor;
          sources.push({ factor: [factor[0], factor[1], factor[2], factor[3]], texture });
          index.set(key, sources.length - 1);
        }
      }
      out.push(index.get(key) ?? null);
    }
    materials.push(out);
  }
  return { sources, materials };
}

/** The sRGB colour of each slot of a palette (index = slot), for a palette-coloured mesh's bake. */
function paletteColours(view: ReadView, record: MeshRecord): ([number, number, number] | null)[] | null {
  if (record.palette === null) return null;
  const out: ([number, number, number] | null)[] = [];
  for (const swatch of view.query.swatchesOfPalette(record.palette)) {
    while (out.length <= swatch.slot) out.push(null);
    out[swatch.slot] = [swatch.srgb[0], swatch.srgb[1], swatch.srgb[2]];
  }
  return out;
}

// ---------- prepare ----------

/** Builds and runs the job of `id` (see the module comment). */
export async function prepareIntake(
  ctx: OperatorContext,
  id: IntakeOperatorId,
  args: IntakeArgs,
  targets: readonly MeshId[],
): Promise<IntakePrepared> {
  const { app } = ctx;
  const [write, wasm] = await Promise.all([loadWritePath(), loadMeshWasm(), loadMeshKernel()]);
  const warnings: string[] = [];
  const steps = stepsOf(id, args);
  const needsColour = steps.some((step) => step.kind === 'paletteBake');
  const keepTexture =
    id === 'mesh.textureDownsize' || (id === 'mesh.intake' && str(args, 'texture', 'palette') === 'keep');
  const assetBytes = (asset: AssetId): Promise<Uint8Array | null> => app.services.assets.get(asset).catch(() => null);

  let imported: IntakePrepared['imported'] = null;
  let meshes: IntakeMeshIn[] = [];
  let materials: MeshMaterial[] = [];
  if (id === 'mesh.intake' && args.bytes instanceof Uint8Array) {
    // Import and intake in one step: Make editable's 200k gate is lifted, the chain's reduce decimates (Q-MOD-K-11).
    const character = await import('../operators/builtin/rig/character');
    const plan = await character.prepareImport(ctx, args, { maxTriangles: DECIMATE_FIRST_MAX });
    imported = { plan, character };
    meshes = plan.meshes.map((mesh, n) => ({
      key: `import:${n}`,
      data: mesh.data,
      world: Array.from(mat4Compose(mesh.placement)),
      skinned: false,
      materials: [],
    }));
    materials = plan.meshes.map((mesh) => ({ assetSlots: mesh.slots }));
  } else {
    for (const mesh of targets) {
      const record = app.store.get('meshes', mesh);
      if (record === undefined) throw new Error(`Unknown mesh ${mesh}`);
      const data = await readyData(app.meshes, record);
      meshes.push({
        key: record.id,
        data,
        world: Array.from(mat4Compose(worldPlacement(app.store, record))),
        skinned: record.skin !== null || data.layers.has('skin.joints'),
        materials: [],
        paint: paletteColours(app.store, record),
      });
      materials.push(record.material);
    }
  }
  let sources: BaseColourSource[] = [];
  if (needsColour) {
    const colours = await baseColours(write, materials, assetBytes, warnings);
    meshes = meshes.map((mesh, i) => ({ ...mesh, materials: colours.materials[i] ?? [] }));
    sources = colours.sources;
  }
  let result: IntakeResult | null = null;
  let worker = false;
  if (steps.length > 0) {
    const run = await runIntake(app, { meshes, sources, steps } satisfies IntakeJob);
    result = run.result;
    worker = run.worker;
    warnings.push(...result.warnings.map((warning) => warning.message));
  }
  const assets = new Map<AssetId, AssetRecord>();
  let downsized = false;
  if (keepTexture) {
    const size = Math.max(16, Math.floor(num(args, id === 'mesh.intake' ? 'textureSize' : 'size', 1024)));
    for (const material of materials) {
      if (!('assetSlots' in material)) continue;
      for (const slot of material.assetSlots) {
        if (assets.has(slot.asset)) continue;
        const record = await downsizeAsset(app, write, wasm, slot.asset, size, warnings);
        if (record !== null) {
          assets.set(slot.asset, record);
          downsized = true;
        }
      }
    }
    if (!downsized) warnings.push(`Every texture is already at most ${size} px`);
  }
  return { targets, imported, result, worker, assets, warnings, downsized };
}

/** A copy of a model asset whose images are at most `size` on their longest side (PNG), or null when none was larger. */
async function downsizeAsset(
  app: EditorApp,
  write: WritePath,
  wasm: MeshWasm,
  asset: AssetId,
  size: number,
  warnings: string[],
): Promise<AssetRecord | null> {
  const bytes = await app.services.assets.get(asset).catch(() => null);
  if (bytes === null) {
    warnings.push(`The model file ${asset.slice(0, 8)}… is not available`);
    return null;
  }
  const { parseGlb } = await import('@ekza-studio/io');
  const container = await parseGlb(bytes);
  const out = await write.rewriteImages(container, async (image) => {
    const decoded = await decodeImage(write, image.bytes, image.mimeType);
    if (decoded === null) {
      warnings.push(`Image ${image.index} (${image.mimeType || 'unknown type'}) could not be read here and was kept`);
      return null;
    }
    if (Math.max(decoded.width, decoded.height) <= size) return null;
    const small = wasm.downsample(decoded, size);
    let opaque = true;
    for (let i = 3; i < small.rgba.length; i += 4) {
      if (small.rgba[i] !== 255) {
        opaque = false;
        break;
      }
    }
    const pixels = opaque ? new Uint8Array(3 * small.width * small.height) : new Uint8Array(small.rgba);
    if (opaque) {
      for (let p = 0, q = 0; p < small.rgba.length; p += 4, q += 3) {
        pixels[q] = small.rgba[p] as number;
        pixels[q + 1] = small.rgba[p + 1] as number;
        pixels[q + 2] = small.rgba[p + 2] as number;
      }
    }
    return { bytes: write.encodePng(small.width, small.height, pixels, opaque ? 3 : 4), mimeType: 'image/png' };
  });
  if (out === null) return null;
  const source = app.store.get('assets', asset);
  const base = (source?.name ?? 'model').replace(/\.[^.]+$/, '');
  return app.services.assets.put(out, { name: `${base}-${size}.glb`, ext: 'glb', role: 'model' });
}

// ---------- apply ----------

/** Depth of a record under its mesh/group parents (parents are written first). */
function depthOf(view: ReadView, record: MeshRecord): number {
  let depth = 0;
  let parent: string | null = record.parent;
  const seen = new Set<string>();
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    depth++;
    const node: { readonly parent: string | null } | undefined = parent.startsWith('grp_')
      ? view.get('groups', parent as never)
      : view.get('meshes', parent as MeshId);
    parent = node?.parent ?? null;
  }
  return depth;
}

function uniquePaletteName(view: ReadView, base: string): string {
  const used = new Set(view.list('palettes').map((palette) => palette.name));
  const clean = base.slice(0, 64);
  if (!used.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${clean.slice(0, 64 - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** Writes the baked palette and its swatches (slot = index); returns its id. */
function putPalette(
  tx: Tx,
  colours: readonly (readonly [number, number, number])[],
  name: string,
  parents: readonly string[],
  seed: string,
): PaletteId {
  const id = derivedId('palette', 'mesh.paletteBake', parents, seed, 0);
  if (tx.getIncludingDeleted('palettes', id) === undefined) {
    tx.put('palettes', {
      id,
      name: uniquePaletteName(tx, name),
      order: fractionalIndex(lastOrder(tx.list('palettes')), null),
      deleted: null,
    });
  }
  let order: string | null = null;
  colours.forEach((srgb, slot) => {
    order = fractionalIndex(order, null);
    const swatch: SwatchRecord = {
      id: swatchIdFor(id, slot),
      palette: id,
      slot,
      order,
      name: `Colour ${slot + 1}`,
      srgb: [srgb[0], srgb[1], srgb[2]],
      kind: 'flat',
      ramp: null,
      shader: SWATCH_SHADER_DEFAULTS.shader,
      glossiness: SWATCH_SHADER_DEFAULTS.glossiness,
      specular: [...SWATCH_SHADER_DEFAULTS.specular],
      deleted: null,
    };
    if (tx.getIncludingDeleted('swatches', swatch.id) === undefined) tx.put('swatches', swatch);
  });
  return id;
}

/** The colour fields of a palette-baked mesh: palette-coloured, an authored unlit preset, paintable (no source). */
const paletteFields = (palette: PaletteId) =>
  ({ palette, material: { preset: 'unlit' }, source: null, colourOutput: 'palette-texture' }) as const;

/** Writes the prepared result (see the module comment) and returns the outcome. */
export function applyIntake(
  ctx: ApplyContext,
  id: IntakeOperatorId,
  args: IntakeArgs,
  prepared: IntakePrepared,
): IntakeOutcome {
  const { app, tx } = ctx;
  if (tx === null) throw new Error(`${id} runs in a transaction`);
  const seed = runSeed(ctx, id);
  const result = prepared.result;
  const outMeshes = result?.meshes ?? [];
  const world = outMeshes.some((mesh) => mesh.world);
  let palette: PaletteId | null = null;
  let written: MeshId[];
  if (prepared.imported !== null) {
    const { plan, character } = prepared.imported;
    if (result?.palette !== null && result?.palette !== undefined) {
      const first = plan.meshes[0]?.name ?? 'Model';
      palette = putPalette(tx, result.palette, `${first} palette`, [plan.asset.id], seed);
    }
    for (const record of prepared.assets.values())
      if (tx.get('assets', record.id) === undefined) tx.put('assets', record);
    written = character.putImportedMeshes(ctx, args.name, plan, seed, (n) => ({
      ...(outMeshes[n] === undefined ? {} : { data: outMeshes[n].data }),
      ...(world ? { placement: xfIdentity() } : {}),
      ...(palette === null ? {} : paletteFields(palette)),
      ...(prepared.assets.size === 0
        ? {}
        : {
            material: {
              assetSlots: (plan.meshes[n]?.slots ?? []).map((slot) => ({
                asset: prepared.assets.get(slot.asset)?.id ?? slot.asset,
                material: slot.material,
              })),
            },
          }),
    }));
  } else {
    written = [...prepared.targets];
    const before = new Map(prepared.targets.map((mesh) => [mesh, app.store.get('meshes', mesh)] as const));
    const worlds = new Map<string, ReadonlyXf>();
    for (const [mesh, record] of before) if (record !== undefined) worlds.set(mesh, worldPlacement(app.store, record));
    if (result?.palette !== null && result?.palette !== undefined) {
      const first = before.get(prepared.targets[0] as MeshId)?.name ?? 'Model';
      palette = putPalette(tx, result.palette, `${first} palette`, prepared.targets, seed);
    }
    for (const record of prepared.assets.values())
      if (tx.get('assets', record.id) === undefined) tx.put('assets', record);
    const order = [...prepared.targets].sort(
      (a, b) => depthOf(tx, before.get(a) as MeshRecord) - depthOf(tx, before.get(b) as MeshRecord),
    );
    for (const mesh of order) {
      const record = tx.get('meshes', mesh);
      if (record === undefined) continue;
      const out = outMeshes.find((entry) => entry.key === mesh);
      if (out !== undefined) app.meshes.writeData(tx, mesh, out.data);
      const patch: { -readonly [K in keyof MeshRecord]?: MeshRecord[K] } = {};
      if (world) {
        // Identity in world; children that are not targets keep their world placement.
        const oldWorld = worlds.get(mesh) ?? xfIdentity();
        patch.placement = localFromWorld(tx, record.owner, record.parent, xfIdentity());
        patch.pivot = [0, 0, 0];
        const owner = 'character' in record.owner ? record.owner.character : 'scene';
        for (const child of tx.query.childrenOf(mesh, owner)) {
          if (prepared.targets.includes(child.id as MeshId)) continue;
          const table = child.id.startsWith('grp_') ? 'groups' : 'meshes';
          tx.patch(table as 'meshes', child.id as MeshId, { placement: xfMultiply(oldWorld, child.placement) });
        }
      }
      if (palette !== null) Object.assign(patch, paletteFields(palette));
      if (prepared.assets.size > 0 && 'assetSlots' in record.material) {
        patch.material = {
          assetSlots: record.material.assetSlots.map((slot) => ({
            asset: prepared.assets.get(slot.asset)?.id ?? slot.asset,
            material: slot.material,
          })),
        };
      }
      if (Object.keys(patch).length > 0) tx.patch('meshes', mesh, patch);
      // Old component selections index the previous topology.
      if (out !== undefined) app.components.clear(mesh);
    }
  }
  tx.annotate({ label: INTAKE_UNDO_LABELS[id] });
  const steps = result?.steps ?? [];
  const before = steps[0]?.trianglesBefore ?? 0;
  const after = steps.at(-1)?.trianglesAfter ?? before;
  return {
    meshes: written,
    palette,
    triangles: { before, after },
    colours: result?.palette?.length ?? null,
    steps: steps.map((step) => ({ ...step, facts: { ...step.facts } })),
    warnings: prepared.warnings,
    aiMarksMayBeAltered:
      prepared.downsized || steps.some((step) => step.kind === 'reduce' || step.kind === 'paletteBake'),
    worker: prepared.worker,
    ms: result?.ms ?? 0,
  };
}

const INTAKE_UNDO_LABELS: Readonly<Record<IntakeOperatorId, string>> = {
  'mesh.normalize': 'Normalize',
  'mesh.reduce': 'Reduce',
  'mesh.paletteBake': 'Palette Bake',
  'mesh.textureDownsize': 'Downsize Textures',
  'mesh.intake': 'Intake',
};
