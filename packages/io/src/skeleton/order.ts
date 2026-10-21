// SkeletonDesc node order (DECISIONS-OPEN B-16): every glTF node in topological order, produced by Kahn's algorithm
// that always emits the smallest ready glTF index, so a file whose nodes are already parent-first keeps its glTF
// order. The order is a function of the file alone, which lets `io/testing.loadGltfInNode` map three.js objects by
// SkeletonDesc index without a skeleton.
import { EkzaError } from '@ekza-studio/anim-core';
import { listField } from '../gltf/schema';

/** Minimal glTF JSON view used for ordering. */
export interface GltfNodesJson {
  readonly nodes?: readonly { readonly children?: readonly number[] }[];
}

/** glTF node index for every SkeletonDesc node index (parents before children, smallest ready index first). */
export function skeletonNodeOrder(json: GltfNodesJson): number[] {
  const nodes = listField(json.nodes);
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    const children = listField(node?.children);
    for (const child of children) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length || child === index || parent[child] !== -1) {
        throw new EkzaError('malformed-gltf', `Node ${String(child)} has an invalid or second parent (node ${index})`, {
          pointer: `/nodes/${index}/children`,
        });
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
    const children = nodes[index]?.children;
    for (const child of listField(children)) ready.push(child);
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
