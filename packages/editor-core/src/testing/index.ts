// '@ekza-animator/editor-core/testing' (WP-0b, then WP-7a). Final signatures (MVP-SPEC §7 WP-7a); the fake app
// throws until the shared test kit lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '@ekza-animator/doc';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { EditorApp, EditorServices } from '../types';

export interface FakeEditorApp extends EditorApp {
  readonly calls: readonly { readonly id: string; readonly args: unknown }[];
}

export function createFakeEditorApp(_opts?: {
  readonly snapshot?: DocSnapshot;
  readonly skeleton?: SkeletonDesc;
  readonly services?: Partial<EditorServices>;
  readonly platform?: 'mac' | 'other';
}): FakeEditorApp {
  throw new EkzaError('not-implemented', 'editor-core/testing.createFakeEditorApp');
}
