// The header's `⋯` menu (AUTORIG-SPEC §5.1, §3.4; D3): New, Open project…, Save project, Open in Studio (new tab),
// Switch mode…, Command palette… (the host's overlay port), Preferences, Keyboard shortcuts, About & credits. A small
// menu button of its own (no Radix menu on `/autorig`'s first visit): `aria-haspopup`, arrow keys, Esc and an
// outside press close it and give the focus back.
import { openDialog, openOverlay } from '@ekza-studio/editor/host';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, lazy, type KeyboardEvent, Suspense, useEffect, useId, useRef, useState } from 'react';
import { messages } from '../i18n';
import type { WizardContext } from './context';
import { studioWorkspace } from './steps';

const KeysSheet = lazy(() => import('./KeysSheet').then((m) => ({ default: m.KeysSheet })));

interface Item {
  readonly id: 'new' | 'open' | 'save' | 'studio-tab' | 'switch' | 'palette' | 'prefs' | 'keys' | 'about';
  readonly label: string;
}

export function MoreMenu(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const f = messages().frame;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const project = useRef<HTMLInputElement>(null);
  const id = useId();

  const items: readonly Item[] = [
    { id: 'new', label: f.menuNew },
    { id: 'open', label: f.menuOpen },
    { id: 'save', label: f.menuSave },
    { id: 'studio-tab', label: f.menuStudioTab },
    { id: 'switch', label: f.menuSwitch },
    { id: 'palette', label: f.menuPalette },
    { id: 'prefs', label: f.menuPrefs },
    { id: 'keys', label: f.menuKeys },
    { id: 'about', label: f.menuAbout },
  ];
  const act = (item: Item['id']): void => {
    switch (item) {
      case 'new':
        void ctx.host.runFromUi('file.new').then((result) => {
          if (result.status !== 'finished') return;
          ctx.session.resetSubject({ character: null, meshes: [] });
          ctx.go('model');
        });
        return;
      case 'open':
        project.current?.click();
        return;
      case 'save':
        void ctx.host.runFromUi('file.save');
        return;
      case 'studio-tab':
        void ctx.host.navigation.go({
          to: 'studio',
          workspace: studioWorkspace(ctx.session.getState().step),
          from: 'autorig',
          newTab: true,
        });
        return;
      case 'switch':
        void ctx.host.navigation.go({ to: 'chooser' });
        return;
      case 'palette':
        openOverlay(ctx.app, 'commandPalette');
        return;
      case 'prefs':
        openDialog(ctx.host, 'preferences');
        return;
      case 'keys':
        setSheet(true);
        return;
      case 'about':
        openDialog(ctx.host, 'about');
        return;
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && (list.current?.contains(e.target) || trigger.current?.contains(e.target))) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', outside, { capture: true });
    return () => window.removeEventListener('pointerdown', outside, { capture: true });
  }, [open]);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => buttons[(to + buttons.length) % buttons.length]?.focus();
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(buttons.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

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
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open ? (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={f.more}
          className="absolute right-0 top-full z-(--z-popover) mt-1 flex min-w-56 flex-col rounded-popover border border-line bg-popover py-1 shadow-popover"
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="w-full px-3 py-1.5 text-left hover:bg-hover focus:bg-hover focus:outline-none pointer-coarse:min-h-11"
                data-menu={item.id}
                onClick={() => {
                  close();
                  act(item.id);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={project}
        type="file"
        accept=".ekzanim,.json,.glb,.vrm"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          ctx.files.handle(files);
        }}
      />
      {sheet ? (
        <Suspense fallback={null}>
          <KeysSheet ctx={ctx} onClose={() => setSheet(false)} />
        </Suspense>
      ) : null}
    </span>
  );
}
