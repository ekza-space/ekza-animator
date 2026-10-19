// Marking menu host (M6A-SPEC §5.18; B9): draws the open menu of the shell's controller once it is visible. The
// drawing is a lazy chunk; the controller (logic, geometry, the test API's answers) is eager and small.
import { type JSX, lazy, Suspense } from 'react';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { MarkingMenuController } from './controller';

export {
  COMPASS,
  createMarkingMenuController,
  FLICK_MS,
  FLICK_PX,
  MM_RADIUS,
  type MarkingMenuController,
  type MarkingMenuEntry,
  type OpenMarkingMenu,
  slotPosition,
  slotToward,
} from './controller';

const MarkingMenuView = lazy(() => import('./MarkingMenuView'));

/** Starts loading the drawing before the first menu opens (entering Model). */
export function prefetchMarkingMenu(): void {
  void import('./MarkingMenuView');
}

export function MarkingMenuHost(props: { readonly controller: MarkingMenuController }): JSX.Element | null {
  const open = useStoreSelector(props.controller.state, (s) => s.open);
  if (open === null || !open.visible) return null;
  return (
    <Suspense fallback={null}>
      <MarkingMenuView controller={props.controller} open={open} />
    </Suspense>
  );
}
