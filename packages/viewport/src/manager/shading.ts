// Per-pane shading of character models (M6A-SPEC §4.7, §3 rule 10; B9): `4` wireframe, `5` shaded (neutral clay),
// `6` colours (each material's base colour and texture under the scene's light rig, no material effects) and `7` lit
// (the model's own materials, today's look). One scene serves every pane, so the materials are swapped just before a
// pane renders and restored right after. Flat and backface culling apply to the shading materials (the model's own
// materials are left alone); wire on shaded draws a wireframe pass over them. The mesh-view surfaces (B6) shade
// themselves through `MeshLayerHost.applyPane`.
import type { DisplayFlags } from '@ekza-studio/editor-core';
import {
  Color,
  DoubleSide,
  FrontSide,
  LessEqualDepth,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  Texture,
} from 'three';

/** Token colours (packages/ui tokens §8.9; the viewport may not import the ui package): `--clay`, `--wire`,
 *  `--wire-wiremode`. */
export const SHADING_THEME = { clay: '#6e7179', wire: '#14151a', wireMode: '#c8ccd4' } as const;
/** Opacity of the shading materials in an x-ray pane (the model's own materials use XRAY_OPACITY in SceneSync). */
const XRAY_ALPHA = 0.5;

interface Swap {
  readonly mesh: Mesh;
  readonly material: Material | Material[];
}

/** The base colour and texture of a material, when it has them (standard, basic, Lambert, MToon, …). */
function baseOf(material: Material): { readonly color: Color | null; readonly map: Texture | null } {
  const candidate = material as { color?: unknown; map?: unknown };
  return {
    color: candidate.color instanceof Color ? candidate.color : null,
    map: candidate.map instanceof Texture ? candidate.map : null,
  };
}

export class CharacterShading {
  private readonly perMaterial = new WeakMap<Material, Map<string, Material>>();
  private readonly shared = new Map<string, Material>();
  private readonly created: Material[] = [];
  private swaps: Swap[] = [];

  /**
   * Swaps the materials of every mesh under `roots` for the pane's shading. Returns false (and swaps nothing) for
   * `lit`, which draws the model's own materials. Call `end()` after the pane's main pass.
   */
  begin(roots: readonly Object3D[], display: DisplayFlags): boolean {
    if (display.shading === 'lit') return false;
    this.swapAll(roots, (material) => this.materialFor(material, display));
    return this.swaps.length > 0;
  }

  /** Swaps every mesh under `roots` to the wire-on-shaded overlay material (a second pass after the main one). */
  beginWireOverlay(roots: readonly Object3D[]): boolean {
    const overlay = this.sharedMaterial('overlay', () => {
      const material = new MeshBasicMaterial({ color: SHADING_THEME.wire, wireframe: true, toneMapped: false });
      material.depthFunc = LessEqualDepth;
      return material;
    });
    this.swapAll(roots, (material) => (isOutline(material) ? this.hidden() : overlay));
    return this.swaps.length > 0;
  }

  /** Puts every swapped material back. */
  end(): void {
    for (const swap of this.swaps) swap.mesh.material = swap.material;
    this.swaps = [];
  }

  dispose(): void {
    this.end();
    for (const material of this.created) material.dispose();
    this.created.length = 0;
    this.shared.clear();
  }

  private swapAll(roots: readonly Object3D[], replace: (material: Material) => Material): void {
    this.end();
    for (const root of roots) {
      root.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.isMesh !== true) return;
        const original = mesh.material;
        this.swaps.push({ mesh, material: original });
        mesh.material = Array.isArray(original) ? original.map(replace) : replace(original);
      });
    }
  }

  private materialFor(original: Material, display: DisplayFlags): Material {
    if (isOutline(original)) return this.hidden(); // MToon outlines belong to the model's own look
    const xray = display.xray;
    if (display.shading === 'wire') {
      return this.sharedMaterial(`wire|${xray}`, () =>
        withXray(new MeshBasicMaterial({ color: SHADING_THEME.wireMode, wireframe: true, toneMapped: false }), xray),
      );
    }
    const side = display.cull ? FrontSide : DoubleSide;
    if (display.shading === 'shaded') {
      return this.sharedMaterial(`shaded|${display.flat}|${display.cull}|${xray}`, () =>
        withXray(new MeshLambertMaterial({ color: SHADING_THEME.clay, flatShading: display.flat, side }), xray),
      );
    }
    // colours: the material's own base colour and texture under the scene lights.
    const key = `colours|${display.flat}|${display.cull}|${xray}`;
    let variants = this.perMaterial.get(original);
    if (variants === undefined) {
      variants = new Map();
      this.perMaterial.set(original, variants);
    }
    let material = variants.get(key);
    if (material === undefined) {
      const base = baseOf(original);
      const lambert = new MeshLambertMaterial({
        color: base.color === null ? 0xffffff : base.color.clone(),
        map: base.map,
        flatShading: display.flat,
        side,
        alphaTest: original.alphaTest,
        transparent: original.transparent,
        opacity: original.opacity,
      });
      material = withXray(lambert, xray);
      variants.set(key, material);
      this.created.push(material);
    }
    return material;
  }

  private hidden(): Material {
    return this.sharedMaterial('hidden', () => new MeshBasicMaterial({ visible: false }));
  }

  private sharedMaterial(key: string, make: () => Material): Material {
    let material = this.shared.get(key);
    if (material === undefined) {
      material = make();
      this.shared.set(key, material);
      this.created.push(material);
    }
    return material;
  }
}

function isOutline(material: Material): boolean {
  return (material as { isOutline?: unknown }).isOutline === true;
}

function withXray<M extends Material>(material: M, xray: boolean): M {
  if (xray) {
    material.transparent = true;
    material.opacity *= XRAY_ALPHA;
    material.depthWrite = false;
  }
  return material;
}
