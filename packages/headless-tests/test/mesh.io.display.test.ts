// mesh.io (M6A-SPEC §5.23; B8): the display of an edited character is its model rebuilt in memory — the Seed-san face
// edited, the rebuilt container loads through three.js + three-vrm with its MToon materials, expressions (morph
// targets) and spring bones intact, and the edited primitive in place of the original.
import { displayContainer } from '@ekza-animator/editor-core';
import { loadGltfInNode } from '@ekza-animator/io/testing';
import { describe, expect, it } from 'vitest';
import { makeEditable, splitAndCommit } from './mesh.io.support';
import { importFixture, realApp } from './ops.support';

describe('mesh.io: the display of edited characters', () => {
  it('Seed-san: the rebuilt container keeps MToon, expressions and spring bones; the edit is in place', async () => {
    const { app } = realApp({ validator: false });
    const { character, runtime } = await importFixture(app, 'seed-san.vrm');
    const mesh = await makeEditable(app, character, 2);
    expect(await displayContainer(app, runtime)).toBeNull(); // not edited yet: the model's own container
    const edited = splitAndCommit(app, mesh, 30);
    const rebuilt = await displayContainer(app, runtime);
    if (rebuilt === null) throw new Error('no rebuilt container');
    // No marker in a display container; every other extension is the original's.
    expect(rebuilt.json.asset.extras?.['ekza_animator_bake_v2']).toBeUndefined();
    expect(rebuilt.json['extensions']).toEqual(runtime.container.json['extensions']);
    const loaded = await loadGltfInNode(rebuilt.bytes);
    expect(loaded.vrm?.expressionManager?.getExpression('blink')).toBeDefined();
    expect(loaded.vrm?.springBoneManager?.joints.size ?? 0).toBeGreaterThan(0);
    let headTriangles = 0;
    let mtoon = 0;
    let morphed = 0;
    loaded.scene.traverse((object) => {
      const target = object as {
        geometry?: { index: { count: number } | null; morphAttributes: { position?: unknown[] } };
        material?: { type?: string; isMToonMaterial?: boolean } | { isMToonMaterial?: boolean }[];
        name: string;
      };
      if (target.geometry === undefined) return;
      const materials = Array.isArray(target.material) ? target.material : [target.material];
      if (materials.some((m) => m?.isMToonMaterial === true)) mtoon++;
      if ((target.geometry.morphAttributes.position?.length ?? 0) === 43) {
        morphed++;
        headTriangles += (target.geometry.index?.count ?? 0) / 3;
      }
    });
    expect(mtoon).toBeGreaterThan(0);
    expect(morphed).toBe(3); // the head's three primitives, one three.js mesh each
    expect(headTriangles).toBe(edited.counts.faces);
    app.dispose();
  });
});
