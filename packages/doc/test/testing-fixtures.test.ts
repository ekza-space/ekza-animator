import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import { fixturePath, type LicensedFixture, readFixture, readSyntheticFixture } from '../src/testing';

/** SHA-256 column of fixtures/LICENSES.md for a path relative to fixtures/. */
function licensedSha256(relativePath: string): string | undefined {
  const table = readFileSync(new URL('../../../fixtures/LICENSES.md', import.meta.url), 'utf8');
  const row = table.split('\n').find((line) => line.startsWith(`| \`${relativePath}\``));
  return row === undefined ? undefined : /`([0-9a-f]{64})`\s*\|\s*$/.exec(row)?.[1];
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof EkzaError ? error.code : 'not-an-EkzaError';
  }
}

describe('doc/testing fixture helpers (WP-0b)', () => {
  it('resolves licensed fixtures by name and reads their exact bytes', () => {
    expect(fixturePath('polybot.vrm')).toMatch(/fixtures[\\/]models[\\/]polybot\.vrm$/);
    expect(fixturePath('seed-san.vrm')).toMatch(/fixtures[\\/]models[\\/]seed-san\.vrm$/);
    expect(fixturePath('quaternius-ual.glb')).toMatch(/fixtures[\\/]animations[\\/]quaternius-ual\.glb$/);
    const bytes = readFixture('polybot.vrm');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(licensedSha256('models/polybot.vrm'));
  });

  it('reports unknown and absent fixtures as asset-missing', () => {
    expect(codeOf(() => fixturePath('nope.glb' as LicensedFixture))).toBe('asset-missing');
    // WP-4 adds the meshopt fixture; until then reading it fails with a clear error.
    const meshopt = fixturePath('quaternius-idle-meshopt.glb');
    expect(meshopt).toMatch(/fixtures[\\/]animations[\\/]quaternius-idle-meshopt\.glb$/);
    expect(codeOf(() => readFixture('quaternius-idle-meshopt.glb'))).toBe(existsSync(meshopt) ? null : 'asset-missing');
  });

  it('parses the synthetic fixtures', () => {
    const doc = readSyntheticFixture('wave-doc.json') as { format: string; tables: { clips: object } };
    expect(doc.format).toBe('ekza-animator-doc');
    expect(Object.keys(doc.tables.clips)).toHaveLength(1);
    const skeleton = readSyntheticFixture('humanoid-skeleton.json') as { nodes: unknown[] };
    const restPose = readSyntheticFixture('rest-pose.json') as { bones: unknown[] };
    expect(restPose.bones).toHaveLength(skeleton.nodes.length);
  });
});
