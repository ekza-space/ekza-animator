// CHARACTER-CONTRACT-SPEC §11 P-4 (C-pre): the local test kit stages a VRM as OMOBA's `convert_vrm_to_glb.py` does —
// a VRM 1.0 resting toward +Z gets its scene roots turned 180° about Y and `asset.extras.omoba_rest_yaw180`, the BIN
// chunk untouched; a second pass leaves it alone (idempotent, like OMOBA's helper); VRM 0.x and non-GLB bytes stay byte
// for byte; the kit's README says so.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseGlbSync } from '../../src/glb/parse';
import { assembleGlb } from '../../src/glb/write';
import { OMOBA_FACING_MARKER, packOmobaKit, stageVrmForOmoba } from '../../src/omoba';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));

type Node = { rotation?: number[]; translation?: number[]; children?: number[] };

describe('stageVrmForOmoba', { timeout: 120_000 }, () => {
  it('turns a +Z VRM 1.0 (Seed-san) to rest facing −Z and records it; a second pass changes nothing', () => {
    const source = fixture('seed-san.vrm');
    const staged = stageVrmForOmoba(source);
    expect(staged.turned).toBe(true);
    const before = parseGlbSync(source);
    const after = parseGlbSync(staged.bytes);
    expect(after.bin).toEqual(before.bin);
    expect((after.json.asset as { extras?: Record<string, unknown> }).extras?.[OMOBA_FACING_MARKER]).toBe(true);
    const nodes = after.json.nodes as Node[];
    const original = before.json.nodes as Node[];
    const children = new Set(nodes.flatMap((node) => node.children ?? []));
    nodes.forEach((node, index) => {
      if (children.has(index)) {
        expect(node).toEqual(original[index]);
        return;
      }
      // a root: Y·q (an identity rotation becomes the 180° yaw) and (−x, y, −z)
      const [x, y, z, w] = original[index]?.rotation ?? [0, 0, 0, 1];
      const turned = node.rotation ?? [];
      const expected = [z, w, -x, -y];
      turned.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, 6));
      const t = original[index]?.translation;
      if (t !== undefined)
        expect(node.translation).toEqual(
          [0 - (t[0] as number), t[1], 0 - (t[2] as number)].map((v) => (v === 0 ? 0 : v)),
        );
    });
    const again = stageVrmForOmoba(staged.bytes);
    expect(again.turned).toBe(false);
    expect(again.bytes).toBe(staged.bytes);
  });

  it('leaves VRM 0.x (Polybot) and bytes that are no VRM unchanged', () => {
    const polybot = fixture('polybot.vrm');
    expect(stageVrmForOmoba(polybot)).toEqual({ bytes: polybot, turned: false });
    const junk = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stageVrmForOmoba(junk).turned).toBe(false);
  });

  it('the kit holds the staged file and its README says how it was staged', () => {
    // a small VRM 1.0 (Seed-san's JSON without its buffers): zipping the 10 MB fixture is slow
    const seed = parseGlbSync(fixture('seed-san.vrm'));
    const vrm = assembleGlb(JSON.stringify({ ...seed.json, buffers: [], bufferViews: [], accessors: [] }), null);
    const meta = { displayName: 'Seed-san', authors: ['Tester'], license: 'CC0' };
    const files = unzipSync(packOmobaKit({ vrm, thumbnail: null, meta }));
    expect(files['seed-san.glb']).toEqual(stageVrmForOmoba(vrm).bytes);
    expect(stageVrmForOmoba(vrm).turned).toBe(true);
    const readme = new TextDecoder().decode(files['README.txt']);
    expect(readme).toContain('staged as OMOBA’s local import does');
    expect(readme).toContain('asset.extras.omoba_rest_yaw180');
  });
});
