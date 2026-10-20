// The shaded surface of a mesh (research 13 §7.1): one GPU vertex per corner (position, corner normal, palette colour,
// state byte, soft weight; the flat display takes each triangle's plane in the shader), indexed by the one
// triangulation (§5.4) so
// what is drawn is what ships. Invisible faces (hidden, isolated out) become degenerate triangles, which keeps every
// face's index range stable for incremental updates. Three materials share the geometry: opaque (pushed back by a
// polygon offset so overlays win the depth test), transparent (x-ray, dimmed) and a depth-only pre-pass for x-ray.
import type { Normals, Triangulation } from '@ekza-animator/mesh-core';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  type IUniform,
  Mesh,
  type Object3D,
  ShaderMaterial,
  type Side,
} from 'three';
import { MESH_VIEW_STYLE, ORDER } from '../style';
import type { MeshViewThemeInput } from '../theme';
import { DEFAULT_MESH_VIEW_THEME } from '../theme';
import { addRange, Touched, tracked, uploadAll } from './ranges';
import { DEPTH_FRAGMENT, DEPTH_VERTEX, SURFACE_FRAGMENT, SURFACE_VERTEX } from './shaders';
import type { Topo } from './topo';

export type SurfaceShading = 'wire' | 'shaded' | 'colours' | 'lit';

/** What `SurfaceLayer.apply` takes per pane (the views pass one reused object: it runs before every pane render). */
export interface SurfaceDisplay {
  shading: SurfaceShading;
  flat: boolean;
  cull: boolean;
  faceOrientation: boolean;
  opacity: number;
  xray: boolean;
}

export class SurfaceLayer {
  readonly mesh: Mesh;
  readonly depth: Mesh;
  readonly uniforms: Record<string, IUniform>;
  private readonly opaque: ShaderMaterial;
  private readonly transparent: ShaderMaterial;
  private readonly depthMaterial: ShaderMaterial;
  private geometry = new BufferGeometry();
  private position = new BufferAttribute(new Float32Array(0), 3);
  private normal = new BufferAttribute(new Float32Array(0), 3);
  private paint = new BufferAttribute(new Uint8Array(0), 3, true);
  private state = new BufferAttribute(new Uint8Array(0), 1);
  private soft = new BufferAttribute(new Uint8Array(0), 1, true);
  private index = new BufferAttribute(new Uint32Array(0), 1);
  private readonly corners = new Touched(0);
  private readonly clayBytes: readonly [number, number, number];
  private hasPaint = false;

