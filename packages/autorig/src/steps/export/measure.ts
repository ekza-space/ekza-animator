// What a written file measured (AUTORIG-SPEC §5.6.2; D6): after a download the checklist shows the file's size against
// OMOBA's 50 MiB limit with its JSON chunk, its node count against 4,096 and its humanoid bones against 64 — read from
// the artifact's bytes (the GLB header and JSON chunk) and its read-back. Pure; no io value import (§4.1).
import type { AutoRigExportResult } from '@ekza-studio/editor-core';
import { formatNumber, messages } from '../../i18n';
import type { Measured } from './labels';
import './strings';

/** A written file (`AutoRigExportResult.artifacts`; io's `ExportArtifact`). */
export type WrittenArtifact = AutoRigExportResult['artifacts'][number];

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const MIB = 1024 * 1024;

/** The JSON chunk of GLB bytes (its byte length and parsed object), or null when the bytes are not a GLB. */
export function glbJsonChunk(
  bytes: Uint8Array,
): { readonly length: number; readonly json: Readonly<Record<string, unknown>> | null } | null {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) return null;
  const length = view.getUint32(12, true);
  if (length > bytes.byteLength - 20) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    return {
      length,
      json:
        typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null,
    };
  } catch {
    return { length, json: null };
  }
}

/** A byte count in MiB (one decimal) or KiB. */
export function formatBytes(bytes: number): string {
  if (bytes >= MIB / 10)
    return `${formatNumber(bytes / MIB, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MiB`;
  return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), { maximumFractionDigits: 0 })} KiB`;
}

/** The size of a saved file for the footer (`0.4 MiB`, `61 KiB`). */
export const fileSize = (bytes: number): string => formatBytes(bytes);

/** The humanoid bones of a VRM 1.0 / 0.x JSON. */
function humanoidBones(json: Readonly<Record<string, unknown>>): number | null {
  const extensions = json['extensions'];
  if (typeof extensions !== 'object' || extensions === null) return null;
  const vrmc = (extensions as Record<string, unknown>)['VRMC_vrm'];
  if (typeof vrmc === 'object' && vrmc !== null) {
    const bones = ((vrmc as Record<string, unknown>)['humanoid'] as Record<string, unknown> | undefined)?.[
      'humanBones'
    ];
    if (typeof bones === 'object' && bones !== null) return Object.keys(bones).length;
  }
  const vrm0 = (extensions as Record<string, unknown>)['VRM'];
  if (typeof vrm0 === 'object' && vrm0 !== null) {
    const bones = ((vrm0 as Record<string, unknown>)['humanoid'] as Record<string, unknown> | undefined)?.[
      'humanBones'
    ];
    if (Array.isArray(bones)) return bones.length;
  }
  return null;
}

/** The measures of a written VRM or GLB (null for files that are not a GLB, e.g. a zip). */
export function measureArtifact(artifact: Pick<WrittenArtifact, 'bytes' | 'readBack'>): Measured | null {
  const chunk = glbJsonChunk(artifact.bytes);
  if (chunk === null) return null;
  const m = messages().export;
  const nodes = Array.isArray(chunk.json?.['nodes']) ? (chunk.json['nodes'] as unknown[]).length : null;
  const readBack = artifact.readBack as { readonly humanoid?: unknown } | null;
  const bones =
    typeof readBack?.humanoid === 'number' && readBack.humanoid > 0
      ? readBack.humanoid
      : chunk.json === null
        ? null
        : humanoidBones(chunk.json);
  return {
    size: m.measuredSize(formatBytes(artifact.bytes.byteLength), formatBytes(chunk.length)),
    nodes: nodes === null ? null : m.measuredNodes(formatNumber(nodes, { maximumFractionDigits: 0 })),
    bones: bones === null ? null : m.measuredBones(bones),
  };
}
