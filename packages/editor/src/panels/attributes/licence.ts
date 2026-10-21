// The character's licence badge (research 09 §10.3): what VRM meta allows, e.g.
// "Redistribution: no · Modification: prohibited". Warns when baking into the model would need an acknowledgement.
import type { ModelFormat } from '@ekza-studio/doc';
import type { VrmLicenseInfo } from '@ekza-studio/io';

export interface LicenceSummary {
  readonly title: string;
  readonly details: string | null;
  /** warn: modifying or redistributing the avatar is not allowed (export asks for an acknowledgement). */
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly credits: string | null;
}

const MODIFICATION_LABEL: Readonly<Record<NonNullable<VrmLicenseInfo['modification']>, string>> = {
  prohibited: 'prohibited',
  allowModification: 'allowed',
  allowModificationRedistribution: 'allowed, also redistributing',
};

/** `info`: undefined while the reader is unavailable, null when the file has no VRM meta. */
export function licenceSummary(format: ModelFormat, info: VrmLicenseInfo | null | undefined): LicenceSummary {
  if (info === undefined) return { title: 'Licence not read', details: null, tone: 'muted', credits: null };
  if (info === null) {
    return {
      title: format === 'gltf' ? 'No VRM licence (glTF)' : 'No licence metadata',
      details: format === 'gltf' ? 'Check the source of this model before sharing exports.' : null,
      tone: 'muted',
      credits: null,
    };
  }
  const redistribution = info.allowRedistribution === null ? 'unknown' : info.allowRedistribution ? 'yes' : 'no';
  const modification = info.modification === null ? 'unknown' : MODIFICATION_LABEL[info.modification];
  const details = [
    `Redistribution: ${redistribution}`,
    `Modification: ${modification}`,
    ...(info.commercialUsage === null ? [] : [`Commercial: ${info.commercialUsage}`]),
  ].join(' · ');
  const restricted = info.modification === 'prohibited' || info.allowRedistribution === false;
  const authors = info.authors.length === 0 ? null : info.authors.join(', ');
  const credits =
    [info.title, authors === null ? null : `by ${authors}`].filter((part): part is string => part !== null).join(' ') ||
    null;
  return {
    title: info.licenseName ?? (info.licenseUrl === null ? 'Unnamed licence' : 'Custom licence'),
    details,
    tone: restricted ? 'warn' : 'ok',
    credits: info.creditNotation === 'required' && credits !== null ? `${credits} (credit required)` : credits,
  };
}
