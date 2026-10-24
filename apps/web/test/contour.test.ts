// The DEV contour of the hosted editor (studio.dev.ekza.io): NEXT_PUBLIC_EKZA_CONTOUR=dev marks it, anything else is
// the production editor with its metadata unchanged.
import { describe, expect, it } from 'vitest';
import { isDevContour, rootMetadata } from '../app/contour';

describe('editor contour', () => {
  it('is dev only for the exact value "dev"', () => {
    expect(isDevContour('dev')).toBe(true);
    for (const value of [undefined, '', 'prod', 'production', 'DEV', 'dev ', '1'])
      expect(isDevContour(value)).toBe(false);
  });

  it('keeps the production metadata', () => {
    const production = rootMetadata(false);
    expect(production.title).toEqual({ default: 'Ekza Studio', template: '%s · Ekza Studio' });
    expect(production.description).toContain('glTF and VRM');
    expect(Object.keys(production).sort()).toEqual(['description', 'title']);
  });

  it('marks the DEV copy in titles and asks robots not to index it', () => {
    const dev = rootMetadata(true);
    expect(dev.title).toEqual({ default: 'DEV · Ekza Studio', template: 'DEV · %s · Ekza Studio' });
    expect(dev.robots).toEqual({ index: false, follow: false });
  });
});
