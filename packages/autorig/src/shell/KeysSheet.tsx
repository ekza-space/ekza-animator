// The Auto-Rig keyboard shortcuts sheet (AUTORIG-SPEC §8.1, §8.2; D3): the frame's rows and the step packages' rows of
// `AUTORIG_KEYMAP`, plus the shipped keys the wizard keeps (Esc, F, Shift+F). A lazy chunk (opened from `⋯`); a modal
// `<dialog>` (Esc closes it, the focus returns to the menu button).
import { buttonClass } from '@ekza-studio/ui';
import { type JSX, useEffect, useRef } from 'react';
import { messages } from '../i18n';
import { AUTORIG_KEYMAP } from '../keymap';
import type { WizardContext } from './context';
import { chordText } from './keys';

export function KeysSheet(props: { readonly ctx: WizardContext; readonly onClose: () => void }): JSX.Element {
  const f = messages().frame;
  const mac = props.ctx.app.keymap.platform === 'mac';
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  const describe = (run: (typeof AUTORIG_KEYMAP)[number]['run']): string | null => {
    if ('op' in run) return run.op === 'edit.undo' || run.op === 'edit.redo' ? f.keyUndo : run.op;
    if (run.action === 'primary') return f.keyPrimary;
    if (run.action === 'goto') return f.keyGoto;
    return null;
  };
  const rows = new Map<string, string[]>();
  for (const binding of AUTORIG_KEYMAP) {
    const text = describe(binding.run);
    if (text === null) continue;
    rows.set(text, [...(rows.get(text) ?? []), chordText(binding.chord, mac)]);
  }
  rows.set(f.keyEscape, ['Esc']);
  rows.set(f.keyFrame, ['F']);
  rows.set(f.keyFullscreen, [mac ? '⇧F' : 'Shift+F']);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="ar-keys-title"
      className="m-auto max-h-[90dvh] w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 overflow-auto rounded-dialog border border-line bg-popover p-4 text-fg shadow-popover backdrop:bg-scrim open:flex"
      data-testid="ar-keys-sheet"
      onClose={props.onClose}
    >
      <h2 id="ar-keys-title" className="text-dialog-title font-semibold">
        {f.keysTitle}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {[...rows].map(([text, chords]) => (
          <div key={text} className="contents">
            <dt className="font-mono">{chords.join(' · ')}</dt>
            <dd className="text-fg-2">{text}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className={buttonClass('default', 'md')} onClick={props.onClose}>
        {f.close}
      </button>
    </dialog>
  );
}
