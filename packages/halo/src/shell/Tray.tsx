// The tray (STUDIO-TOUCH-SPEC §4.1, §7.1): empty space is a noun too, and the tray is its Halo, docked — the stage's
// tools and state chips, with `⋯` pinned last so it never scrolls away. The stage packages own the real trays
// (`stages/*/Tray.tsx`, T7–T9: component pill toggles, swatches, the rig segment, the Thread); until they mount, the
// grammar docks empty space's verbs here, and Make keeps its component pill (Whole · Points · Edges · Faces).
import type { ComponentMode } from '@ekza-studio/editor-core';
import { Cluster, Segmented, VerbBar, type VerbItem } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { Icon } from '../halo/icons';
import { pollVerb, spaceNoun } from '../halo/verbSource';
import { en } from '../i18n/en';
import type { HaloController } from './controller';
import { useDocumentVersion, useSessionValue } from './hooks';
import { useHaloStore } from './store';

const PICK_MODES: readonly { readonly value: ComponentMode; readonly label: string }[] = [
  { value: 'object', label: en.tray.whole },
  { value: 'vertex', label: en.tray.points },
  { value: 'edge', label: en.tray.edges },
  { value: 'face', label: en.tray.faces },
];

export function Tray({
  controller,
  compact,
}: {
  readonly controller: HaloController;
  readonly compact: boolean;
}): JSX.Element {
  const { ctx, verbs } = controller;
  const { app, store } = ctx;
  const stage = useHaloStore(store, (s) => s.stage);
  const mode = useSessionValue(app, (s) => s.model.componentMode);
  useSessionValue(app, (s) => s.workspace);
  useDocumentVersion(app);
  const space = spaceNoun();
  const petals = verbs.petals(app, space, stage);
  const items: VerbItem[] = petals.map((verb) => {
    const poll = pollVerb(app, verb);
    return {
      id: verb.id,
      label: verb.label,
      ...(verb.icon === undefined ? {} : { icon: <Icon name={verb.icon} /> }),
      ...(poll === true ? {} : { disabledReason: poll.reason }),
    };
  });
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-tray"
      className="pointer-events-auto flex max-w-full items-center gap-1.5 p-[5px]"
    >
      {stage === 'make' ? (
        <Segmented<ComponentMode>
          label={en.tray.pick}
          data-testid="halo-pick"
          value={mode}
          onValueChange={(next) => void ctx.run('select.mode', { mode: next })}
          items={compact ? PICK_MODES.slice(0, 4) : PICK_MODES}
        />
      ) : null}
      <VerbBar
        className="min-w-0 flex-1"
        data-testid="halo-tray-verbs"
        label={en.halo.emptySpace}
        verbs={items}
        onSelect={(id) => {
          const verb = petals.find((p) => p.id === id);
          if (verb !== undefined) controller.runVerb(verb, 'petal');
        }}
        onMore={() => store.set({ sheet: 'more', halo: null })}
        onReason={(_id, reason) => ctx.toasts.push({ key: 'reason', text: reason })}
      />
    </Cluster>
  );
}
