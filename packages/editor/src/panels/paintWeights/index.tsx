// The Paint Weights panel (M6B-SPEC §8.7, §5.10–§5.12; C6): a lazy chunk — panels/index.ts registers the panel with
// `lazyPanelDef`, so nothing of this directory is in the editor route. Top to bottom: the meshes (the hilited bound
// meshes of the active character, else all of them), the influence list (the union of their palettes; click = active
// influence, the lock = Hold of the JOINT on every bound mesh of the character, §5.10; the number = points with weight;
// helpers and props in italics), Hold all / Release, the operation (Replace / Add / Scale / Smooth), Value and Opacity
// with Flood, the brush (radius, falloff, Surface / Volume, front faces only, X-mirror stroke), the weight display
// (greyscale / ramp / influence colours) and the normalization note. Paint Select, Copy/Paste/Hammer/Move and the
// numbers overlay arrive after the MVP (§0.3). Every control runs an operator for the panel. The controls are
// `./PaintWeightsControls` (AUTORIG-SPEC §9 CR-AR-1, extracted by Auto-Rig D4; Auto-Rig's ③ shows them compact); this
// view adds the empty state (no bound mesh: Bind Skin…) and the panel frame.
import { loadMeshKernel, PANEL, type RunContext, skinTargets } from '@ekza-studio/editor-core';
import { type JSX, useEffect, useState } from 'react';
import { useRunOperator, useSession } from '../../hooks';
import { useRig } from '../../shell/rig/hooks';
import type { PanelProps } from '../types';
import { PaintWeightsControls } from './PaintWeightsControls';

const CTX: RunContext = { panel: PANEL.paintWeights };
const BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';

export default function PaintWeightsView(props: PanelProps): JSX.Element {
  const { app } = props;
  const validation = useRig(app);
  const run = useRunOperator();
  useSession((s) => s.model.hilite);
  useSession((s) => s.rig.character);
  const [kernel, setKernel] = useState(false);
  useEffect(() => {
    let live = true;
    void loadMeshKernel().then(() => {
      if (live) setKernel(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const meshes = validation === null || !kernel ? [] : skinTargets(app);
  if (meshes.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-4 text-ui text-fg-3"
        data-testid="pw-panel"
      >
        <span>No bound mesh selected</span>
        <button
          type="button"
          className={BUTTON}
          data-testid="pw-btn-bind"
          onClick={() => void run('skin.bind', {}, CTX)}
        >
          Bind Skin…
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2 text-ui text-fg-2" data-testid="pw-panel">
      <PaintWeightsControls app={app} meshes={meshes} />
    </div>
  );
}
