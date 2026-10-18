// The Dope Sheet panel (M2A-SPEC §5.10): A0 placeholder. A3 replaces the body and writes the `React.lazy` boundary
// of its panel registration (§5.21.2 required lazy boundary 4); the placeholder registers the Dope Sheet
// contributions (the `dopeSheet.frame` stub) while it is mounted, like the Graph Editor does.
import { registerDopeSheetContributions } from '@ekza-animator/curve-editor';
import { type JSX, useEffect } from 'react';
import type { PanelProps } from '../types';

export function DopeSheetPanel(props: PanelProps): JSX.Element {
  const { app } = props;
  useEffect(() => {
    if (app.operators.get('dopeSheet.frame') !== undefined) return undefined;
    return registerDopeSheetContributions(app, () => null);
  }, [app]);
  return (
    <div className="grid h-full place-items-center p-4 text-center text-ui text-fg-3" data-testid="ds-placeholder">
      <p>The Dope Sheet is not available yet.</p>
    </div>
  );
}
