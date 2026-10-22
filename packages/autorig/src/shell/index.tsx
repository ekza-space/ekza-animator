// The Auto-Rig shell (AUTORIG-SPEC §4.1, §5.1; D3): the wizard frame over the host's EditorApp
// (`@ekza-studio/editor/host`). It creates the wizard controller once per mount — the session store and its mirror,
// the derived progress, the arrival, the step entry order, the mounted-shell slot, the test API's `autorig()`, the
// `autorig` keys, file drops and the Simple navigation override — and renders the frame. The `ekza-autorig-shell`
// marker on its root is the check-size boundary of `/editor` and the shell group of `/autorig` (§7.2).
import { useHost } from '@ekza-studio/editor/host';
import { type JSX, useEffect, useState } from 'react';
import { AUTORIG_SHELL_MARKER } from '../types';
import { Wizard } from './context';
import { createWizard } from './controller';
import { Frame } from './Frame';

export type AutoRigShellProps = Record<string, never>;

export function AutoRigShell(): JSX.Element {
  const host = useHost();
  const [wizard] = useState(() => createWizard(host));
  useEffect(() => wizard.start(), [wizard]);
  return (
    <Wizard value={wizard}>
      <Frame ctx={wizard} footer={wizard.footer} marker={AUTORIG_SHELL_MARKER} />
    </Wizard>
  );
}

export { type FooterState, type ShellUi, useWizard, type WizardContext } from './context';
export { type StepModule, type StepPane, type StepSlot, type StepViewProps } from './steps';
