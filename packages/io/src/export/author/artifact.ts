// A static-model export as an `ExportArtifact` (M6A-SPEC §6.2 `file.exportModel`; B8): the author writer's bytes, the
// mesh-level lints (budgets, Mesh Check, palette, provenance), the byte-level lints of the profile, and a read-back
// that parses the written file again: every mesh's triangle count, indices in range, finite positions, and every
// palette-textured vertex sampling the centre of a live swatch cell. The host adds its glTF-Validator report.
import { unzlibSync } from 'fflate';
import { parseGlbSync } from '../../glb/parse';
import { GltfReader } from '../../gltf/accessor';
import { bufferViewsOf, isIndex, isRecord, type JsonRecord, meshesOf, unknownList } from '../../gltf/schema';
import { sha256Hex } from '../../hash/sha256';
import { lintExport } from '../../lint/lintExport';
import type { MeshLintInput } from '../../lint/meshes';
import type { ExportArtifact, ExportProfileDef, LintIssue, ReadBackReport, StaticNode, StaticScene } from '../../types';
import { writeStaticGlb } from './index';

export interface StaticExportOptions {
  readonly fileName: string;
  readonly profile: ExportProfileDef | null;
  readonly generator: string;
  /** Inputs of the mesh-level lints (records the scene does not carry: budgets, palettes, sources). */
  readonly meshes?: readonly MeshLintInput[];
  readonly aiGenerated?: boolean;
}

export async function exportStaticModel(scene: StaticScene, opts: StaticExportOptions): Promise<ExportArtifact> {
  const bytes = await writeStaticGlb(scene, { generator: opts.generator });
  // The mesh lints use the kernel's Mesh Check: loaded with the mesh entry, never with the write path itself.
  const { lintMeshes } = await import('../../lint/meshes');
  const lints: LintIssue[] = [
    ...lintMeshes(opts.meshes ?? [], opts.profile, {
      generatorDisclosed: opts.aiGenerated !== true || scene.model.provenance.generator.kind === 'ai',
    }),
    ...(await lintExport('static-glb', bytes, opts.profile)),
  ];
  const readBack = readBackStatic(bytes, scene);
  if (!readBack.ok) {
    lints.push({
      code: 'export.read-back',
      severity: 'error',
      message: 'Read-back check failed: the written file does not reproduce the exported meshes',
    });
  }
  return {
    kind: 'static-glb',
    fileName: opts.fileName,
    mime: 'model/gltf-binary',
    bytes,
    sha256: await sha256Hex(bytes),
    lints,
    readBack,
    validation: null,
    stats: { clips: 0, channels: 0, keys: 0 },
  };
}

/** Meshes of a scene in writer order (depth first) with their triangle counts. */
function expectedMeshes(scene: StaticScene): { readonly name: string; readonly triangles: number }[] {
  const out: { name: string; triangles: number }[] = [];
  const visit = (node: StaticNode): void => {
    // n − 2 triangles per n-gon (§5.4).
    if (node.mesh !== null)
      out.push({ name: node.name, triangles: node.mesh.data.counts.corners - 2 * node.mesh.data.counts.faces });
    for (const child of node.children) visit(child);
  };
  for (const root of scene.roots) visit(root);
  return out;
}

/**
 * Static read-back (§6.2): the file parses; its meshes, in writer order, have the scene's triangle counts; every
 * index is in range and every position finite; palette-textured vertices sample a live cell at its centre.
 * `channels` counts the primitives read; `maxTranslationErrorM` is the largest distance of a palette UV from its
 * cell centre in texels (0 when exact).
 */
