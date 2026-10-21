// A panel whose body is a lazy chunk (M6B-SPEC §2.1, §0.4.9; C0): the eager part is this definition only, so the Rig &
// Skin and Clip Library panels add no code to the route until they are shown. The body loads when the panel mounts.
import type { PanelKind } from '@ekza-studio/editor-core';
import { type ComponentType, type JSX, lazy, Suspense } from 'react';
import type { PanelDef, PanelProps } from './types';

export function lazyPanelDef(
  kind: PanelKind,
  title: string,
  load: () => Promise<{ readonly default: ComponentType<PanelProps> }>,
): PanelDef {
  const Body = lazy(load);
  const component = (props: PanelProps): JSX.Element => (
    <Suspense fallback={null}>
      <Body {...props} />
    </Suspense>
  );
  return { id: kind, kind, title, component, keyScope: kind };
}
