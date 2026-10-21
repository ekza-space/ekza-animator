// The Rig Toolkit sections, top to bottom (M6B-SPEC §8.6, §0.4.7; C0, closed): Skeleton (C3), Skin (C6), Character
// (C10, Attributes › Character inside the Toolkit) and Clip Library (C12). The checklist, header and footer are the
// frame's (C7).
import { CharacterSection } from './character';
import { LibrarySection } from './library';
import { SkeletonSection } from './skeleton';
import { SkinSection } from './skin';
import type { RigToolkitSection } from './types';

export type { RigToolkitSection, RigToolkitSectionProps } from './types';

export const RIG_TOOLKIT_SECTIONS: readonly RigToolkitSection[] = [
  { id: 'skeleton', title: 'Skeleton', component: SkeletonSection },
  { id: 'skin', title: 'Skin', component: SkinSection },
  { id: 'character', title: 'Character', component: CharacterSection },
  { id: 'library', title: 'Clip Library', component: LibrarySection },
];
