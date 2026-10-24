// The Thumb key on screen (STUDIO-TOUCH-SPEC §5.5, §18): the kit's 56 px key with its two lines — what the next tap and
// the next drag will do here (`modifierMap`) — shown only when it means something; the chooser (slide up) offers the
// row's other meanings. A lock shows a chip and a canvas-edge tint (§5.5: *Select more · on ✕*). The latch lives in
// the shell's store, so the input stage reads the same state the key shows (P13).
import type { EditorApp } from '@ekza-studio/editor-core';
import { ActionChip, type ThumbEvent, ThumbKey, thumbReduce } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import { useDocumentVersion, useSessionValue } from '../shell/hooks';
import { type HaloStore, useHaloStore } from '../shell/store';
import { currentRow, meaningsOf } from './situation';

export function ThumbKeyView({
  app,
  store,
}: {
  readonly app: EditorApp;
  readonly store: HaloStore;
}): JSX.Element | null {
  // re-read on selection, tool and shell changes (the row is derived)
  useSessionValue(app, (s) => s.selection);
  useSessionValue(app, (s) => s.tools.viewport);
  useSessionValue(app, (s) => s.model);
  useDocumentVersion(app);
  const thumb = useHaloStore(store, (s) => s.thumb);
  useHaloStore(store, (s) => s.stage);
  useHaloStore(store, (s) => s.sheet);
  useHaloStore(store, (s) => s.hardwareModifier);
  const pick = useHaloStore(store, (s) => s.thumbPick);
  const row = currentRow(app, store);
  if (row === null) return null;
  const { tap, drag, chosen } = meaningsOf(row, pick);
  const dispatch = (event: ThumbEvent): void => store.set({ thumb: thumbReduce(store.get().thumb, event) });
  const locked = thumb.latch === 'locked';
  const lockedLabel = tap?.label ?? drag?.label ?? '';
  return (
    <div className="flex flex-col items-start gap-2" data-halo-chrome="">
      {locked ? (
        <ActionChip
          data-testid="halo-thumb-lock"
          icon={<Icon name="close" size={16} />}
          aria-label={`${en.thumb.lockedChip(lockedLabel)}. ${en.thumb.unlock}`}
          onClick={() => dispatch({ type: 'key', time: performance.now() })}
        >
          {en.thumb.lockedChip(lockedLabel)}
        </ActionChip>
      ) : null}
      <ThumbKey
        data-testid="halo-thumb"
        state={thumb}
        dispatch={dispatch}
        {...(tap === undefined ? {} : { tap: { glyph: tap.glyph, label: tap.label } })}
        {...(drag === undefined ? {} : { drag: { glyph: drag.glyph, label: drag.label } })}
        choices={row.choices.map((c) => ({
          id: c.id,
          glyph: c.glyph,
          label: c.label,
          proName: c.proName,
          on: chosen?.id === c.id,
        }))}
        onChoose={(id) => {
          const meaning = row.choices.find((c) => c.id === id);
          if (meaning === undefined) return;
          store.set({ thumbPick: { row: row.id, meaning: meaning.id } });
          if (store.get().thumb.latch === 'off') dispatch({ type: 'key', time: performance.now() });
        }}
      />
    </div>
  );
}
