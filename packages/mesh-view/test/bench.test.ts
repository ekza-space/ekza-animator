// Budget report (M6A-SPEC §5.27, §9 B6): entering component mode on a 50k-triangle mesh (edit links, caches, overlays,
// BVH) ≤ 40 ms, a hover pick ≤ 0.5 ms, a 10k-vertex marquee with occlusion ≤ 16 ms, idle 0 frames (by construction: the
// views never schedule a frame; view.test.ts checks it). Also recorded, without a budget: the marquee with another
// mesh around it as an occluder (M6A-B6-22), and a pane switch between two face isolate sets (M6A-B6-23). Recorded,
// never a pass/fail gate (report-only like ARCHITECTURE §14); `apps/web/e2e/bench/m6a-mesh-view.bench.ts` re-measures
// the path through the editor once B10 wires component mode. Until B1 lands, edit links, triangulation and normals are
// B0a's reference kernel.
import {
  BitSet,
  computeNormals,
  editMeshFrom,
  type MeshData,
  primitive,
  selectionOf,
  triangulate,
} from '@ekza-animator/mesh-core';
import { afterEach, describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { ComponentPicker, EditMeshView, MeshSurface } from '../src';
import type { PickOptions } from '../src/types';
import { type Canvas, canvas, DISPLAY, IDENTITY, LAYERS, matrixOf, perspective, prng, THEME } from './support';

const CAMERA_BASED: PickOptions = { cameraBased: true, backfaces: false, hidden: null };

/** A wavy 158 × 158 quad grid: 24,964 quads = 49,928 triangles (research 13 §8.1's workload). */
function wavyGrid(): MeshData {
  const data = primitive('plane', { width: 10, height: 10, subdivisionsWidth: 158, subdivisionsHeight: 158 });
  const position = data.position.slice();
  for (let v = 0; v < data.counts.points; v++) {
    const x = position[3 * v] as number;
    const z = position[3 * v + 2] as number;
    position[3 * v + 1] = Math.fround(0.25 * Math.sin(x * 1.3) * Math.cos(z * 0.9));
  }
  return { ...data, position };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN;
}

let c: Canvas | null = null;
afterEach(() => {
  c?.dispose();
  c = null;
});

describe('mesh-view budgets (report)', () => {
  it('records enter component mode, hover and marquee at 50k triangles', async ({ annotate }) => {
    c = canvas(1200, 800);
    const data = wavyGrid();
    const camera = perspective([0, 7, 9], 1200 / 800, 45);
    const view_ = { w: 1200, h: 800 } as const;
    const enter: { total: number; kernel: number; view: number; bvh: number }[] = [];
    let triangles = 0;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      const mesh = editMeshFrom(data);
      const tri = triangulate(mesh);
      const normals = computeNormals(mesh);
      const t1 = performance.now();
      const view = new EditMeshView({ theme: THEME, layers: LAYERS });
      view.setMesh(mesh, tri, normals);
      view.setState(selectionOf('face', [], mesh.counts), null, null, null);
      c.scene.add(view.root);
      view.applyPane(DISPLAY);
      c.render(camera);
      c.pixel(1, 1); // waits for the GPU work of the first frame (uploads included)
      const t2 = performance.now();
      const picker = new ComponentPicker();
      picker.setMesh(mesh, tri, IDENTITY, true);
      picker.prepareBvh(null);
      const t3 = performance.now();
      enter.push({ total: t3 - t0, kernel: t1 - t0, view: t2 - t1, bvh: t3 - t2 });
      triangles = tri.triFace.length;
      view.dispose();
      picker.dispose();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    expect(triangles).toBe(49_928);

    // Hover: 1,000 picks per kind at random pointers, warm (projection cached for the camera) and after a camera move.
    const mesh = editMeshFrom(data);
    const tri = triangulate(mesh);
    const picker = new ComponentPicker();
    picker.setMesh(mesh, tri, IDENTITY, true);
    picker.prepareBvh(null);
    const random = prng(42);
    const hover: Record<string, number[]> = { vertex: [], edge: [], face: [] };
    let hits = 0;
    for (const kind of ['vertex', 'edge', 'face'] as const) {
      for (let i = 0; i < 1000; i++) {
        const ndc: [number, number] = [random() * 1.6 - 0.8, random() * 1.6 - 0.8];
        const start = performance.now();
        const hit = picker.hover(camera, ndc, view_, kind, CAMERA_BASED);
        (hover[kind] as number[]).push(performance.now() - start);
        if (hit !== null) hits++;
      }
    }
    const moved: number[] = [];
    for (let i = 0; i < 50; i++) {
      camera.position.x = Math.sin(i) * 0.5;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const start = performance.now();
      picker.hover(camera, [0.1, 0.1], view_, 'vertex', CAMERA_BASED);
      moved.push(performance.now() - start);
    }
    expect(hits).toBeGreaterThan(1500);

    // Marquee: a rectangle holding about 10k vertices, occlusion on.
    camera.position.set(0, 7, 9);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const rect = { x0: 300, y0: 200, x1: 900, y1: 600 };
    const marquee: number[] = [];
    let selected = 0;
    for (let run = 0; run < 7; run++) {
      // A fresh picker state per run would re-project; the camera stays, so runs after the first reuse the projection
      // like consecutive marquee drags in one pane.
      const start = performance.now();
      selected = picker.marquee(camera, rect, view_, 'vertex', CAMERA_BASED).length;
      marquee.push(performance.now() - start);
    }
    expect(selected).toBeGreaterThan(5000);

    // The same marquee with a second 50k-triangle mesh (a MeshSurface) 1 m above the right half of the grid, between
    // the camera and about half the candidates: every candidate the grid itself does not hide is also cast through it.
    const neighbour = new MeshSurface({ theme: THEME, layers: LAYERS });
    neighbour.setData(data, tri, computeNormals(mesh), null);
    neighbour.setWorld(matrixOf(new Matrix4().makeTranslation(5, 1, 0)));
    picker.setOccluder(neighbour);
    const occluded: number[] = [];
    let behind = 0;
    for (let run = 0; run < 7; run++) {
      const start = performance.now();
      behind = picker.marquee(camera, rect, view_, 'vertex', CAMERA_BASED).length;
      occluded.push(performance.now() - start);
    }
    picker.setOccluder(null);
    neighbour.dispose();
    expect(behind).toBeLessThan(selected);
    expect(behind).toBeGreaterThan(selected / 4);

    // A pane switch between two face isolate sets (one pane isolates half the faces, another none): the view
    // re-derives visibility, rewrites the index and every state and uploads them; the picker rebuilds its BVH.
    const switchView = new EditMeshView({ theme: THEME, layers: LAYERS });
    switchView.setMesh(mesh, tri, computeNormals(mesh));
    switchView.setState(selectionOf('face', [], mesh.counts), null, null, null);
    c.scene.add(switchView.root);
    switchView.applyPane(DISPLAY);
    c.render(camera);
    c.pixel(1, 1);
    const half = new BitSet(mesh.counts.faces);
    for (let f = 0; f < mesh.counts.faces; f += 2) half.add(f);
    const isolateCpu: number[] = [];
    const isolateFrame: number[] = [];
    const isolateBvh: number[] = [];
    for (let run = 0; run < 6; run++) {
      const set = run % 2 === 0 ? half : null;
      const t0 = performance.now();
      switchView.setIsolate(set);
      const t1 = performance.now();
      switchView.applyPane(DISPLAY);
      c.render(camera);
      c.pixel(1, 1);
      const t2 = performance.now();
      picker.setIsolate(set);
      picker.prepareBvh(null);
      const t3 = performance.now();
      isolateCpu.push(t1 - t0);
      isolateFrame.push(t2 - t1);
      isolateBvh.push(t3 - t2);
    }
    switchView.dispose();
    picker.setIsolate(null);

    const lines = [
      `enter component mode, 50k tris (median of 5): ${median(enter.map((e) => e.total)).toFixed(1)} ms total ` +
        `(kernel edit links + triangulation + normals ${median(enter.map((e) => e.kernel)).toFixed(1)} ms [B0a reference], ` +
        `overlays + first frame ${median(enter.map((e) => e.view)).toFixed(1)} ms, BVH ${median(enter.map((e) => e.bvh)).toFixed(1)} ms; budget ≤ 40 ms)`,
      ...(['vertex', 'edge', 'face'] as const).map(
        (kind) =>
          `hover ${kind}: mean ${((hover[kind] as number[]).reduce((a, b) => a + b, 0) / 1000).toFixed(3)} ms, ` +
          `p95 ${p95(hover[kind] as number[]).toFixed(3)} ms (budget ≤ 0.5 ms)`,
      ),
      `hover vertex after a camera move (re-projection): median ${median(moved).toFixed(3)} ms, p95 ${p95(moved).toFixed(3)} ms`,
      `marquee ${selected} vertices with occlusion: first ${(marquee[0] as number).toFixed(1)} ms, median ${median(marquee).toFixed(1)} ms (budget 10k ≤ 16 ms)`,
      `marquee with a 50k-tri neighbour as occluder (${behind} of ${selected} left): first ${(occluded[0] as number).toFixed(1)} ms ` +
        `(incl. the neighbour's BVH build), median ${median(occluded).toFixed(1)} ms (no budget; M6A-B6-22)`,
      `pane switch between face isolate sets: setIsolate ${median(isolateCpu).toFixed(1)} ms + frame with uploads ` +
        `${median(isolateFrame).toFixed(1)} ms, picker BVH rebuild ${median(isolateBvh).toFixed(1)} ms (medians of 6; no budget; M6A-B6-23)`,
    ];
    for (const line of lines) {
      console.warn(line);
      await annotate(line, 'budget');
    }
    picker.dispose();
  });
});
