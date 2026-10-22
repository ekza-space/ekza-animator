// ① cards a fresh profile's first visit never shows (AUTORIG-SPEC §4.4, §5.2, §6.1; D3, AR-D3-4), a lazy chunk:
// *Continue where you left off* (an autosave slot), the choice for a skinned file Auto-Rig cannot map (*Re-rig from
// scratch* / *Open in Studio*) and a project's characters.
import type { CharacterId } from '@ekza-studio/doc';
import type { AutosaveSlotInfo } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import type * as Fixes from './fixes';
import { modelUi, withFlow } from './ui';

const t = (): ReturnType<typeof messages>['model'] => messages().model;

const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'md'), 'pointer-coarse:min-h-11');

function ago(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60_000);
  if (minutes < 1) return t().agoNow;
  return minutes < 60 ? t().agoMinutes(minutes) : t().agoHours(Math.floor(minutes / 60));
}

/** The ① fix actions (`./fixes`, the report's chunk); a chunk that does not arrive shows as a ① failure. */
const fixes = (ctx: WizardContext, run: (module: typeof Fixes) => Promise<void> | void): void => {
  void import('./fixes').then(run, () =>
    modelUi(ctx).set((current) => ({ ...current, loading: null, error: t().loadFailed })),
  );
};

export type ExtrasProps =
  | { readonly ctx: WizardContext; readonly show: 'continue'; readonly slot: AutosaveSlotInfo }
  | { readonly ctx: WizardContext; readonly show: 'rigged-other' }
  | { readonly ctx: WizardContext; readonly show: 'choose'; readonly characters: readonly CharacterId[] };

export default function Extras(props: ExtrasProps): JSX.Element {
  const { ctx } = props;
  const m = t();
  if (props.show === 'continue') {
    const { slot } = props;
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-field border border-line bg-panel p-3"
        data-testid="ar-continue"
      >
        <p className="text-center">{m.continueTitle(slot.projectName, ago(slot.savedAt))}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className={button('primary')}
            onClick={() => void withFlow(ctx, m.loadFailed, (flow) => flow.continueSlot(ctx, slot.id))}
          >
            {m.continue}
          </button>
          <button
            type="button"
            className={button('ghost')}
            onClick={() => void withFlow(ctx, m.loadFailed, (flow) => flow.discardSlot(ctx, slot.id))}
          >
            {m.startOver}
          </button>
        </div>
      </div>
    );
  }
  if (props.show === 'rigged-other') {
    return (
      <div className="flex flex-col items-center gap-2" data-testid="ar-rigged-other" role="alert">
        <p>{m.kindRiggedOther}</p>
        <div className="flex gap-2">
          <button type="button" className={button('primary')} onClick={() => fixes(ctx, (f) => f.reRig(ctx))}>
            {m.reRig}
          </button>
          <button type="button" className={button()} onClick={() => fixes(ctx, (f) => f.openRiggedInStudio(ctx))}>
            {m.openInStudio}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2" data-testid="ar-choose-character">
      <p>{m.severalCharacters}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {props.characters.map((id) => (
          <button
            key={id}
            type="button"
            className={button()}
            onClick={() => fixes(ctx, (f) => f.chooseCharacter(ctx, id))}
          >
            {ctx.app.store.get('characters', id)?.name ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}
