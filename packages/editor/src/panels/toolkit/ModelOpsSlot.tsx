// The eager facade of B11's shell overlay (M6A-SPEC §5.27; registered into B9's `optionBox` shell slot): it installs the
// numeric capture window's page bridge when the shell mounts (`overlays/menus/captureBridge.ts`, eager: the window
// must know where the pointer was when it armed, §5.10 (b)), and mounts the overlay (`overlays/menus/optionBox.tsx`:
// the option box popover, a lazy chunk) once Model has been entered, and keeps it mounted after that. Nothing of the
// overlay is needed before: the option box is Model's. B11's marking menus are registered by the page's host on the
// first Model entry (STUDIO-TOUCH-SPEC §20.3 item 12, T3).
import { type JSX, lazy, Suspense, useEffect, useState } from 'react';
import { useSession } from '../../hooks';
import { bridgeCapture } from '../../overlays/menus/captureBridge';
import type { ShellOverlayProps } from '../../overlays/slots';
import { useOptionalShell } from '../../shell/context';

const ModelOpsShellOverlay = lazy(() =>
  import('../../overlays/menus/optionBox').then((module) => ({ default: module.ModelOpsShellOverlay })),
);

export function ModelOpsSlot(props: ShellOverlayProps): JSX.Element | null {
  const { app } = props;
  const shell = useOptionalShell();
  // Not with the lazy overlay: the B11 runtime that arms the window and the overlay's chunk land in either order.
  useEffect(() => bridgeCapture(app, shell), [app, shell]);
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
