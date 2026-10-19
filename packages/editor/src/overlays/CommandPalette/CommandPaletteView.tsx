// The command palette's list UI (M6A-SPEC §5.18, §8.10 `cmdk`, `cmdk-input`, `cmdk-item-<operatorId>`; B9): a lazy
// chunk. A search field over the filtered entries with their key labels and the reasons of the disabled ones;
// ↑/↓ move, Enter runs (or opens the inline prompt of an operator with params: Tab moves between its fields), Esc
// or a click outside closes.
import { cn } from '@ekza-animator/ui';
import { type JSX, type KeyboardEvent, useEffect, useRef } from 'react';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { CommandPaletteController, PaletteEntry } from './controller';

/** Rows drawn at most (the rest is reached by typing). */
const MAX_ROWS = 200;

function Row(props: {
  readonly entry: PaletteEntry;
  readonly active: boolean;
  readonly onChoose: () => void;
  readonly onHover: () => void;
}): JSX.Element {
  const { entry } = props;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [props.active]);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the input's keys choose (↑/↓, Enter)
    <li
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- a combobox's listbox: <option> cannot hold key labels and reasons
      role="option"
      aria-selected={props.active}
      aria-disabled={!entry.enabled}
      data-testid={entry.testId}
      data-enabled={entry.enabled ? 'true' : 'false'}
      className={cn(
        'flex cursor-default items-center gap-2 rounded px-2 py-1 text-ui',
        props.active ? 'bg-[var(--bg-pressed,#3a3d46)] text-fg' : 'text-fg-2',
        !entry.enabled && 'text-fg-3',
      )}
      onPointerMove={props.onHover}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onChoose}
    >
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.reason === null ? null : (
        <span className="max-w-[45%] truncate text-ui-dense text-fg-3">{entry.reason}</span>
      )}
      {entry.shortcut === null ? null : <kbd className="text-ui-dense text-fg-3">{entry.shortcut}</kbd>}
    </li>
  );
}

export function CommandPaletteView(props: { readonly controller: CommandPaletteController }): JSX.Element {
  const { controller } = props;
  const query = useStoreSelector(controller.state, (s) => s.query);
  const index = useStoreSelector(controller.state, (s) => s.index);
  const prompt = useStoreSelector(controller.state, (s) => s.prompt);
  useStoreSelector(controller.state, (s) => s.entries);
  const input = useRef<HTMLInputElement>(null);
  const items = controller.items();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [prompt?.entry.key, prompt?.field]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (prompt === null) controller.close();
      else controller.setQuery(query); // back to the list
    } else if (prompt !== null && event.key === 'Tab') {
      event.preventDefault();
      controller.nextField(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (prompt === null) controller.choose();
      else controller.submitPrompt();
    } else if (prompt === null && event.key === 'ArrowDown') {
      event.preventDefault();
      controller.move(1);
    } else if (prompt === null && event.key === 'ArrowUp') {
      event.preventDefault();
      controller.move(-1);
    }
  };

  const field = prompt?.entry.params.find((param) => param.name === prompt.field) ?? null;
  return (
    <div
      className="fixed inset-0 z-(--z-dialog)"
      data-testid="cmdk-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) controller.close();
      }}
    >
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal palette over the editor; <dialog> would trap the page's keys
        role="dialog"
        aria-label="Command palette"
        data-testid="cmdk"
        className="absolute left-1/2 top-[12%] flex max-h-[70vh] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-1 rounded-dialog border border-line bg-popover p-2 shadow-popover"
      >
        {prompt === null ? null : (
          <div className="flex items-center gap-2 px-1 text-ui text-fg-2" data-testid="cmdk-prompt">
            <span className="font-semibold text-fg">{prompt.entry.label}</span>
            <span>·</span>
            {prompt.entry.params.map((param) => (
              <span key={param.name} className={param.name === prompt.field ? 'text-accent-text' : undefined}>
                {param.label} {prompt.values[param.name] ?? ''}
              </span>
            ))}
          </div>
        )}
        <input
          ref={input}
          data-testid="cmdk-input"
          className="h-8 w-full rounded border border-line bg-[var(--bg-input,#1f2024)] px-2 text-ui text-fg outline-none focus:border-accent"
          placeholder={field === null ? 'Search commands…' : `${field.label}`}
          aria-label={field === null ? 'Search commands' : field.label}
          value={prompt === null ? query : (prompt.values[prompt.field] ?? '')}
          onChange={(event) =>
            prompt === null ? controller.setQuery(event.target.value) : controller.setField(event.target.value)
          }
          onKeyDown={onKeyDown}
        />
        {prompt?.error === null || prompt?.error === undefined ? null : (
          <p className="px-1 text-ui-dense text-danger" role="alert">
            {prompt.error}
          </p>
        )}
        {prompt !== null ? null : (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- the combobox's listbox (see Row)
          <ul role="listbox" aria-label="Commands" className="min-h-0 overflow-y-auto" data-testid="cmdk-list">
            {items.length === 0 ? (
              <li className="px-2 py-1 text-ui text-fg-3">No matching command</li>
            ) : (
              items.slice(0, MAX_ROWS).map((entry, i) => (
                <Row
                  key={entry.key}
                  entry={entry}
                  active={i === index}
                  onHover={() => {
                    if (i !== controller.state.getState().index) controller.state.setState({ index: i });
                  }}
                  onChoose={() => controller.choose(entry)}
                />
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CommandPaletteView;
