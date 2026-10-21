import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, KeyScope, PanelKind } from '@ekza-studio/editor-core';
import type { ComponentType } from 'react';

export interface PanelProps {
  readonly app: EditorApp;
  readonly instanceId: string;
}

export interface PanelDef {
  readonly id: string;
  readonly kind: PanelKind;
  readonly title: string;
  readonly component: ComponentType<PanelProps>;
  readonly keyScope: KeyScope;
  readonly multiInstance?: boolean;
}

export interface PanelRegistry {
  register(def: PanelDef): Disposer;
  get(id: string): PanelDef | undefined;
  list(): readonly PanelDef[];
}
