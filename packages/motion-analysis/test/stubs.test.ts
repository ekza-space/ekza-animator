// MCP-SPEC §3 rule 1 (D0): the contract is in place and every metric is a clean `not-implemented` stub until P4.
import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import * as analysis from '../src';
import { READY } from './ready';

describe.skipIf(READY.p4)('motion-analysis stubs (D0)', () => {
  it('states the per-call limits and throws not-implemented from every metric', () => {
    expect(analysis.ANALYSIS_LIMITS).toEqual({ maxFrames: 20_000, maxBoneFrameSamples: 2_000_000 });
    const sampler = {} as analysis.MotionSampler;
    const calls: (() => unknown)[] = [
      () => analysis.detectContacts(sampler, { feet: ['L'], hands: false }),
      () => analysis.seamReport(sampler),
      () => analysis.oscillation(sampler, { bone: 'leftHand' }),
      () => analysis.pops(sampler, []),
      () => analysis.spacing(sampler, 'leftHand'),
      () => analysis.holds(sampler, []),
      () => analysis.speed(sampler, 'leftHand'),
      () => analysis.arcs(sampler, 'leftHand'),
    ];
    for (const call of calls) {
      expect(call).toThrow(EkzaError);
      expect(call).toThrow(/^motion-analysis\./);
    }
  });
});
