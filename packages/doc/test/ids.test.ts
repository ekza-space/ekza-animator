import { afterEach, describe, expect, it } from 'vitest';
import {
  controlId,
  EkzaError,
  type IdKind,
  type IdSource,
  newId,
  type RigId,
  seededIdSource,
  setDefaultIdSource,
} from '../src';

const FORMAT: Readonly<Record<IdKind, RegExp>> = {
  character: /^chr_[0-9A-Za-z]{16}$/,
  rig: /^rig_[0-9A-Za-z]{16}$/,
  constraint: /^cns_[0-9A-Za-z]{16}$/,
  solver: /^slv_[0-9A-Za-z]{16}$/,
  camera: /^cam_[0-9A-Za-z]{16}$/,
  clip: /^clp_[0-9A-Za-z]{16}$/,
  layer: /^lay_[0-9A-Za-z]{16}$/,
  curve: /^crv_[0-9A-Za-z]{16}$/,
  key: /^k_[0-9A-Za-z]{12}$/,
  tx: /^tx_[0-9A-Za-z]{16}$/,
  // M6a (M6A-SPEC §3 rule 3)
  mesh: /^msh_[0-9A-Za-z]{16}$/,
  group: /^grp_[0-9A-Za-z]{16}$/,
  palette: /^pal_[0-9A-Za-z]{16}$/,
  swatch: /^sw_[0-9A-Za-z]{16}$/,
  imagePlane: /^img_[0-9A-Za-z]{16}$/,
  skeleton: /^skl_[0-9A-Za-z]{16}$/,
  joint: /^jnt_[0-9A-Za-z]{16}$/,
};

afterEach(() => setDefaultIdSource(null));

describe('newId', () => {
  it.each(Object.keys(FORMAT) as IdKind[])('formats %s IDs as <prefix><base62>', (kind) => {
    for (let n = 0; n < 50; n++) expect(newId(kind)).toMatch(FORMAT[kind]);
  });

  it('is unique in practice with the crypto source', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId('key')));
    expect(ids.size).toBe(10_000);
  });

  it('is deterministic for a seeded source', () => {
    const a = seededIdSource(42);
    const b = seededIdSource(42);
    const sequenceA = [newId('clip', a), newId('key', a), newId('curve', a)];
    const sequenceB = [newId('clip', b), newId('key', b), newId('curve', b)];
    expect(sequenceA).toEqual(sequenceB);
    expect(newId('clip', seededIdSource(43))).not.toBe(sequenceA[0]);
  });

  it('uses the default source set by setDefaultIdSource until it is reset', () => {
    setDefaultIdSource(seededIdSource(1));
    const first = [newId('character'), newId('rig')];
    setDefaultIdSource(seededIdSource(1));
    expect([newId('character'), newId('rig')]).toEqual(first);
    setDefaultIdSource(null);
    expect(newId('character')).not.toBe(first[0]);
  });

  it('rejects biased bytes so every base62 character stays equally likely', () => {
    // A source that always returns 255 then 0: 255 ≥ 248 must be skipped, 0 maps to '0'.
    let calls = 0;
    const source: IdSource = {
      randomBytes: (n) => {
        calls++;
        return Uint8Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 255 : 0));
      },
    };
    expect(newId('key', source)).toBe('k_000000000000');
    expect(calls).toBeGreaterThan(1);
  });

  it('spreads characters evenly for a seeded source', () => {
    const source = seededIdSource(7);
    const counts = new Map<string, number>();
    for (let n = 0; n < 4000; n++) {
      for (const ch of newId('clip', source).slice(4)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);
    const expected = (4000 * 16) / 62;
    for (const count of counts.values()) expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
  });

  it('throws EkzaError for an unknown kind', () => {
    expect(() => newId('bogus' as IdKind)).toThrow(EkzaError);
  });
});

describe('controlId', () => {
  it('joins the rig ID and the template key', () => {
    const rig = newId('rig', seededIdSource(3));
    expect(controlId(rig, 'fk.upperArm.L')).toBe(`${rig}:fk.upperArm.L`);
  });

  it('rejects an empty template key', () => {
    expect(() => controlId('rig_x' as RigId, '')).toThrow(expect.objectContaining({ code: 'invalid-record' }));
  });
});

describe('seededIdSource', () => {
  it('produces the requested number of bytes', () => {
    expect(seededIdSource(9).randomBytes(37)).toHaveLength(37);
  });

  it('rejects non-finite seeds', () => {
    expect(() => seededIdSource(Number.NaN)).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });
});
