import type { RawChannel, RawClip, SkeletonDesc } from '../types';

function parentName(skeleton: SkeletonDesc, node: number): string | null {
  const parent = skeleton.nodes[node]?.parent ?? -1;
  return parent >= 0 ? (skeleton.nodes[parent]?.name ?? null) : null;
}

/**
 * Re-targets a raw clip from one skeleton to another by node name (animation-only GLB onto a character, M1-stretch
 * FR-IO-10): each channel moves to the node of `to` with the same name, preferring the one whose parent name also
 * matches and then the same occurrence among equal names. Values are kept as they are (raw node locals); channels
 * without a match are dropped, reported in `unmatched` (unique source names, first-seen order) and appended to
 * `skipped` with reason 'unmatched-node'.
 */
export function remapRawClipByName(
  raw: RawClip,
  from: SkeletonDesc,
  to: SkeletonDesc,
): { readonly clip: RawClip; readonly unmatched: readonly string[] } {
  const byName = new Map<string, number[]>();
  to.nodes.forEach((node, i) => {
    const list = byName.get(node.name);
    if (list === undefined) byName.set(node.name, [i]);
    else list.push(i);
  });
  const occurrence = (skeleton: SkeletonDesc, node: number): number => {
    const name = skeleton.nodes[node]?.name;
    let count = 0;
    for (let i = 0; i < node; i++) if (skeleton.nodes[i]?.name === name) count++;
    return count;
  };

  const channels: RawChannel[] = [];
  const skipped: RawClip['skipped'][number][] = [...raw.skipped];
  const unmatched: string[] = [];
  raw.channels.forEach((channel, index) => {
    const source = from.nodes[channel.node];
    const candidates = source === undefined ? undefined : byName.get(source.name);
    if (source === undefined || candidates === undefined || candidates.length === 0) {
      skipped.push({ reason: 'unmatched-node', channel: index });
      const name = source?.name ?? `#${channel.node}`;
      if (!unmatched.includes(name)) unmatched.push(name);
      return;
    }
    const sourceParent = parentName(from, channel.node);
    const sameParent = candidates.filter((node) => parentName(to, node) === sourceParent);
    const pool = sameParent.length > 0 ? sameParent : candidates;
    const target = pool[Math.min(occurrence(from, channel.node), pool.length - 1)] as number;
    channels.push({ ...channel, node: target });
  });
  return { clip: { ...raw, channels, skipped }, unmatched };
}
