import { expect, test } from '@playwright/test';
import { createPrimitive, openModel, setMode } from './helpers/m6a-model';
import { call, expectKernelStarted, run, runOk } from './helpers/test-api';

// M6a-stretch (M6A-SPEC §1.2, §10.1 "Stretch scenarios"; owner INT): none of these items was built in M6a. Each is a
// `test.fixme` with what it is, the M6a-core fallback that ships instead and its acceptance line, so the e2e report
// lists them next to the scenarios (the M1/M2a pattern of `stretch.spec.ts`). The last test checks the fallbacks the
// test API reaches. Write the body and drop `fixme` when an item lands.

const m6aStretch = (item: string, fallback: string, acceptance: string) => ({
  annotation: {
    type: 'M6a-stretch',
    description: `${item}: not built in M6a. Fallback: ${fallback}. Acceptance: ${acceptance}`,
  },
});

const notBuilt = () => {
  throw new Error('M6a-stretch item not built');
};

const ITEMS: readonly (readonly [string, string, string, string])[] = [
  [
    'Live Mirror',
    'Live Mirror (per mesh, an evaluated mirror clipped at the seam, baked at export)',
    'Symmetry mode and Mesh › Mirror; promoted to core only under the §5.14 overrun rule (owner decision record)',
    'a half body with Live Mirror on draws and exports the whole body; editing the source side updates the mirror ' +
      'in the same frame; baking leaves the same mesh Mirror (merge) gives',
  ],
  [
    'Extrude Manifold',
    'Extrude Manifold option and the auto-weld toggle',
    'Extrude, then Merge by Distance',
    'extruding a face inward with Manifold on dissolves the coplanar walls and welds into one manifold mesh',
  ],
  [
    'Select Similar',
    'Select Similar',
    'Mesh Check "select matching", select by swatch',
    'faces with the same side count, area within 10 % and normal within 5° of the selection are added',
  ],
  [
    'lasso',
    'Lasso and paint (drag) selection',
    'the marquee; the \'drag\' selection style poll-fails "Drag selection arrives later" (checked below)',
    'a lasso around the top ring of a cylinder selects exactly its vertices; a paint stroke selects what it crosses',
  ],
  [
    'Poke',
    'Poke Face (and Chamfer Vertex, vertex extrude, interior edge extrude)',
    'the menu items are present and poll-fail "not available yet"',
    'Poke on a quad adds one vertex at its centroid and four triangles',
  ],
  [
    'edge snap C',
    'Edge snapping (C), interactive primitive placement and Shift+D duplicate with transform',
    'grid and vertex snap; creation at the origin; Mod+D then move',
    'a vertex dragged with C held lands on the nearest edge under the pointer (1e-6)',
  ],
  [
    'ramp swatches',
    'Ramp swatches and the decal region',
    'flat swatches (a ramp swatch renders flat; M6c for ramps and decals)',
    'a ramp swatch exports as a gradient across the palette cell and paints faces with its ramp',
  ],
  [
    '.gpl import',
    'Palette import/export as .gpl and .hex',
    'swatches edited in the Palette panel',
    'importing a 16-colour .gpl creates a palette with those swatches in order; exporting writes the same file',
  ],
  [
    'component pick-walk',
    'Component pick-walk (arrow keys in a component mode)',
    'arrows poll-fail "Component pick-walk arrives later" (checked below)',
    'ArrowUp on a selected loop edge selects the next edge of the loop',
  ],
  [
    'selection constraints',
    'Selection constraints other than Off (Angle, Border, Edge Loop, Edge Ring, Shell)',
    'the Toolkit shows them disabled; Ctrl+RMB convert and the walkers cover the same selections (checked below)',
    'with the Edge Loop constraint a click on one edge selects its loop',
  ],
  [
    'unequal bridge',
    'Bridge with unequal edge counts and curve (Blend) interpolation',
    'a refusal "Bridge needs the same number of edges on both sides (a vs b)"; linear only (checked below)',
    'bridging a 12-edge and an 8-edge loop gives a manifold strip with triangles distributed evenly',
  ],
  [
    'Multi-Cut across faces',
    'Multi-Cut points inside faces, the slice plane, and a cut between faces that share no face',
    'points on edges and vertices; consecutive points must share a face ("Click on each face the cut crosses")',
    'two clicks on opposite faces of a cube cut through the faces between them along the screen-space line',
  ],
  [
    'Maya Normal orientation',
    'Maya-style Normal axis orientation (each component moves along its own normal on the N handle)',
    'Component orientation (one averaged frame, §5.15)',
    'dragging N on a sphere’s face selection inflates every face along its own normal',
  ],
  [
    'Retain component spacing off',
    'Move tool Retain component spacing off (every moved vertex snaps to the grid on its own)',
    'snapping moves the pivot and keeps spacing',
    'with the option off, a grid-snapped move of a 3-vertex selection lands every vertex on a grid point',
  ],
];

