import type { JSX, ReactNode } from 'react';
import { StudioHostIsland } from './StudioHostIsland';

/**
 * The `(studio)` route group (AUTORIG-SPEC §3.1, §4.4; D1): `/editor` and `/autorig` share this layout, whose client
 * island creates the EditorApp once per page load. Next keeps a layout mounted across client navigations between its
 * child routes, so switching between Studio and Auto-Rig keeps the document, its undo history and the WebGL context.
 * Route groups do not change URLs.
 */
export default function StudioLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return <StudioHostIsland>{children}</StudioHostIsland>;
}
