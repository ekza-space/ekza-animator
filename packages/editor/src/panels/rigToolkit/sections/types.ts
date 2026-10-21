// The Rig Toolkit section contract (M6B-SPEC §8.6; C0): the frame (C7) renders each registered section under its
// title with the app; a section returns null while it has nothing to show.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ComponentType } from 'react';

export interface RigToolkitSectionProps {
  readonly app: EditorApp;
}

export interface RigToolkitSection {
  readonly id: string;
  readonly title: string;
  readonly component: ComponentType<RigToolkitSectionProps>;
}
