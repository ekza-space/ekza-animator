// Graph Editor buffer curves (M2A-SPEC §4.9 `graph.buffer.*`, §5.15.1; A4 implements them). A0 lands them as stubs.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const GRAPH_BUFFER_OPERATORS: readonly AnyOperator[] = [
  stubOperator('graph.buffer.snapshot', 'Snapshot Buffer Curves', {
    category: 'graph',
    description: 'Keep a copy of the target curves to compare with or swap back.',
  }),
  stubOperator('graph.buffer.swap', 'Swap Buffer Curves', {
    category: 'graph',
    description: 'Swap the target curves with their buffer copies.',
    undo: true,
  }),
  stubOperator('graph.buffer.clear', 'Clear Buffer Curves', {
    category: 'graph',
    description: 'Forget every buffer curve.',
  }),
];
