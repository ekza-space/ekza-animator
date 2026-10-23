// The Agent panel behind a React.lazy boundary (MCP-SPEC §2: the lazy chunk is reported, not gated by check:size).
import { type JSX, lazy, Suspense } from 'react';
import type { PanelProps } from '../types';

const AgentPanel = lazy(() => import('../../agent/panel/AgentPanel'));

export function AgentPanelLazy(props: PanelProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-3 text-ui text-fg-3">Loading…</div>}>
      <AgentPanel {...props} />
    </Suspense>
  );
}
