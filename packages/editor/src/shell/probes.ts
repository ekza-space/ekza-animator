import type { Disposer } from '@ekza-studio/anim-core';
import type { ProbeMap, ProbeRegistry } from './types';

/** Probes stack per kind: the newest registration wins; disposing it reveals the previous one. */
export function createProbeRegistry(): ProbeRegistry {
  const stacks: { [K in keyof ProbeMap]: ProbeMap[K][] } = {
    viewport: [],
    graph: [],
    timeline: [],
    dopeSheet: [],
    'tween.graph': [],
    'tween.dopeSheet': [],
    'tween.status': [],
  };
  return {
    get<K extends keyof ProbeMap>(kind: K): ProbeMap[K] | null {
      const stack = stacks[kind] as ProbeMap[K][];
      return stack.at(-1) ?? null;
    },
    set<K extends keyof ProbeMap>(kind: K, probe: ProbeMap[K]): Disposer {
      const stack = stacks[kind] as ProbeMap[K][];
      stack.push(probe);
      return () => {
        const index = stack.lastIndexOf(probe);
        if (index !== -1) stack.splice(index, 1);
      };
    },
  };
}