  constructor(theme: MeshViewThemeInput, layer: number) {
    const clay = theme.clay ?? DEFAULT_MESH_VIEW_THEME.clay;
    this.clayBytes = [(clay >> 16) & 255, (clay >> 8) & 255, clay & 255];
    this.uniforms = {
      uPaint: { value: false },
      uClay: { value: new Color(clay) },
      uFlat: { value: false },
      uFaceOrientation: { value: false },
      uFront: { value: new Color(theme.faceFront) },
      uBack: { value: new Color(theme.faceBack) },
      uSelected: { value: new Color(theme.selected) },
      uHover: { value: new Color(theme.hover) },
      uSelectedTint: { value: MESH_VIEW_STYLE.faceSelectedTint },
      uHoverTint: { value: MESH_VIEW_STYLE.faceHoverTint },
      uMirroredMix: { value: MESH_VIEW_STYLE.mirroredMix },
      uSoftTint: { value: MESH_VIEW_STYLE.softTint },
      uSoft: { value: theme.soft.map((c) => new Color(c)) },
      uOpacity: { value: 1 },
    };
    const surface = (transparent: boolean): ShaderMaterial =>
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SURFACE_VERTEX,
        fragmentShader: SURFACE_FRAGMENT,
        side: DoubleSide,
        transparent,
        depthWrite: !transparent,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        toneMapped: false,
      });
    this.opaque = surface(false);
    this.transparent = surface(true);
    this.depthMaterial = new ShaderMaterial({
      vertexShader: DEPTH_VERTEX,
      fragmentShader: DEPTH_FRAGMENT,
      side: DoubleSide,
      colorWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.mesh = this.object(this.opaque, layer, ORDER.surface);
    this.depth = this.object(this.depthMaterial, layer, ORDER.xrayDepth);
    this.depth.visible = false;
  }

  private object(material: ShaderMaterial, layer: number, order: number): Mesh {
    const mesh = new Mesh(this.geometry, material);
    mesh.layers.set(layer);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    return mesh;
  }

  addTo(parent: Object3D): void {
    parent.add(this.depth, this.mesh);
  }

  /** Full rebuild for a topology: every attribute and the index. */
  build(
    t: Topo,
    position: ArrayLike<number>,
    tri: Triangulation,
    normals: Normals,
    faceVisible: Uint8Array | null,
  ): void {
    const C = t.corners;
    const old = this.geometry;
    const geometry = new BufferGeometry();
    this.position = tracked(new BufferAttribute(new Float32Array(3 * C), 3));
    this.normal = tracked(new BufferAttribute(new Float32Array(3 * C), 3));
    this.paint = tracked(new BufferAttribute(new Uint8Array(3 * C), 3, true));
    this.state = tracked(new BufferAttribute(new Uint8Array(C), 1));
    this.soft = tracked(new BufferAttribute(new Uint8Array(C), 1, true));
    this.index = tracked(new BufferAttribute(new Uint32Array(tri.tris.length), 1));
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('paint', this.paint);
    geometry.setAttribute('state', this.state);
    geometry.setAttribute('soft', this.soft);
    geometry.setIndex(this.index);
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    this.depth.geometry = geometry;
    old.dispose();
    this.corners.resize(C);
    const p = this.position.array as Float32Array;
    for (let c = 0; c < C; c++) {
      const v = 3 * (t.cv[c] as number);
      p[3 * c] = position[v] as number;
      p[3 * c + 1] = position[v + 1] as number;
      p[3 * c + 2] = position[v + 2] as number;
    }
    this.writeNormals(t, normals, null);
    this.writeIndex(tri, faceVisible, null);
    this.fillPaint(this.clayBytes);
  }

  /** Corner positions of the given vertices' corners (`cornersOf` CSR) or all. */
  updatePositions(
    t: Topo,
    position: ArrayLike<number>,
    points: Uint32Array | 'all',
    cornersOf: { readonly start: Uint32Array; readonly items: Uint32Array },
  ): void {
    const p = this.position.array as Float32Array;
    if (points === 'all') {
      for (let c = 0; c < t.corners; c++) {
        const v = 3 * (t.cv[c] as number);
        p[3 * c] = position[v] as number;
        p[3 * c + 1] = position[v + 1] as number;
        p[3 * c + 2] = position[v + 2] as number;
      }
      uploadAll(this.position);
      return;
    }
    for (let k = 0; k < points.length; k++) {
      const v = points[k] as number;
      if (v >= t.points) continue;
      for (let i = cornersOf.start[v] as number; i < (cornersOf.start[v + 1] as number); i++) {
        const c = cornersOf.items[i] as number;
        p[3 * c] = position[3 * v] as number;
        p[3 * c + 1] = position[3 * v + 1] as number;
        p[3 * c + 2] = position[3 * v + 2] as number;
        this.corners.add(c);
      }
    }
    this.corners.flush([this.position]);
  }

  /** Corner normals of every corner, or of the corners of `faces`. */
  writeNormals(t: Topo, normals: Normals, faces: Uint32Array | null): void {
    const n = this.normal.array as Float32Array;
    if (faces === null) {
      n.set(normals.corner.length === 3 * t.corners ? normals.corner : normals.corner.subarray(0, 3 * t.corners));
      uploadAll(this.normal);
      return;
    }
    for (let k = 0; k < faces.length; k++) {
      const f = faces[k] as number;
      if (f >= t.faces) continue;
      for (let i = t.fstart[f] as number; i < (t.fstart[f + 1] as number); i++) {
        const c = t.fcorners[i] as number;
        n[3 * c] = normals.corner[3 * c] as number;
        n[3 * c + 1] = normals.corner[3 * c + 1] as number;
        n[3 * c + 2] = normals.corner[3 * c + 2] as number;
        this.corners.add(c);
      }
    }
    this.corners.flush([this.normal]);
  }

  /** The index from the triangulation; triangles of invisible faces collapse onto their first corner. */
  writeIndex(tri: Triangulation, faceVisible: Uint8Array | null, faces: Uint32Array | null): void {
    const index = this.index.array as Uint32Array;
    const writeFace = (f: number): void => {
      const from = 3 * (tri.faceTriStart[f] as number);
      const to = 3 * (tri.faceTriStart[f + 1] as number);
      const shown = faceVisible === null || faceVisible[f] === 1;
      const first = tri.tris[from] as number;
      for (let i = from; i < to; i++) index[i] = shown ? (tri.tris[i] as number) : first;
    };
    if (faces === null) {
      const F = tri.faceTriStart.length - 1;
      for (let f = 0; f < F; f++) writeFace(f);
      uploadAll(this.index);
      return;
    }
    let min = Number.POSITIVE_INFINITY;
    let max = -1;
    for (let k = 0; k < faces.length; k++) {
      const f = faces[k] as number;
      if (f + 1 >= tri.faceTriStart.length) continue;
      writeFace(f);
      min = Math.min(min, 3 * (tri.faceTriStart[f] as number));
      max = Math.max(max, 3 * (tri.faceTriStart[f + 1] as number));
    }
    if (max > min) addRange(this.index, min, max - min);
  }

  /** Face states (STATE bits per face) onto their corners. */
  writeFaceStates(t: Topo, faceState: Uint8Array, faces: readonly number[] | null): void {
    const s = this.state.array as Uint8Array;
    const write = (f: number): void => {
      const value = faceState[f] as number;
      for (let i = t.fstart[f] as number; i < (t.fstart[f + 1] as number); i++) {
        const c = t.fcorners[i] as number;
        if (s[c] === value) continue;
        s[c] = value;
        this.corners.add(c);
      }
    };
    if (faces === null) {
      for (let f = 0; f < t.faces; f++) write(f);
    } else {
      for (const f of faces) if (f >= 0 && f < t.faces) write(f);
    }
    this.corners.flush([this.state]);
  }

  /** Soft-selection weights per vertex (0…1) onto the corners; null clears them. */
  writeSoft(t: Topo, weights: Float32Array | null): void {
    const s = this.soft.array as Uint8Array;
    if (weights === null) s.fill(0);
    else {
      for (let c = 0; c < t.corners; c++) {
        const w = weights[t.cv[c] as number] ?? 0;
        s[c] = w > 0 ? Math.max(1, Math.round(Math.min(1, w) * 255)) : 0;
      }
    }
    uploadAll(this.soft);
  }

  /** Palette colours per face (slot → sRGB bytes); faces whose slot has no colour show clay. null = clay. */
  writePaint(
    t: Topo,
    slots: ArrayLike<number> | null,
    colours: ReadonlyMap<number, readonly [number, number, number]> | null,
  ): void {
    this.hasPaint = colours !== null;
    (this.uniforms['uPaint'] as IUniform<boolean>).value = this.hasPaint;
    if (colours === null) {
      this.fillPaint(this.clayBytes);
      return;
    }
    const out = this.paint.array as Uint8Array;
    for (let f = 0; f < t.faces; f++) {
      const rgb = colours.get(slots === null ? 0 : (slots[f] ?? 0)) ?? this.clayBytes;
      for (let i = t.fstart[f] as number; i < (t.fstart[f + 1] as number); i++) {
        const c = 3 * (t.fcorners[i] as number);
        out[c] = rgb[0];
        out[c + 1] = rgb[1];
        out[c + 2] = rgb[2];
      }
    }
    uploadAll(this.paint);
    this.touch();
  }

  private fillPaint(rgb: readonly [number, number, number]): void {
    const out = this.paint.array as Uint8Array;
    for (let i = 0; i < out.length; i += 3) {
      out[i] = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
    }
    uploadAll(this.paint);
    this.touch();
  }

  /**
   * Per-pane display: `wire` hides the surface; `shaded` draws clay; `colours`/`lit` the palette colours (`lit` has no
   * other material here: mesh-view draws the palette under the same rig, M6A-B6-3). `opacity` < 1 draws it
   * transparent; `xray` adds the depth pre-pass the overlays' occluded pass tests against.
   */
  apply(opts: Readonly<SurfaceDisplay>): void {
    const u = this.uniforms;
    (u['uPaint'] as IUniform<boolean>).value = this.hasPaint && opts.shading !== 'shaded';
    (u['uFlat'] as IUniform<boolean>).value = opts.flat;
    (u['uFaceOrientation'] as IUniform<boolean>).value = opts.faceOrientation;
    (u['uOpacity'] as IUniform<number>).value = opts.opacity;
    const side: Side = opts.cull && !opts.faceOrientation ? FrontSide : DoubleSide;
    const transparent = opts.opacity < 1;
    const material = transparent ? this.transparent : this.opaque;
    if (material.side !== side) {
      material.side = side;
      material.needsUpdate = true;
    }
    this.depthMaterial.side = side;
    this.mesh.material = material;
    this.mesh.renderOrder = transparent ? ORDER.surfaceTransparent : ORDER.surface;
    const drawn = opts.shading !== 'wire';
    this.mesh.visible = drawn;
    // A transparent surface (x-ray, dimmed) draws its nearest layer only: the depth pre-pass keeps its own back
    // layers out, and the overlays' occluded pass tests against it.
    this.depth.visible = drawn && (opts.xray || transparent);
    this.touch();
  }

  private touch(): void {
    this.opaque.uniformsNeedUpdate = true;
    this.transparent.uniformsNeedUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.opaque.dispose();
    this.transparent.dispose();
    this.depthMaterial.dispose();
    this.mesh.removeFromParent();
    this.depth.removeFromParent();
  }
}
