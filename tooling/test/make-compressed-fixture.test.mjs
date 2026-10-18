import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCompressedFixture, KEEP_ANIMATION, SOURCE, TARGET } from '../make-compressed-fixture.mjs';

/** The JSON chunk of a GLB. */
function glbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

const built = buildCompressedFixture(readFileSync(SOURCE));

test('the committed compressed fixture is exactly what the generator writes', async () => {
  const bytes = await built;
  assert.ok(Buffer.compare(readFileSync(TARGET), Buffer.from(bytes)) === 0, `${TARGET} is stale: regenerate it`);
});

test(`it keeps only ${KEEP_ANIMATION}, with mesh and animation data meshopt-compressed`, async () => {
  const json = glbJson(await built);
  assert.deepEqual(
    json.animations.map((animation) => animation.name),
    [KEEP_ANIMATION],
  );
  assert.ok(json.extensionsUsed.includes('EXT_meshopt_compression'));
  const compressed = (accessor) => {
    const view = json.bufferViews[json.accessors[accessor].bufferView];
    return view?.extensions?.EXT_meshopt_compression !== undefined;
  };
  for (const sampler of json.animations[0].samplers) {
    assert.ok(compressed(sampler.input) && compressed(sampler.output), 'animation data must be compressed');
  }
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      assert.ok(compressed(primitive.attributes.POSITION), 'mesh attributes must be compressed');
    }
  }
});
