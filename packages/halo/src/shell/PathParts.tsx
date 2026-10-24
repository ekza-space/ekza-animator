// T6b's Path, status corner and Next chip in T6a's frame (STUDIO-TOUCH-SPEC §4.1, §7.1, §7.2; P-T6A-2, P-T6B-2):
// the Path in the top bar (Wide), on a second row (Regular) or as the bottom tab bar (Compact) — tapping a stage is
// the controller's stage switch, tapping the selected stage's ⚠n opens Health at that stage; the status corner above
// the View puck; the one Next chip above the tray, hidden while a Halo, a card, a form or a sheet is open. All three
// read the frame's one readiness list.
import type { JSX } from 'react';
import { Path } from '../path/Path';
import { NextChipView, StatusCorner } from '../path/StatusCorner';
import { nextChip } from '../path/nextChip';
import type { HaloController } from './controller';
import { useReadiness } from './readiness';
import { useHaloStore } from './store';

export function FramePath({
  controller,
  bar = false,
}: {
  readonly controller: HaloController;
  readonly bar?: boolean;
}): JSX.Element {
  const { store } = controller.ctx;
  const stage = useHaloStore(store, (s) => s.stage);
  const r = useReadiness(controller.readiness);
  return (
    <Path
      stage={stage}
      readiness={r}
      bar={bar}
      onStage={(next) => void controller.enterStage(next)}
      onProblems={(at) => store.set({ sheet: 'health', sheetArgs: { section: at }, sheetNoun: null, halo: null })}
    />
  );
}

export function FrameStatus({ controller }: { readonly controller: HaloController }): JSX.Element | null {
  const { store } = controller.ctx;
  const r = useReadiness(controller.readiness);
  return (
    <div className="pointer-events-auto" data-halo-chrome="">
      <StatusCorner
        readiness={r}
        onOpenHealth={() => store.set({ sheet: 'health', sheetArgs: null, sheetNoun: null, halo: null })}
      />
    </div>
  );
}

export function FrameNext({ controller }: { readonly controller: HaloController }): JSX.Element | null {
  const { store, app } = controller.ctx;
  const r = useReadiness(controller.readiness);
  const busy = useHaloStore(
    store,
    (s) =>
      s.sheet !== null ||
      s.halo !== null ||
      s.form !== null ||
      s.confirm !== null ||
      s.target !== null ||
      s.loupe !== null ||
      s.palette ||
      s.projectMenu,
  );
  const dismissed = useHaloStore(store, (s) => s.nextDismissed);
  const chip = busy ? null : nextChip(app, r);
  if (chip === null || chip.id === dismissed) return null;
  return (
    <div className="flex justify-center">
      <div className="pointer-events-auto" data-halo-chrome="">
        <NextChipView
          chip={chip}
          onChip={(next) => {
            void (async () => {
              if (next.stage !== undefined) await controller.enterStage(next.stage);
              if (next.sheet !== undefined) {
                store.set({ sheet: next.sheet, sheetArgs: null, sheetNoun: null, halo: null });
              }
            })();
          }}
          onDismiss={() => store.set({ nextDismissed: chip.id })}
        />
      </div>
    </div>
  );
}
