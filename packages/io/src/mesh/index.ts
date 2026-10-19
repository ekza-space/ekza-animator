// `@ekza-animator/io/mesh` (M6A-SPEC §4.5, §2): the lazy mesh entry of io — make editable, `meshToPrimitives` and the
// palette PNG writer. It may import the mesh-core kernel; the io main entry gains types only, so the eager route never
// pulls mesh-core through io. B0a stubs (`EkzaError('not-implemented', 'io.<symbol>')`); B8 owns this directory.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetMaterialRef, ColourOutput } from '@ekza-animator/doc';
import type { MeshData } from '@ekza-animator/mesh-core';
import type { GlbContainer, MakeEditableRefusal, MakeEditableReport, PaletteTexture, PrimitiveOut } from '../types';

const notImplemented = (symbol: string): EkzaError => new EkzaError('not-implemented', `io.${symbol}`);

/** Decodes the glTF mesh's primitives (Draco/meshopt through `decode`, injected in the browser), concatenates them
 *  (face material = primitive index → slot), welds (§5.21), recovers hard edges, keeps custom normals and layers. */
export function meshFromGltf(
  _container: GlbContainer,
  _meshIndex: number,
  _opts?: {
    readonly decode?: (container: GlbContainer, meshIndex: number) => Promise<GlbContainer>;
    readonly maxTriangles?: number;
  },
): Promise<
  | { readonly data: MeshData; readonly slots: readonly AssetMaterialRef[]; readonly report: MakeEditableReport }
  | MakeEditableRefusal
> {
  return Promise.reject(notImplemented('meshFromGltf'));
}

/** VRM meta gate (Q-SKIN-2): `modification: 'prohibited'` (VRM 1.0) or the VRM 0.x equivalent refuses. */
export function editLicence(
  _container: GlbContainer,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  throw notImplemented('editLicence');
}

export function meshToPrimitives(
  _data: MeshData,
  _opts: {
    readonly colourOutput: ColourOutput | 'asset';
    readonly palette: PaletteTexture | null;
    readonly paint: ReadonlyMap<number, readonly [number, number, number]> | null;
    readonly morphNormals: ReadonlySet<string>;
    readonly hadTangents: boolean;
    readonly dropTangents: boolean;
  },
):
  | { readonly primitives: readonly PrimitiveOut[]; readonly materialsUsed: readonly number[] }
  | { readonly refused: true; readonly code: 'tangents'; readonly reason: string } {
  throw notImplemented('meshToPrimitives');
}

export function writePaletteTexture(
  _swatches: readonly { readonly slot: number; readonly srgb: readonly [number, number, number] }[],
): PaletteTexture {
  throw notImplemented('writePaletteTexture');
}
