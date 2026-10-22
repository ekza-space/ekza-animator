// The header's `⋯` menu button (AUTORIG-SPEC §5.1, §3.4; D3): a small menu button of its own (no Radix menu on
// `/autorig`'s first visit) with `aria-haspopup`; its list, the project picker and the Keyboard shortcuts sheet are a
// lazy chunk (`./MenuBody`) loaded by the first press (AR-D3-19).
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, lazy, Suspense, useId, useRef, useState } from 'react';
import { messages } from '../i18n';
import type { WizardContext } from './context';

const MenuBody = lazy(() => import('./MenuBody'));

export function MoreMenu(props: { readonly ctx: WizardContext }): JSX.Element {
  const f = messages().frame;
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <span className="relative">
      <button
        ref={trigger}
        type="button"
        className={cn(buttonClass('ghost', 'sm'), 'w-8 px-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11')}
        aria-label={f.more}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid="ar-more"
        onClick={() => {
          setUsed(true);
          setOpen(!open);
        }}
      >
        ⋯
      </button>
      {used ? (
        <Suspense fallback={null}>
          <MenuBody ctx={props.ctx} id={id} open={open} setOpen={setOpen} trigger={trigger} />
        </Suspense>
      ) : null}
    </span>
  );
}
