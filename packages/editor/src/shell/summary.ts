// Summary of a dropped model for the import dialog (research 09 §10.2): format, size, scene counts, embedded clips
// and the VRM licence. JSON only (io's GLB container, format detection and licence reader); clip import itself is
// file.importModel's job.
import type { ModelFormat } from '@ekza-animator/doc';
import { detectModelFormat, type GltfJson, parseGlb, readVrmLicense, type VrmLicenseInfo } from '@ekza-animator/io';

export interface ModelClipSummary {
  /** glTF animation index (the import dialog's `import-clip-<index>`). */
  readonly index: number;
  readonly name: string;
  readonly channels: number;
  /** Seconds from the samplers' input accessor `max`, when the file states it. */
  readonly duration: number | null;
}

export interface ModelSummary {
  readonly format: ModelFormat;
  readonly formatLabel: string;
  readonly byteLength: number;
  readonly meshes: number;
  readonly nodes: number;
  readonly skins: number;
  readonly clips: readonly ModelClipSummary[];
  readonly license: VrmLicenseInfo | null;
  readonly licenseLabel: string;
  /** Redistribution or modification is forbidden by the VRM meta (baking into the model needs an acknowledgement). */
  readonly restricted: boolean;
  readonly warnings: readonly string[];
}

export type Summarizer = (bytes: Uint8Array) => Promise<ModelSummary>;

export const FORMAT_LABEL: Readonly<Record<ModelFormat, string>> = {
  vrm0: 'VRM 0.x',
  vrm1: 'VRM 1.0',
  gltf: 'glTF 2.0',
};

const arrayOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Clips listed in `json.animations` with channel counts and durations (input accessor `max`). */
export function clipSummaries(json: GltfJson): ModelClipSummary[] {
  const accessors = arrayOf(json['accessors']);
  return arrayOf(json['animations']).map((raw, index) => {
    const animation = recordOf(raw);
    const samplers = arrayOf(animation['samplers']).map(recordOf);
    let duration: number | null = null;
    for (const sampler of samplers) {
      const input = sampler['input'];
      const accessor = typeof input === 'number' ? recordOf(accessors[input]) : {};
      const max = arrayOf(accessor['max'])[0];
      if (typeof max === 'number' && Number.isFinite(max)) duration = Math.max(duration ?? 0, max);
    }
    const name =
      typeof animation['name'] === 'string' && animation['name'] !== '' ? animation['name'] : `Animation ${index}`;
    return { index, name, channels: arrayOf(animation['channels']).length, duration };
  });
}

export function licenseLabel(license: VrmLicenseInfo | null, format: ModelFormat): string {
  if (license === null) return format === 'gltf' ? 'No licence metadata' : 'Licence unknown';
  return license.licenseName ?? (license.licenseUrl === null ? 'Licence unknown' : 'Custom licence');
}

export function isRestricted(license: VrmLicenseInfo | null): boolean {
  return license !== null && (license.modification === 'prohibited' || license.allowRedistribution === false);
}

/** Reads the summary with @ekza-animator/io (throws io's EkzaError codes, e.g. 'not-glb', 'vrm-both'). */
export const summarizeModel: Summarizer = async (bytes) => {
  const container = await parseGlb(bytes);
  const format = detectModelFormat(container.json);
  const license = format === 'gltf' ? null : readVrmLicense(container);
  const json = container.json;
  const warnings: string[] = [];
  const used = arrayOf(json['extensionsUsed']).filter((ext): ext is string => typeof ext === 'string');
  if (used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression')) {
    warnings.push('Compressed meshes are decoded for display; compressed animation data cannot be edited.');
  }
  if (arrayOf(json['skins']).length === 0) warnings.push('No skin: the model has no skeleton to animate.');
  return {
    format,
    formatLabel: FORMAT_LABEL[format],
    byteLength: bytes.byteLength,
    meshes: arrayOf(json['meshes']).length,
    nodes: arrayOf(json['nodes']).length,
    skins: arrayOf(json['skins']).length,
    clips: clipSummaries(json),
    license,
    licenseLabel: licenseLabel(license, format),
    restricted: isRestricted(license),
    warnings,
  };
};

/** "12.4 MB" style size for dialogs. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
