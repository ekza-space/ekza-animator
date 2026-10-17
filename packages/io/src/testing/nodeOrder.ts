// SkeletonDesc node order (shared test kit, MVP-SPEC §7 WP-0b). `SkeletonDesc.nodes` lists every glTF node in
// topological order; the canonical order is Kahn's algorithm that always emits the smallest ready glTF index, so a
// file whose nodes are already parent-first keeps its glTF order. `skeletonFromGltf` (WP-4) must produce this order.
import { EkzaError } from '@ekza-animator/anim-core';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** Minimal glTF JSON view used by the test kit. */
export interface GltfNodesJson {
  readonly nodes?: readonly { readonly children?: readonly number[] }[];
}

/** Parses the JSON chunk of a GLB (header checks only; the full reader is WP-4's `parseGlb`). */
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

/** glTF node index for every SkeletonDesc node index (parents before children, smallest ready index first). */
export function skeletonNodeOrder(json: GltfNodesJson): number[] {
  const nodes = json.nodes ?? [];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (child < 0 || child >= nodes.length || child === index || parent[child] !== -1) {
        throw new EkzaError('malformed-gltf', `Node ${child} has an invalid or second parent (node ${index})`);
      }
      parent[child] = index;
    }
  });
  const ready = new MinHeap();
  parent.forEach((p, index) => {
    if (p === -1) ready.push(index);
  });
  const order: number[] = [];
  while (ready.size > 0) {
    const index = ready.pop();
    order.push(index);
    for (const child of nodes[index]?.children ?? []) ready.push(child);
  }
  if (order.length !== nodes.length) throw new EkzaError('malformed-gltf', 'The node hierarchy has a cycle');
  return order;
}

class MinHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if ((items[up] as number) <= value) break;
      items[i] = items[up] as number;
      i = up;
    }
    items[i] = value;
  }

  pop(): number {
    const items = this.items;
    const top = items[0] as number;
    const last = items.pop() as number;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= items.length) break;
        const right = left + 1;
        const child = right < items.length && (items[right] as number) < (items[left] as number) ? right : left;
        if ((items[child] as number) >= last) break;
        items[i] = items[child] as number;
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}
