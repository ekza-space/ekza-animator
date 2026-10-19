// MCP-SPEC §3 rule 1 (D0): the contract and colours are in place; rendering is a clean `not-implemented` stub until P5.
import { EkzaError } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import { encodePng, renderPlot, renderSchematic, SCHEMATIC_COLORS } from '../src';
import { READY } from './ready';

describe.skipIf(READY.p5)('schematic-render stubs (D0)', () => {
  it('has the rig colours and throws not-implemented from every renderer', () => {
    expect(SCHEMATIC_COLORS.L).toEqual([0x4f, 0x8d, 0xff, 255]);
    expect(() => renderSchematic({ width: 1, height: 1, background: SCHEMATIC_COLORS.background, tiles: [] })).toThrow(
      EkzaError,
    );
    expect(() =>
      renderPlot({ width: 1, height: 1, rangeFrames: [0, 1], series: [], seamFrame: null, normalized: false }),
    ).toThrow(/^schematic-render\./);
    expect(() => encodePng(new Uint8Array(4), 1, 1)).toThrow(EkzaError);
  });
});
