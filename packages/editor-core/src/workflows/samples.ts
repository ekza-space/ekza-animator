// Bundled samples (ADR 0012): served by the web app from `/samples/<file>` (apps/web/scripts/copy-assets.mjs) and
// credited in fixtures/LICENSES.md. Their licences are known, so imported clips carry them as provenance.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SampleId } from '../operators/args';
import type { KnownLicense } from './provenance';

/**
 * Version written into project manifests, autosave slots and export metadata (`provenance.toolVersion`, the
 * `asset.generator` 'Ekza Studio <version>'). The M2a line is 0.2.x: files with schema-2 IK features must not
 * claim the M1 alpha (acceptance fix round 1). The release tag stays the owner's call.
 */
export const EDITOR_VERSION = '0.2.0';

export interface SampleDef {
  readonly id: SampleId;
  readonly file: string;
  readonly license: KnownLicense;
  /** Embedded clip imported by default (by name); null imports none unless the caller picks clips. */
  readonly defaultClip: string | null;
}

export const SAMPLES: Readonly<Record<SampleId, SampleDef>> = {
  'seed-san': {
    id: 'seed-san',
    file: 'seed-san.vrm',
    license: {
      title: 'Seed-san',
      author: 'VirtualCast, Inc.',
      license: 'LicenseRef-VRM-PL-1.0',
      redistributable: 'yes',
    },
    defaultClip: null,
  },
  polybot: {
    id: 'polybot',
    file: 'polybot.vrm',
    license: { title: 'Polybot', author: 'Polygonal Mind', license: 'CC0-1.0', redistributable: 'yes' },
    defaultClip: null,
  },
  'quaternius-ual': {
    id: 'quaternius-ual',
    file: 'quaternius-ual.glb',
    license: {
      title: 'Universal Animation Library',
      author: 'Quaternius',
      license: 'CC0-1.0',
      redistributable: 'yes',
    },
    defaultClip: 'Idle_Loop',
  },
};

/** Where the web app serves the samples (relative to the page origin). */
export const SAMPLE_BASE_URL = '/samples/';

export function isSampleId(value: unknown): value is SampleId {
  return typeof value === 'string' && Object.hasOwn(SAMPLES, value);
}

/** Downloads a sample's bytes (`fetch` of `<base>/<file>`, base `EditorServices.samplesPath` or `/samples/`). */
export async function fetchSample(sample: SampleDef, base: string = SAMPLE_BASE_URL): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`${base.endsWith('/') ? base : `${base}/`}${sample.file}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EkzaError('asset-missing', `The sample ${sample.file} could not be downloaded: ${message}`);
  }
  if (!response.ok) {
    throw new EkzaError('asset-missing', `The sample ${sample.file} could not be downloaded (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
