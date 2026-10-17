import { describe, expect, it } from 'vitest';
import { createPlaceholderTestApi, isE2eRequested, probeWebGl } from '../src/test-api/placeholder';

describe('placeholder e2e test API (WP-0a)', () => {
  it('installs only for e2e builds opened with ?e2e=1', () => {
    expect(isE2eRequested(true, '?e2e=1')).toBe(true);
    expect(isE2eRequested(true, '?nav=maya&e2e=1')).toBe(true);
    expect(isE2eRequested(true, '?e2e=0')).toBe(false);
    expect(isE2eRequested(false, '?e2e=1')).toBe(false);
  });

  it('resolves `ready` once the canvas settles and counts rendered frames', async () => {
    const testApi = createPlaceholderTestApi();
    expect(testApi.api.webgl).toEqual({ ok: false, renderer: null });
    testApi.settle({ ok: true, renderer: 'Test GPU' });
    await testApi.api.ready;
    expect(testApi.api.webgl).toEqual({ ok: true, renderer: 'Test GPU' });
    testApi.countFrame();
    testApi.countFrame();
    expect(testApi.api.renderedFrames()).toBe(2);
  });

  it('throws not-implemented for the parts WP-8 delivers', () => {
    const { api } = createPlaceholderTestApi();
    expect(() => api.counts()).toThrow(expect.objectContaining({ code: 'not-implemented' }));
  });

  it('finds WebGL 2 in the test browser', () => {
    expect(probeWebGl().ok).toBe(true);
  });
});
