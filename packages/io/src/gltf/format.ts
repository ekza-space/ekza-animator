// Adapted from ekza-avatar-renderer/src/vrm.ts @ 33c417c (MIT, © Ekza). Changes: returns the document's
// ModelFormat ('vrm0' | 'vrm1' | 'gltf'), detects VRM 1.0 from the `VRMC_vrm` extension object instead of
// `extensionsUsed`, and rejects files that declare both VRM versions (EkzaError('vrm-both')). The VRM licence reader
// below is new code.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ModelFormat } from '@ekza-animator/doc';
import type { GlbContainer, GltfJson, VrmLicenseInfo } from '../types';
import { isRecord, type JsonRecord, rootExtensions, stringList } from './schema';

/** Classifies a parsed glTF without relying on a file extension. Throws EkzaError('vrm-both'). */
export function detectModelFormat(json: GltfJson): ModelFormat {
  const extensions = rootExtensions(json);
  const v0 = isRecord(extensions['VRM']);
  const v1 = isRecord(extensions['VRMC_vrm']);
  if (v0 && v1) {
    throw new EkzaError(
      'vrm-both',
      'The file declares both VRM 0.x (VRM) and VRM 1.0 (VRMC_vrm); it cannot be imported',
    );
  }
  return v0 ? 'vrm0' : v1 ? 'vrm1' : 'gltf';
}

/** VRM 1.0 licence document URL prefix (VRM Public License 1.0). */
const VRM_PL_1 = /^https?:\/\/vrm\.dev\/licenses\/1\.0\/?/i;

/** VRM 0.x `meta.licenseName` → SPDX-like identifier (DerivedFrom.license). */
const VRM0_LICENSES: Readonly<Record<string, string>> = {
  CC0: 'CC0-1.0',
  CC_BY: 'CC-BY-4.0',
  CC_BY_NC: 'CC-BY-NC-4.0',
  CC_BY_SA: 'CC-BY-SA-4.0',
  CC_BY_NC_SA: 'CC-BY-NC-SA-4.0',
  CC_BY_ND: 'CC-BY-ND-4.0',
  CC_BY_NC_ND: 'CC-BY-NC-ND-4.0',
  Redistribution_Prohibited: 'proprietary',
  Other: 'unknown',
};

/** VRM licence meta (FR-IO-09) of a VRM 0.x or 1.0 file; null for plain glTF. */
export function readVrmLicense(c: GlbContainer): VrmLicenseInfo | null {
  const format = detectModelFormat(c.json);
  const extensions = rootExtensions(c.json);
  if (format === 'vrm1') {
    const vrm = extensions['VRMC_vrm'] as JsonRecord;
    return vrm1License(isRecord(vrm['meta']) ? vrm['meta'] : {});
  }
  if (format === 'vrm0') {
    const vrm = extensions['VRM'] as JsonRecord;
    return vrm0License(isRecord(vrm['meta']) ? vrm['meta'] : {});
  }
  return null;
}

function vrm1License(meta: JsonRecord): VrmLicenseInfo {
  const licenseUrl = text(meta['licenseUrl']);
  const modification = meta['modification'];
  const credit = meta['creditNotation'];
  return {
    title: text(meta['name']),
    authors: stringList(meta['authors']).filter((a) => a.trim() !== ''),
    licenseUrl,
    allowRedistribution: typeof meta['allowRedistribution'] === 'boolean' ? meta['allowRedistribution'] : null,
    modification:
      modification === 'prohibited' ||
      modification === 'allowModification' ||
      modification === 'allowModificationRedistribution'
        ? modification
        : null,
    commercialUsage: text(meta['commercialUsage']),
    creditNotation: credit === 'required' || credit === 'unnecessary' ? credit : null,
    licenseName: licenseUrl !== null && VRM_PL_1.test(licenseUrl) ? 'LicenseRef-VRM-PL-1.0' : null,
  };
}

function vrm0License(meta: JsonRecord): VrmLicenseInfo {
  const license = text(meta['licenseName']);
  const spdx = license === null ? null : (VRM0_LICENSES[license] ?? 'unknown');
  const isCc = license !== null && license.startsWith('CC');
  const noDerivatives = license === 'CC_BY_ND' || license === 'CC_BY_NC_ND';
  const author = text(meta['author']);
  return {
    title: text(meta['title']),
    authors: author === null ? [] : [author],
    licenseUrl: text(meta['otherLicenseUrl']),
    allowRedistribution: isCc ? true : license === 'Redistribution_Prohibited' ? false : null,
    modification: isCc ? (noDerivatives ? 'prohibited' : 'allowModificationRedistribution') : null,
    commercialUsage: text(meta['commercialUssageName']),
    creditNotation: license === 'CC0' ? 'unnecessary' : isCc ? 'required' : null,
    licenseName: spdx,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
