// The rig's controls hidden in the joint-fitting panes (AR-D8-4; D8; lazy with ② and ③): after Auto-rig the IK rings
// and pole targets covered the markers (②) and the joints (③ *Adjust joints*). While `active`, every registered pane
// draws no controls; the flags each pane had are restored when it ends (Studio's Rig & Skin shares the pane memory).
import { paneDisplayPort } from '@ekza-studio/editor-core';
import { useEffect } from 'react';
import type { WizardContext } from '../../shell/context';

/** Hides the controls of the shown panes while `active`; `layout` re-applies it when the panes change. */
export function useHiddenControls(ctx: WizardContext, active: boolean, layout: string): void {
  useEffect(() => {
    const port = paneDisplayPort(ctx.app);
    if (!active || port === null) return undefined;
    const hidden: string[] = [];
    for (const pane of port.panes()) {
      const display = port.display(pane);
      if (display === null || !display.controls) continue;
      hidden.push(pane);
      port.setDisplay(pane, { ...display, controls: false });
    }
    return () => {
      for (const pane of hidden) {
        const display = port.display(pane);
        if (display !== null && !display.controls) port.setDisplay(pane, { ...display, controls: true });
      }
    };
  }, [ctx, active, layout]);
}
