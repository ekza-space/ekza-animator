import type { Metadata } from 'next';

/**
 * Deployment contour, inlined at build time. `NEXT_PUBLIC_EKZA_CONTOUR=dev` marks the DEV copy of the hosted editor
 * (studio.dev.ekza.io, next to the DEV Hub on hub.dev.ekza.io): a visible DEV badge and robots noindex. Unset (or any
 * other value) is the production editor, unchanged.
 */
export function isDevContour(value: string | undefined = process.env.NEXT_PUBLIC_EKZA_CONTOUR): boolean {
  return value === 'dev';
}

const DESCRIPTION =
  'Open-source, browser-based 3D studio for glTF and VRM characters: modeling, rigging and animation with a professional DCC-grade workflow.';

/** The root metadata of a contour: the DEV copy prefixes titles with `DEV ·` and asks robots not to index it. */
export function rootMetadata(dev: boolean): Metadata {
  return dev
    ? {
        title: { default: 'DEV · Ekza Studio', template: 'DEV · %s · Ekza Studio' },
        description: DESCRIPTION,
        robots: { index: false, follow: false },
      }
    : {
        title: { default: 'Ekza Studio', template: '%s · Ekza Studio' },
        description: DESCRIPTION,
      };
}