for (const [name, item, fallback, acceptance] of ITEMS) {
  test.fixme(`M6a-stretch: ${name}`, m6aStretch(item, fallback, acceptance), notBuilt);
}

// The M6a-core fallbacks above that the test API reaches.
test('M6a-stretch fallbacks: drag style, constraints and pick-walk refused; unequal Bridge refused', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  expect(await run(page, 'model.selectionStyle.set', { style: 'drag' })).toMatchObject({
    status: 'cancelled',
    reason: 'Drag selection arrives later',
  });
  expect(await run(page, 'model.constraint.set', { constraint: 'loop' })).toMatchObject({
    status: 'cancelled',
    reason: 'Selection constraints arrive later',
  });
  await runOk(page, 'model.constraint.set', { constraint: 'off' });
  const cylinder = await createPrimitive(page, 'cylinder', { subdivisionsAxis: 8, subdivisionsHeight: 3 });
  await runOk(page, 'select.objects', { ids: [cylinder], mode: 'replace' });
  await setMode(page, 'edge');
  expect(await run(page, 'select.mesh.pickWalk', { direction: 'up' })).toMatchObject({
    status: 'cancelled',
    reason: 'Component pick-walk arrives later',
  });
  // An 8-edge border (the top cap deleted) and a 4-edge border (a side face deleted): unequal counts are refused.
  await setMode(page, 'face');
  const faces = await call(page, 'meshFaces', cylinder);
  const positions = (await call(page, 'meshPositions', cylinder)) as unknown as (readonly number[])[];
  const ys = positions.map((p) => p[1] ?? 0);
  const [low, high] = [Math.min(...ys), Math.max(...ys)];
  const top = faces.findIndex((verts) => verts.length === 8 && verts.every((v) => (positions[v]?.[1] ?? 0) > 0));
  // A side face of the middle band (touching neither cap): its hole is a separate 4-edge border.
  const side = faces.findIndex(
    (verts) => verts.length === 4 && verts.every((v) => (ys[v] ?? 0) > low + 1e-6 && (ys[v] ?? 0) < high - 1e-6),
  );
  await runOk(page, 'select.components', { mesh: cylinder, kind: 'face', indices: [top, side], mode: 'replace' });
  await runOk(page, 'mesh.delete', { meshes: [cylinder], kind: 'face' });
  await setMode(page, 'edge');
  const border = (await call(page, 'meshEdges', cylinder)).flatMap((edge, e) => (edge.faces === 1 ? [e] : []));
  expect(border).toHaveLength(12);
  await runOk(page, 'select.components', { mesh: cylinder, kind: 'edge', indices: border, mode: 'replace' });
  const bridge = await run(page, 'mesh.bridge', { meshes: [cylinder], kind: 'edge' });
  const reason = bridge.status === 'cancelled' ? bridge.reason : (bridge.error?.message ?? '');
  expect(reason).toMatch(/Bridge needs the same number of edges on both sides \((8 vs 4|4 vs 8)\)/);
});
