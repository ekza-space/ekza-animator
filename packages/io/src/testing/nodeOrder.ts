// Node-order helpers of the shared test kit (MVP-SPEC §7 WP-0b). The order itself is `skeletonNodeOrder` from
// io/src/skeleton/order.ts, the same function `skeletonFromGltf` uses (DECISIONS-OPEN B-16).
import { EkzaError } from '@ekza-studio/anim-core';
import type { GltfNodesJson } from '../skeleton/order';

export { type GltfNodesJson, skeletonNodeOrder } from '../skeleton/order';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** Parses the JSON chunk of a GLB (header checks only; the full reader is `parseGlb`). */
export function readGlbJson(bytes: Uint8Array): GltfNodesJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new EkzaError('not-glb', 'Not a glTF 2.0 binary (GLB) file');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > bytes.byteLength) {
    throw new EkzaError('malformed-gltf', 'The GLB does not start with a JSON chunk');
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfNodesJson;
}
