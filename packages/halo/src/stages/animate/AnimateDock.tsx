// The Animate stage's tray (STUDIO-TOUCH-SPEC §4.1, §7.1, §10; T7, P-T6A-4: it replaces the shell's stand-in tray in
// Animate): empty space's Halo, docked — the docked Halo of a Thread noun when one is open, the Animations row, the
// Thread with its layer switch, and the unfolded layer above the Thread (Keys; Curves is T10's). With no character to
// animate it is the empty state that bridges to the next step instead of a lock (§7.1).
import { Cluster, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import { en } from '../../i18n/en';
import type { HaloController } from '../../shell/controller';
import { type SizeClass, useDocumentVersion } from '../../shell/hooks';
import { useHaloStore } from '../../shell/store';
import { Thread } from '../../thread/strip/Thread';
import { AnimationsRow } from './AnimationsRow';
import { DockedHalo } from './DockedHalo';
import { animateCharacter } from './model';
import { animateUi } from './ui';

const KeysLayer = lazy(() => import('../../thread/keys/KeysLayer'));

const w = animateWords;

function EmptyState({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { ctx } = controller;
  const meshes = ctx.app.store.list('meshes').length > 0;
  const count = (): void => ctx.store.set((s) => ({ touches: s.touches + 1 }));
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-animate-empty"
      className="pointer-events-auto flex flex-wrap items-center gap-2 p-[5px] pl-4"
    >
      <span className="font-medium text-fg">{w.dock.nothingTitle}</span>
      <span className="flex-1" />
      {meshes ? (
        <TouchButton
          variant="primary"
          onClick={() => {
            count();
            void controller.enterStage('rig');
          }}
        >
          {w.dock.rigItForMe}
        </TouchButton>
      ) : null}
      <TouchButton
        onClick={() => {
          count();
          void ctx.run('file.loadSample', { sample: 'polybot' });
        }}
      >
        {w.dock.tryLibrary}
      </TouchButton>
    </Cluster>
  );
}

/** Curves (layer 2) is work package T10's; until it lands the layer says so and opens Pro's Graph Editor. */
function CurvesStandIn({ controller }: { readonly controller: HaloController }): JSX.Element {
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-thread-curves"
      className="pointer-events-auto flex items-center gap-2 p-[5px] pl-4"
    >
      <span className="flex-1 text-fg-2">{w.thread.layers.curves}</span>
      <TouchButton onClick={() => controller.proLayout(true)}>{en.toast.openInPro}</TouchButton>
    </Cluster>
  );
}

/**
 * The dock for the frame (P-T6A-4): `dock` replaces the shell's tray in Animate (null elsewhere), and `lift` is the
 * extra height the dock takes above the tray's, for the floating grammar and the corner clusters.
 */
export function useAnimateDock(
  controller: HaloController,
  size: SizeClass,
  height: number,
): { readonly dock: JSX.Element | null; readonly lift: number } {
  const { ctx } = controller;
  const stage = useHaloStore(ctx.store, (s) => s.stage);
  const layer = useHaloStore(ctx.store, (s) => s.threadLayer);
  useDocumentVersion(ctx.app);
  // the dock's own height, for the floating grammar and the corner clusters (the docked Halo and the open cards grow it)
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(0);
  const measure = useCallback((el: HTMLDivElement | null) => setElement(el), []);
  useEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setMeasured(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  if (stage !== 'animate') return { dock: null, lift: 0 };
  const ui = animateUi(ctx.store);
  const compact = size === 'compact';
  const character = animateCharacter(ctx.app);
  if (character === null) return { dock: <EmptyState controller={controller} />, lift: 0 };
  const unfold = layer === 1 ? Math.round(height * 0.34) : 0;
  const dock = (
    <div
      ref={measure}
      className="flex w-full max-w-[1100px] flex-col items-stretch gap-2"
      data-testid="halo-animate-dock"
      data-layer={layer}
    >
      <DockedHalo controller={controller} ui={ui} compact={compact} />
      {layer === 1 ? (
        <Suspense fallback={null}>
          <KeysLayer controller={controller} ui={ui} height={unfold} />
        </Suspense>
      ) : null}
      {layer === 2 ? <CurvesStandIn controller={controller} /> : null}
      <AnimationsRow controller={controller} ui={ui} compact={compact} />
      <Thread controller={controller} ui={ui} compact={compact} />
    </div>
  );
  return {
    dock,
    // the shell's tray is one 54 px row; the dock is two rows at rest, more with a docked Halo, a card or Keys
    lift: measured > 0 ? Math.max(0, measured - 54) : 60 + unfold,
  };
}
