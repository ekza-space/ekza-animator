// ⋯ More (STUDIO-TOUCH-SPEC §6.3) — the grammar's stand-in until T6b's More sheet (`sheets/more`, derived from the
// Disclosure Manifest) is wired in: every verb the verb source lists for the noun, each row `plain name · Pro name`,
// greyed with its poll reason inline when it cannot run; the footer offers *Open this in the Pro layout ▸*. A lazy
// chunk.
import { Sheet, SheetRow, TouchButton } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import { pollVerb, proNameOf, spaceNoun } from './verbSource';

export default function MoreSheet({
  controller,
  side,
  onOpenChange,
}: {
  readonly controller: HaloController;
  readonly side: 'right' | 'bottom';
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { ctx, verbs } = controller;
  const stage = useHaloStore(ctx.store, (s) => s.stage);
  const noun = verbs.noun(ctx.app, stage) ?? spaceNoun();
  const rows = [...verbs.petals(ctx.app, noun, stage), ...verbs.more(ctx.app, noun, stage)];
  return (
    <Sheet
      data-testid="halo-sheet-more"
      open
      onOpenChange={onOpenChange}
      modal={false}
      side={side}
      defaultDetent="half"
      title={en.more.title(noun.label)}
      description={en.more.detail}
      footer={
        <TouchButton className="flex-1" onClick={() => controller.proLayout(true)}>
          {en.more.openInPro}
        </TouchButton>
      }
    >
      {rows.map((verb) => {
        const poll = pollVerb(ctx.app, verb);
        const pro = proNameOf(ctx.app, verb);
        const detail = [pro, poll === true ? undefined : poll.reason].filter((s) => s !== undefined).join(' · ');
        return (
          <SheetRow
            key={verb.id}
            title={verb.label}
            {...(detail === '' ? {} : { detail })}
            disabled={poll !== true}
            onClick={() => controller.runVerb(verb, 'more')}
          />
        );
      })}
    </Sheet>
  );
}
