// The `/app` route's shell (STUDIO-TOUCH-SPEC §20.1, §20.2; ADR 0023 D1): Ekza Studio's Simple layout over the page's
// host. One controller per mounted shell (its effects start on mount and end on unmount; StrictMode's replay keeps the
// arrival), its context for the parts, and the frame.
import { useHost } from '@ekza-studio/editor/host';
import { type JSX, useEffect, useState } from 'react';
import { HaloContext } from './context';
import { createHaloController } from './controller';
import { Frame } from './Frame';

export function HaloShell(): JSX.Element {
  const host = useHost();
  const [controller] = useState(() => createHaloController(host));
  useEffect(() => controller.start(), [controller]);
  return (
    <HaloContext value={controller.ctx}>
      <Frame controller={controller} />
    </HaloContext>
  );
}
