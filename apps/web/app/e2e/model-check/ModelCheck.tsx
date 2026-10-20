'use client';

// The e2e model check (M6A-SPEC §9 INT, E2E-MOD-15): an independent reader for the editor's static-model GLBs. It
// parses the bytes with three.js's GLTFLoader (the reference reader of the M6a export, §5.21) and reports what three
// sees: every mesh's triangles and vertices, the materials and the textures. No editor code is involved.
import { type JSX, useEffect, useState } from 'react';
import { type BufferGeometry, type Material, Mesh, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ModelCheckResult {
  readonly meshes: readonly { readonly name: string; readonly triangles: number; readonly vertices: number }[];
  /** Triangles of every mesh (indexed: index count / 3; else position count / 3). */
  readonly triangles: number;
  readonly materials: number;
  readonly textures: number;
}

export interface ModelCheckApi {
  /** Parses a GLB with three.js's GLTFLoader and reports what it read. */
  read(glb: Uint8Array): Promise<ModelCheckResult>;
}

declare global {
  interface Window {
    __EKZA_MODEL_CHECK__?: ModelCheckApi;
  }
}

function trianglesOf(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  return Math.floor((index === null ? (position?.count ?? 0) : index.count) / 3);
}

async function read(glb: Uint8Array): Promise<ModelCheckResult> {
  const gltf = await new GLTFLoader().parseAsync(glb.slice().buffer, '');
  const meshes: { name: string; triangles: number; vertices: number }[] = [];
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    meshes.push({
      name: object.name,
      triangles: trianglesOf(geometry),
      vertices: geometry.getAttribute('position')?.count ?? 0,
    });
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material as Material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value !== null && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture === true) {
          textures.add(value as Texture);
        }
      }
    }
  });
  return {
    meshes,
    triangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
    materials: materials.size,
    textures: textures.size,
  };
}

export function ModelCheck(): JSX.Element {
  const [status, setStatus] = useState('Ready');

  useEffect(() => {
    const api: ModelCheckApi = {
      async read(glb) {
        const result = await read(glb);
        setStatus(`Read ${result.meshes.length} meshes, ${result.triangles} triangles.`);
        return result;
      },
    };
    window.__EKZA_MODEL_CHECK__ = api;
    return () => {
      if (window.__EKZA_MODEL_CHECK__ === api) delete window.__EKZA_MODEL_CHECK__;
    };
  }, []);

  return (
    <main className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-2">
      <output data-testid="model-check-status">{status}</output>
    </main>
  );
}
