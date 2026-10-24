// The Animations row (STUDIO-TOUCH-SPEC §10.6, §4.8; T7): one character holds several animations, and their chips sit
// above the Thread — one tap on a chip makes it the active animation (the Thread shows and plays it) *and* docks its
// Halo (Play, Loop it, Rename, Duplicate ▾, Settings, ⋯). Up to three chips show (wireframe C), the rest behind one
// `+n` chip that lists them all; then `+ New` (a name and a length of 1, 2 or 4 s), the ⟨Blend⟩ chip when the playhead
// sits between two keys of the selection, and `Library ▸`. Empty space's other verbs (Key all, All controls, Reset
// pose) and its ⋯ More are its long-press ring (ST-T7-2).
import type { ClipRecord } from '@ekza-studio/doc';
import { Cluster, TouchButton, TouchIconButton, ValueChip } from '@ekza-studio/ui/touch';
import { type EditorApp, loadTargetKit } from '@ekza-studio/editor-core';
import { type JSX, lazy, Suspense, useEffect, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { useDocumentVersion, useSessionValue } from '../../shell/hooks';
import { between, currentFrame, keyDots, threadContext } from '../../thread/strip/model';
import { useTimeUnit } from '../../thread/units';
import { AnimateGlyph } from './icons';
import {
  activeClip,
  animateCharacter,
  animationsOf,
  cleanClipName,
  newAnimationCall,
  newLengths,
  nextAnimationName,
  rowChips,
  sceneFps,
} from './model';
import { framesFromShown } from './TimeChip';
import { type AnimateUiStore, useAnimateUi } from './ui';

const NumpadPanel = lazy(() => import('../../chips/NumpadPanel'));

const w = animateWords.dock;

const chipClass =
  'inline-flex h-(--touch-hit) min-w-(--touch-hit) max-w-[200px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border border-line bg-panel px-4 text-touch font-medium text-fg-2 shadow-touch hover:text-fg active:bg-pressed aria-pressed:border-accent/60 aria-pressed:bg-accent-soft aria-pressed:text-fg';

function ClipChip({
  clip,
  active,
  onPress,
}: {
  readonly clip: ClipRecord;
  readonly active: boolean;
  readonly onPress: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={chipClass}
      aria-pressed={active}
      aria-haspopup="menu"
      data-testid={`halo-clip-chip-${clip.name}`}
      data-clip={clip.id}
      onClick={onPress}
    >
      <span className="truncate">{clip.name}</span>
      {active ? <AnimateGlyph name="down" size={16} /> : null}
    </button>
  );
}

/** A game target's slot that has no animation yet (CHARACTER-CONTRACT-SPEC §8.7, C2): *+ New* can make it. */
interface OpenSlot {
  readonly slot: string;
  readonly label: string;
}

/** The open slots of the character's bound target (loads the target chunk only when the document has a target). */
function useOpenSlots(app: EditorApp, character: string | null): readonly OpenSlot[] {
  const [slots, setSlots] = useState<readonly OpenSlot[]>([]);
  useEffect(() => {
    let alive = true;
    let bound = false;
    try {
      bound = character !== null && app.store.list('ekza.targets' as never).length > 0;
    } catch {
      bound = false;
    }
    if (!bound || character === null) return undefined;
    void loadTargetKit(app).then(
      (kit) => {
        if (!alive) return;
        const rows = kit.slotStatuses(app, character as never)?.rows ?? [];
        setSlots(
          rows
            .filter((row) => row.status.kind === 'missing' || row.status.kind === 'default')
            .filter((row) => {
              try {
                return (
                  app.operators.poll(
                    'target.slot.create',
                    { panel: 'viewport' },
                    {
                      character,
                      slot: row.slot,
                      from: 'blank',
                    },
                  ) === true
                );
              } catch {
                return false;
              }
            })
            .slice(0, 4)
            .map((row) => ({ slot: row.slot, label: row.label })),
        );
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [app, character]);
  return slots;
}

/** *+ New*'s card (§10.6): a name (typed or the next free one) and the length; a length chip makes the animation. */
function NewAnimationCard({
  controller,
  ui,
  clips,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly clips: readonly ClipRecord[];
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const [name, setName] = useState('');
  const placeholder = nextAnimationName(clips, w.namePlaceholder);
  const slots = useOpenSlots(app, animateCharacter(app));
  const makeSlot = async (slot: string): Promise<void> => {
    store.set((s) => ({ touches: s.touches + 1 }));
    const character = animateCharacter(app);
    if (character === null) return;
    const result = await ctx.run('target.slot.create', { character, slot, from: 'blank' });
    if (result.status === 'finished') ui.set({ newCard: false, docked: null });
  };
  const units = useTimeUnit(controller);
  const fps = sceneFps(app);
  const lengths = newLengths(units, fps);
  const [other, setOther] = useState(false);
  const create = async (frames: number): Promise<void> => {
    store.set((s) => ({ touches: s.touches + 1 }));
    const character = animateCharacter(app);
    if (character === null) return;
    const chosen = cleanClipName(name) === '' ? placeholder : cleanClipName(name);
    const call = newAnimationCall(character, chosen, frames);
    const result = await ctx.run(call.op, call.args);
    if (result.status === 'finished') ui.set({ newCard: false, docked: null });
  };
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-new-animation"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of controls, not a form (<fieldset>)
      role="group"
      aria-label={w.newTitle}
      className="pointer-events-auto flex flex-wrap items-center gap-2 p-[5px] pl-3"
    >
      <span className="font-medium text-fg">{w.newTitle}</span>
      <label className="flex min-w-[180px] flex-1 items-center gap-2">
        <span className="sr-only">{w.nameLabel}</span>
        <input
          className="h-(--touch-hit) min-w-0 flex-1 rounded-touch-inner border border-line bg-field px-3 text-(length:--touch-input-text) text-fg placeholder:text-fg-3"
          value={name}
          placeholder={placeholder}
          maxLength={64}
          aria-label={w.nameLabel}
          data-testid="halo-new-name"
          // one filled text field is one touch (§9)
          onPointerDown={() => store.set((s) => ({ touches: s.touches + 1 }))}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create(lengths.find((length) => length.primary)?.frames ?? 60);
            if (e.key === 'Escape') ui.set({ newCard: false });
          }}
        />
      </label>
      <span className="text-fg-3" aria-hidden="true">
        {w.lengthLabel}
      </span>
      {lengths.map((length) => {
        const label = units === 'frames' ? w.frames(length.shown) : w.seconds(length.shown);
        const spoken = units === 'frames' ? w.framesLong(length.shown) : w.secondsLong(length.shown);
        return (
          <TouchButton
            key={length.shown}
            variant={length.primary ? 'primary' : 'default'}
            data-testid={`halo-new-length-${length.shown}`}
            aria-label={`${w.lengthLabel} ${spoken}: ${w.lengthHint}`}
            onClick={() => void create(length.frames)}
          >
            {label}
          </TouchButton>
        );
      })}
      <span className="relative inline-flex">
        <TouchButton
          aria-expanded={other}
          data-testid="halo-new-length-other"
          onClick={() => {
            store.set((s) => ({ touches: s.touches + 1 }));
            setOther(!other);
          }}
        >
          {w.other}
        </TouchButton>
        {other ? (
          <Suspense fallback={null}>
            <NumpadPanel
              label={w.otherTitle}
              value={units === 'frames' ? 60 : 2}
              unit={units === 'frames' ? 'f' : 's'}
              min={units === 'frames' ? 1 : 0.01}
              max={units === 'frames' ? 100_000 : 3600}
              data-testid="halo-new-length-numpad"
              style={{ position: 'absolute', right: 0, bottom: '100%', marginBottom: 8 }}
              onDone={(value) => {
                setOther(false);
                void create(framesFromShown(value, fps, units));
              }}
              onCancel={() => setOther(false)}
            />
          </Suspense>
        ) : null}
      </span>
      <TouchIconButton
        label={w.close}
        icon={<AnimateGlyph name="close" />}
        data-testid="halo-new-close"
        onClick={() => ui.set({ newCard: false })}
      />
      {slots.length > 0 ? (
        <div className="flex w-full flex-wrap items-center gap-2" data-testid="halo-new-slots">
          <span className="text-fg-3">{w.forSlot}</span>
          {slots.map((slot) => (
            <TouchButton
              key={slot.slot}
              data-testid={`halo-new-slot-${slot.slot}`}
              onClick={() => void makeSlot(slot.slot)}
            >
              {slot.label}
            </TouchButton>
          ))}
        </div>
      ) : null}
    </Cluster>
  );
}

/** ⟨Blend 50 %⟩ (§10.3): between two keys of the selection; lifting runs `key.tween` once (one undo step). */
function BlendChip({ controller }: { readonly controller: HaloController }): JSX.Element | null {
  const { ctx } = controller;
  const { app } = ctx;
  useSessionValue(app, (s) => s.time.sceneFrame);
  useSessionValue(app, (s) => s.selection.controls);
  const playing = useSessionValue(app, (s) => s.time.playing);
  useDocumentVersion(app);
  const [value, setValue] = useState(50);
  const thread = threadContext(app);
  if (thread === null || playing) return null;
  const { dots, faint } = keyDots(app, thread);
  if (faint || between(dots, currentFrame(app, thread)) === null) return null;
  return (
    <ValueChip
      label={animateWords.thread.blend}
      value={value}
      step={1}
      unit="%"
      min={-25}
      max={125}
      data-testid="halo-blend"
      className="shrink-0"
      onChange={setValue}
      onCommit={(next) => {
        ctx.store.set((s) => ({ touches: s.touches + 1 }));
        setValue(50);
        void ctx.run('key.tween', { mode: 'tween', amount: Math.round((next - 50) * 2), target: 'frame' });
      }}
    />
  );
}

/** Every animation of the character (the `+n` chip's list). */
function AllClips({
  clips,
  active,
  onPick,
}: {
  readonly clips: readonly ClipRecord[];
  readonly active: string | null;
  readonly onPick: (clip: ClipRecord) => void;
}): JSX.Element {
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-all-clips"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of controls, not a form (<fieldset>)
      role="group"
      aria-label={w.othersTitle}
      className="pointer-events-auto flex flex-wrap items-center gap-1.5 p-[5px]"
    >
      {clips.map((clip) => (
        <ClipChip key={clip.id} clip={clip} active={clip.id === active} onPress={() => onPick(clip)} />
      ))}
    </Cluster>
  );
}

export function AnimationsRow({
  controller,
  ui,
  compact,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly compact: boolean;
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  useDocumentVersion(app);
  useSessionValue(app, (s) => s.activeClip);
  const newCard = useAnimateUi(ui, (s) => s.newCard);
  const allClips = useAnimateUi(ui, (s) => s.allClips);
  const character = animateCharacter(app);
  const clips = animationsOf(app, character);
  const active = activeClip(app, character);
  const { shown, folded } = rowChips(clips, active?.id ?? null, compact ? 1 : undefined);
  const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
  const pick = (clip: ClipRecord): void => {
    count();
    ui.set({
      docked: { kind: 'clip', clip: clip.id },
      menu: null,
      more: null,
      settings: null,
      newCard: false,
      allClips: false,
    });
    if (clip.id !== active?.id) void ctx.run('clip.setActive', { clip: clip.id });
  };
  return (
    <div className="flex flex-col items-stretch gap-2">
      {newCard ? <NewAnimationCard controller={controller} ui={ui} clips={clips} /> : null}
      {allClips ? <AllClips clips={clips} active={active?.id ?? null} onPick={pick} /> : null}
      <div
        className="pointer-events-auto flex w-full min-w-0 flex-wrap items-center gap-1.5"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of controls, not a form (<fieldset>)
        role="group"
        aria-label={w.animations}
        data-testid="halo-animations"
        data-halo-chrome=""
      >
        {compact ? null : (
          <span className="shrink-0 px-1 text-touch-label text-fg-3" aria-hidden="true">
            {w.animations}
          </span>
        )}
        {shown.map((clip) => (
          <ClipChip key={clip.id} clip={clip} active={clip.id === active?.id} onPress={() => pick(clip)} />
        ))}
        {folded > 0 ? (
          <button
            type="button"
            className={chipClass}
            aria-expanded={allClips}
            aria-label={w.othersTitle}
            data-testid="halo-clip-others"
            onClick={() => {
              count();
              ui.set({ allClips: !allClips, newCard: false });
            }}
          >
            {w.others(folded)}
          </button>
        ) : null}
        <button
          type="button"
          className={chipClass}
          aria-expanded={newCard}
          aria-label={w.newTitle}
          data-testid="halo-new"
          onClick={() => {
            count();
            ui.set({ newCard: !newCard, allClips: false, docked: null, menu: null });
          }}
        >
          <AnimateGlyph name="plus" size={18} />
          {w.newChip}
        </button>
        <BlendChip controller={controller} />
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          className={chipClass}
          aria-label={w.library}
          data-testid="halo-library"
          onClick={() => {
            count();
            void ctx.run('library.open');
            store.set({ sheet: 'library', sheetArgs: null, sheetNoun: null, halo: null, focus: null });
          }}
        >
          <AnimateGlyph name="library" size={18} />
          {compact ? null : w.library}
          {compact ? null : <AnimateGlyph name="right" size={16} />}
        </button>
      </div>
    </div>
  );
}
