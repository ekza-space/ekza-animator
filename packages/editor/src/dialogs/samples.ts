// Bundled samples and their credits (ADR 0012; fixtures/LICENSES.md). Shown in the Open dialog and in About.
import type { SampleId } from '@ekza-animator/editor-core';

export interface SampleInfo {
  readonly id: SampleId;
  readonly title: string;
  readonly kind: string;
  readonly credit: string;
  readonly license: string;
  readonly licenseUrl: string;
}

export const SAMPLES: readonly SampleInfo[] = [
  {
    id: 'seed-san',
    title: 'Seed-san',
    kind: 'VRM 1.0 avatar',
    credit: '"Seed-san" model by VirtualCast, Inc.',
    license: 'VRM Public License 1.0',
    licenseUrl: 'https://vrm.dev/en/licenses/1.0/index',
  },
  {
    id: 'polybot',
    title: 'Polybot',
    kind: 'VRM 0.x avatar',
    credit: '"Polybot" by Polygonal Mind (100Avatars)',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    id: 'quaternius-ual',
    title: 'Universal Animation Library',
    kind: 'glTF with 46 clips',
    credit: 'Universal Animation Library by Quaternius',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
];

/** Version shown in About; the integration agent sets it when tagging (v0.1.0 = M1 alpha). */
export const EDITOR_VERSION = '0.1.0-dev';
