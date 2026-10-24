// The single canvas pane (STUDIO-TOUCH-SPEC §4.1, §20.2): a DOM surface registered with the page's ViewportManager as
// Auto-Rig's wizard pane is (`paneSetup` — what the pane showed in this workspace, else its defaults — then
// `registerPane`, `unregisterPane` on unmount), with Studio Pro's id `pane-single`, so the camera memory is shared with
// Pro (§16.1). The shared canvas draws behind it; the arbiter stage takes its presses. Chrome never sits inside it: the
// Halo, chips and bars are siblings, so their pointers never join a canvas gesture (C6).
import { PANEL } from '@ekza-studio/editor-core';
import { type JSX, useLayoutEffect, useRef } from 'react';
import type { HaloController } from '../shell/controller';
import { PANE } from '../shell/stage';
import { en } from '../i18n/en';
import { useViewport } from '../shell/hooks';

export function HaloPane({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { ctx } = controller;
  const surface = useRef<HTMLDivElement>(null);
  const vm = useViewport(ctx.host);
  useLayoutEffect(() => {
    const element = surface.current;
    if (vm === null || element === null) return undefined;
    const setup = vm.paneSetup(PANE);
    vm.registerPane({ id: PANE, element, camera: setup.camera, display: setup.display });
    const detach = controller.attachPane(element);
    return () => {
      detach();
      vm.unregisterPane(PANE);
    };
  }, [vm, controller]);
  return (
    <div
      ref={surface}
      role="application"
      aria-label={en.view.canvas}
      className="absolute inset-0 outline-none"
      data-testid={`pane-${PANE}`}
      data-ekza-panel={PANEL.viewport}
      data-ekza-pane={PANE}
    />
  );
}