export function readBackStatic(bytes: Uint8Array, scene: StaticScene): ReadBackReport {
  const failed: ReadBackReport = {
    ok: false,
    animations: 0,
    channels: 0,
    maxRotationErrorRad: 0,
    maxTranslationErrorM: Number.POSITIVE_INFINITY,
  };
  let reader: GltfReader;
  let json: JsonRecord;
  try {
    const parsed = parseGlbSync(bytes);
    json = parsed.json;
    reader = new GltfReader(parsed.json, parsed.bin);
  } catch {
    return failed;
  }
  const expected = expectedMeshes(scene);
  const meshes = meshesOf(json);
  if (meshes.length !== expected.length) return failed;
  let ok = true;
  let primitives = 0;
  let worstUv = 0;
  const textures = paletteTextures(json, reader);
  try {
    meshes.forEach((mesh, m) => {
      let triangles = 0;
      for (const primitive of unknownList(mesh.primitives)) {
        if (!isRecord(primitive) || !isRecord(primitive['attributes'])) {
          ok = false;
          continue;
        }
        primitives++;
        const attributes = primitive['attributes'];
        const position = reader.readFloat(attributes['POSITION'] as number);
        if (!position.every(Number.isFinite)) ok = false;
        const count = position.length / 3;
        const indices = isIndex(primitive['indices'])
          ? reader.readUint(primitive['indices'])
          : Uint32Array.from({ length: count }, (_, i) => i);
        if (indices.some((i) => i >= count)) ok = false;
        triangles += indices.length / 3;
        const texture = isIndex(primitive['material']) ? textures.get(primitive['material']) : undefined;
        if (texture !== undefined && isIndex(attributes['TEXCOORD_0'])) {
          const uv = reader.readFloat(attributes['TEXCOORD_0']);
          for (let v = 0; v < count; v++) {
            const x = (uv[2 * v] as number) * texture.width - 0.5;
            const y = (uv[2 * v + 1] as number) * texture.height - 0.5;
            // Cell centres sit at 8k + 3.5 texels (8 px cells).
            const dx = Math.abs(x - (Math.round((x - 3.5) / 8) * 8 + 3.5));
            const dy = Math.abs(y - (Math.round((y - 3.5) / 8) * 8 + 3.5));
            worstUv = Math.max(worstUv, dx, dy);
          }
        }
      }
      if (triangles !== expected[m]?.triangles) ok = false;
    });
  } catch {
    return failed;
  }
  if (worstUv > 1e-3) ok = false;
  return { ok, animations: 0, channels: primitives, maxRotationErrorRad: 0, maxTranslationErrorM: worstUv };
}

/** Material index → size of its base colour PNG (palette textures). */
function paletteTextures(json: JsonRecord, reader: GltfReader): Map<number, { width: number; height: number }> {
  const out = new Map<number, { width: number; height: number }>();
  const textures = unknownList(json['textures']);
  const images = unknownList(json['images']);
  const views = bufferViewsOf(json);
  unknownList(json['materials']).forEach((material, m) => {
    const pbr = isRecord(material) ? material['pbrMetallicRoughness'] : undefined;
    const info = isRecord(pbr) ? pbr['baseColorTexture'] : undefined;
    const texture = isRecord(info) && isIndex(info['index']) ? textures[info['index']] : undefined;
    const image = isRecord(texture) && isIndex(texture['source']) ? images[texture['source']] : undefined;
    const view = isRecord(image) && isIndex(image['bufferView']) ? views[image['bufferView']] : undefined;
    if (view === undefined) return;
    const data = reader.buffer(view.buffer).subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const size = pngSize(data);
    if (size !== null) out.set(m, size);
  });
  return out;
}

function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24 || png[1] !== 0x50) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Decodes the palette PNG of `ekza-palette-v1` (8-bit RGB, filter 0) to RGB bytes (tests and read-back tools). */
export function decodePalettePng(png: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
} {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= png.length) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === 'IHDR') {
      width = dv.getUint32(offset + 8);
      height = dv.getUint32(offset + 12);
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let o = 0;
  for (const part of idat) {
    joined.set(part, o);
    o += part.length;
  }
  const raw = unzlibSync(joined);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    rgb.set(raw.subarray(y * (3 * width + 1) + 1, (y + 1) * (3 * width + 1)), 3 * y * width);
  return { width, height, rgb };
}
