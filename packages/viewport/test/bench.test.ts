// Budget report (ARCHITECTURE §14, MVP-SPEC §7 WP-5 DoD): CPU time per frame of playback with 4 panes and one VRM
// (Seed-san, 10.9 MB). Recorded, never a pass/fail gate. Until the io/three VRM loader lands (WP-4) the model is
// loaded with three's GLTFLoader and added to the viewport scene directly (meshes and skinning, no VRM runtime); the
// pose and control lines come from the fake app's synthetic rig.
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { LAYER } from '../src/layers';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

describe('playback budget (report)', () => {
  it('records CPU ms per frame for 4 panes × 1 VRM during playback', async ({ annotate }) => {
    rig = await createRig();
    rig.layout('quad');
    const base64 = await commands.readFile('../../fixtures/models/seed-san.vrm', 'base64');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
    let meshes = 0;
    gltf.scene.traverse((object) => {
      if ((object as Mesh).isMesh !== true) return;
      object.layers.set(LAYER.mesh);
      object.frustumCulled = false;
      meshes++;
    });
    rig.vm.scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    rig.app.session.setState({ time: { ...rig.app.session.getState().time, playing: true } });
    rig.frame();

    const samples: number[] = [];
    for (let i = 0; i < 140; i++) {
      const start = performance.now();
      rig.app.session.setState({ time: { ...rig.app.session.getState().time, sceneFrame: i % 30 } });
      rig.frame();
      const elapsed = performance.now() - start;
      if (i >= 20) samples.push(elapsed);
      // Let the GPU drain between frames, as the browser would at 30 fps.
      if (i % 10 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? Number.NaN;
    const report = `4 panes × Seed-san (${meshes} meshes), playback: mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms CPU/frame (budget ≤ 8 ms)`;
    console.warn(report);
    await annotate(report, 'budget');
    expect(rig.vm.renderedFrames).toBeGreaterThanOrEqual(140);
  });
});
