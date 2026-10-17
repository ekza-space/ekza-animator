// Inline clip rename (Clips panel and Outliner, FR-OUT-04): validates while typing, Enter or blur commits through
// `clip.rename`, Esc cancels.
import type { ClipRecord } from '@ekza-animator/doc';
import type { EditorApp, PanelKind } from '@ekza-animator/editor-core';
import { type JSX, useEffect, useRef, useState } from 'react';
import { runOperator } from '../channel-box/kit/run';
import { INPUT, INVALID } from '../channel-box/kit/styles';
import { validateClipName } from './settings';

export interface ClipNameInputProps {
  readonly app: EditorApp;
  readonly panel: PanelKind;
  readonly clip: ClipRecord;
  /** Called once when editing ends (committed or cancelled). */
  readonly onDone: () => void;
  readonly className?: string | undefined;
}

export function ClipNameInput(props: ClipNameInputProps): JSX.Element {
  const { app, panel, clip, onDone } = props;
  const [text, setText] = useState(clip.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const otherNames = (): string[] =>
    app.store.query
      .clipsOfCharacter(clip.character)
      .filter((other) => other.id !== clip.id)
      .map((other) => other.name);
  const name = text.trim();
  const error = validateClipName(name, otherNames());

  const finish = (commit: boolean): void => {
    if (done.current) return;
    if (commit && error !== null) return;
    done.current = true;
    if (commit && name !== clip.name) void runOperator(app, panel, 'clip.rename', { clip: clip.id, name });
    onDone();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={text}
      maxLength={256}
      spellCheck={false}
      autoComplete="off"
      aria-label={`Rename clip ${clip.name}`}
      aria-invalid={error !== null}
      title={error ?? undefined}
      data-testid="clips-rename-input"
      data-invalid={error !== null ? 'true' : undefined}
      className={`${INPUT} w-full ${error !== null ? INVALID : ''} ${props.className ?? ''}`}
      onChange={(event) => setText(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(error === null)}
    />
  );
}
