// The eager facade of B11's shell overlay (M6A-SPEC §5.27; registered into B9's `optionBox` shell slot): it mounts
// the overlay (`overlays/menus/optionBox.tsx`: the option box popover, the capture window's page bridge and the
// registration of B11's marking menus, a lazy chunk) once Model has been entered, and keeps it mounted after that.
// Nothing of it is needed before: the capture window, the menus and the option box are Model's.
import { type JSX, lazy, Suspense, useState } from 'react';
import { useSession } from '../../hooks';
import type { ShellOverlayProps } from '../../overlays/slots';

// The overlay registers B11's marking menus from a second chunk (`overlays/menus/tools`); both are fetched together
// on the first Model entry, so `M` and the Shift+RMB menus do not wait for one chunk after the other.
const ModelOpsShellOverlay = lazy(() => {
  void import('../../overlays/menus/tools').catch(() => {
    // The overlay's own import retries (offline after a redeploy).
  });
  return import('../../overlays/menus/optionBox').then((module) => ({ default: module.ModelOpsShellOverlay }));
});

export function ModelOpsSlot(props: ShellOverlayProps): JSX.Element | null {
  const inModel = useSession((s) => s.workspace === 'model');
  // Once seen, the overlay stays (state derived during render: React's "adjust state on change").
  const [seenModel, setSeenModel] = useState(inModel);
  if (inModel && !seenModel) setSeenModel(true);
  if (!seenModel) return null;
  return (
    <Suspense fallback={null}>
      <ModelOpsShellOverlay {...props} />
    </Suspense>
  );
}
