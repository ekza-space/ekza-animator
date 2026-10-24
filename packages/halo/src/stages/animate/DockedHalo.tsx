// The Halo of a Thread noun, docked (STUDIO-TOUCH-SPEC §6.1, §6.2, §10.3, §10.6; T7): a key dot, the key band, the
// playhead or an animation chip. In the Thread the Halo never floats over the keys it edits: it docks as one row above
// the Animations row, with ⋯ More pinned at its end (the More sheet of that noun, from the Disclosure Manifest). The
// petals are the verb table's (`verbs/table.ts`, slot order, ≤ 6), each one tap; a ▾ petal opens its choices in a row
// under it. Every action is an operator run through the shell's `ctx.run` (a pre-run form where the operator has one
// and the verb needs its numbers: *Delete time…*).
import type { ClipRecord } from '@ekza-studio/doc';
import { type EditorApp, PANEL } from '@ekza-studio/editor-core';
import { Cluster, TouchButton, TouchIconButton, VerbBar, type VerbItem } from '@ekza-studio/ui/touch';
import { type JSX, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { NounKind } from '../../manifest/types';
import type { HaloController } from '../../shell/controller';
import { useDocumentVersion, useSessionValue } from '../../shell/hooks';
import { PANE } from '../../shell/stage';
import { useHaloStore } from '../../shell/store';
import { threadContext, timeText } from '../../thread/strip/model';
import type { TimeUnit } from '../../thread/units';
import { PETAL_VARIANTS, type PetalChoice, type PetalDef, petalsFor } from '../../verbs/table';
import { ClipSettings } from './ClipSettings';
import { AnimateGlyph, type AnimateIcon } from './icons';
import { animateCharacter, controlsOf, loopItCall, type OpCall, swapSidesCalls } from './model';
import { threadNoun } from './sheetContext';
import { type AnimateUiStore, type DockNoun, useAnimateUi } from './ui';

const w = animateWords;

/** A petal as the docked Halo runs it: one call, several in order, a ▾ menu, or a local action. */
type Action =
  | { readonly calls: readonly OpCall[]; readonly close?: boolean }
  | { readonly menu: readonly { readonly label: string; readonly calls: readonly OpCall[] }[] }
  | { readonly local: () => void }
  | { readonly form: OpCall };

interface DockPetal {
  readonly id: string;
  readonly label: string;
  readonly icon: AnimateIcon;
  readonly action: Action;
  /** The operator whose poll greys the petal (§6.3). */
  readonly poll?: OpCall;
  readonly changed?: boolean;
}

const ICON: Readonly<Record<string, AnimateIcon>> = {
  ease: 'ease',
  inBetween: 'between',
  copy: 'copy',
  paste: 'paste',
  delete: 'delete',
  allKeysHere: 'columns',
  move: 'move',
  stretch: 'stretch',
  holdPose: 'hold',
  insertFrame: 'insert',
  removeFrame: 'remove',
  deleteTime: 'scissors',
  setRange: 'brackets',
  play: 'play',
  loop: 'repeat',
  rename: 'rename',
  duplicate: 'duplicate',
  settings: 'settings',
};

const choiceCalls = (choices: readonly PetalChoice[], labels?: Readonly<Record<string, string>>) =>
  choices.map((choice) => {
    const arg = (choice.args as Record<string, string> | undefined) ?? {};
    const label = labels?.[arg['type'] ?? arg['mode'] ?? ''] ?? choice.plain;
    return { label, calls: [{ op: choice.op, ...(choice.args === undefined ? {} : { args: choice.args }) }] };
  });

/** The petals of a noun in slot order, with their in-place variants (§6.1: Paste after Copy). */
function tablePetals(app: EditorApp, kind: NounKind): readonly PetalDef[] {
  const petals = [...petalsFor(kind, 'animate')];
  for (const variant of PETAL_VARIANTS[kind] ?? []) {
    const active = variant.when === 'keysCopied' ? app.session.getState().clipboard.keys !== null : false;
    if (!active) continue;
    const index = petals.findIndex((petal) => petal.id === variant.replaces);
    if (index !== -1) petals[index] = variant;
  }
  return petals;
}

/** Clip frames → scene frames of the playback range (`time.setPlaybackRange` takes scene frames). */
function sceneRange(app: EditorApp, band: { start: number; end: number }): { start: number; end: number } | null {
  const thread = threadContext(app);
  if (thread === null) return null;
  const scene = app.store.get('project', 'project')?.sceneFps ?? thread.fps;
  const per = (scene.num * thread.fps.den) / (scene.den * thread.fps.num);
  return {
    start: thread.clip.sceneStart + band.start * per,
    end: thread.clip.sceneStart + band.end * per,
  };
}

function keysAtFrame(app: EditorApp, frame: number): { key: string }[] {
  const thread = threadContext(app);
  if (thread === null) return [];
  const controls = new Set(controlsOf(app, thread.character).map((control) => control.id));
  const base = app.store.query.baseLayer(thread.clip.id);
  const out: { key: string }[] = [];
  for (const curve of app.store.query.curvesOfClip(thread.clip.id)) {
    if (curve.layer !== base?.id || !controls.has(curve.control)) continue;
    for (const key of app.store.query.keysOfCurve(curve.id))
      if (Math.abs(key.t - frame) < 0.5) out.push({ key: key.id });
  }
  return out;
}

function petalsOf(
  app: EditorApp,
  noun: DockNoun,
  ui: AnimateUiStore,
  clip: ClipRecord | null,
  inBetween: boolean,
): readonly DockPetal[] {
  const band = app.session.getState().time.band;
  const out: DockPetal[] = [];
  const kind: NounKind = noun.kind;
  for (const petal of tablePetals(app, kind)) {
    const icon = ICON[petal.id] ?? 'key';
    const one = (calls: readonly OpCall[], extra: Partial<DockPetal> = {}, close = false): DockPetal => ({
      id: petal.id,
      label: petal.plain,
      icon,
      action: { calls, close },
      ...(calls[0] === undefined ? {} : { poll: calls[0] }),
      ...extra,
    });
    switch (`${kind}:${petal.id}`) {
      case 'keyDot:ease':
        out.push({
          id: petal.id,
          label: w.key.ease,
          icon,
          action: { menu: choiceCalls(petal.menu ?? [], w.key.eases) },
          poll: { op: 'graph.tangent.set', args: { type: 'auto' } },
        });
        break;
      case 'keyDot:inBetween':
        out.push(
          one([{ op: 'key.convert', args: { to: inBetween ? 'key' : 'breakdown' } }], { label: w.key.inBetween }),
        );
        break;
      case 'keyDot:copy':
      case 'band:copy':
        out.push(one([{ op: 'graph.keys.copy' }], { label: w.key.copy }));
        break;
      case 'keyDot:paste':
        out.push({
          id: petal.id,
          label: w.key.paste,
          icon,
          changed: true,
          action: { menu: choiceCalls(petal.menu ?? [], w.key.pastes) },
          poll: { op: 'graph.keys.paste' },
        });
        break;
      case 'keyDot:delete':
      case 'band:delete':
        out.push(one([{ op: 'graph.keys.delete' }], { label: w.key.delete }, true));
        break;
      case 'keyDot:allKeysHere':
        out.push({
          id: petal.id,
          label: w.key.allHere,
          icon,
          action: {
            local: () => {
              if (noun.kind !== 'keyDot') return;
              void app.runUntyped(
                'select.keys',
                { items: keysAtFrame(app, noun.frame), mode: 'replace' },
                { panel: PANEL.viewport, paneId: PANE },
              );
            },
          },
        });
        break;
      case 'band:move':
        out.push({
          id: petal.id,
          label: w.band.move,
          icon,
          poll: { op: 'graph.keys.move', args: { dFrames: 1, dValue: 0 } },
          action: {
            menu:
              band === null
                ? []
                : ([-1, 1] as const).map((d) => ({
                    label: d < 0 ? w.keys.nudgeBack : w.keys.nudgeOn,
                    calls: [
                      { op: 'graph.keys.move', args: { dFrames: d, dValue: 0 } },
                      {
                        op: 'time.selectBand',
                        args: { band: { start: band.start + d, end: band.end + d }, mode: 'replace' },
                      },
                    ],
                  })),
          },
        });
        break;
      case 'band:stretch':
        out.push({
          id: petal.id,
          label: w.band.stretch,
          icon,
          ...(band === null ? {} : { poll: { op: 'graph.keys.scale', args: { pivot: band.start, factor: 2 } } }),
          action: {
            menu:
              band === null || band.end <= band.start
                ? []
                : ([0.5, 2] as const).map((factor) => ({
                    label: `×${factor}`,
                    calls: [
                      { op: 'graph.keys.scale', args: { pivot: band.start, factor } },
                      {
                        op: 'time.selectBand',
                        args: {
                          band: { start: band.start, end: band.start + Math.round((band.end - band.start) * factor) },
                          mode: 'replace',
                        },
                      },
                    ],
                  })),
          },
        });
        break;
      case 'band:holdPose':
        out.push(one([{ op: 'pose.hold' }], { label: w.band.holdPose }));
        break;
      case 'playhead:paste':
        out.push({
          id: petal.id,
          label: w.playhead.pasteKeys,
          icon,
          action: { menu: choiceCalls(petal.menu ?? [], w.key.pastes) },
          poll: { op: 'graph.keys.paste' },
        });
        break;
      case 'playhead:insertFrame':
        out.push(one([{ op: 'time.insertTime', args: { frames: 1 } }], { label: w.playhead.insertFrame }));
        break;
      case 'playhead:removeFrame':
        out.push(
          one([{ op: 'time.insertTime', args: { frames: -1, removeKeys: true } }], { label: w.playhead.removeFrame }),
        );
        break;
      case 'playhead:deleteTime':
        out.push({
          id: petal.id,
          label: w.playhead.deleteTime,
          icon,
          action: { form: { op: 'time.deleteTime' } },
          poll: { op: 'time.deleteTime' },
        });
        break;
      case 'playhead:setRange': {
        const range = band === null ? null : sceneRange(app, band);
        out.push(one([{ op: 'time.setPlaybackRange', args: { range } }], { label: w.playhead.setRange }));
        break;
      }
      case 'clip:play':
        if (clip !== null) {
          out.push(
            one([{ op: 'clip.setActive', args: { clip: clip.id } }, { op: 'time.togglePlay' }], {
              label: w.clip.play,
              poll: { op: 'time.togglePlay' },
            }),
          );
        }
        break;
      case 'clip:loop':
        if (clip !== null) out.push(one([loopItCall(clip.id)], { label: w.clip.loopIt }));
        break;
      case 'clip:rename':
        if (clip !== null) {
          out.push({
            id: petal.id,
            label: w.clip.rename,
            icon,
            action: { local: () => ui.set({ renaming: clip.id, menu: null }) },
          });
        }
        break;
      case 'clip:duplicate':
        if (clip !== null) {
          out.push({
            id: petal.id,
            label: w.clip.duplicate,
            icon,
            poll: { op: 'clip.duplicate', args: { clip: clip.id } },
            action: {
              menu: [
                { label: w.clip.plain, calls: [{ op: 'clip.duplicate', args: { clip: clip.id } }] },
                { label: w.clip.swapSides, calls: swapSidesCalls(app, clip) },
              ],
            },
          });
        }
        break;
      case 'clip:settings':
        out.push({ id: petal.id, label: w.clip.settings, icon, action: { local: () => undefined } });
        break;
      default:
        break;
    }
  }
  return out;
}

function pollOf(app: EditorApp, call: OpCall | undefined): string | undefined {
  if (call === undefined) return undefined;
  if (app.operators.get(call.op) === undefined) return 'Not available here yet';
  try {
    const result = app.operators.poll(call.op, { panel: PANEL.viewport, paneId: PANE }, call.args);
    return result === true ? undefined : result.reason;
  } catch {
    return undefined;
  }
}

/** The title of a docked noun ("Wave", "Key at 0.50 s", "0.50 s – 1.00 s", "At 0.50 s"). */
function titleOf(app: EditorApp, noun: DockNoun, clip: ClipRecord | null, units: TimeUnit): string {
  const thread = threadContext(app);
  const fps = thread?.fps ?? { num: 30, den: 1 };
  switch (noun.kind) {
    case 'clip':
      return clip?.name ?? '';
    case 'keyDot':
      return `${w.key.title(1)} · ${timeText(noun.frame, fps, units)}`;
    case 'band': {
      const band = app.session.getState().time.band;
      return band === null ? '' : w.band.title(timeText(band.start, fps, units), timeText(band.end, fps, units));
    }
    case 'playhead':
      return w.playhead.title(timeText(app.evaluation.clipFrame(thread?.character ?? ('' as never)) ?? 0, fps, units));
  }
}

function RenameRow({
  controller,
  ui,
  clip,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly clip: ClipRecord;
}): JSX.Element {
  const { ctx } = controller;
  const [name, setName] = useState(clip.name);
  const save = (): void => {
    ctx.store.set((s) => ({ touches: s.touches + 1 }));
    ui.set({ renaming: null });
    if (name.trim() !== '' && name.trim() !== clip.name)
      void ctx.run('clip.rename', { clip: clip.id, name: name.trim() });
  };
  return (
    <div className="flex items-center gap-2 px-1" data-testid="halo-clip-rename">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-fg-3">{w.clip.renameTitle}</span>
        <input
          className="h-(--touch-hit) min-w-0 flex-1 rounded-touch-inner border border-line bg-field px-3 text-(length:--touch-input-text) text-fg"
          value={name}
          maxLength={64}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens on the person's own tap of *Rename*
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') ui.set({ renaming: null });
          }}
        />
      </label>
      <TouchButton variant="primary" onClick={save} data-testid="halo-clip-rename-save">
        {w.clip.save}
      </TouchButton>
    </div>
  );
}

export function DockedHalo({
  controller,
  ui,
  compact = false,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  /** A phone-sized frame: the title gives its room to the petals (the noun is the group's name). */
  readonly compact?: boolean;
}): JSX.Element | null {
  const { ctx } = controller;
  const { app, store } = ctx;
  useDocumentVersion(app);
  useSessionValue(app, (s) => s.time.band);
  useSessionValue(app, (s) => s.selection.keys);
  useSessionValue(app, (s) => s.clipboard);
  useSessionValue(app, (s) => s.time.sceneFrame);
  useHaloStore(store, (s) => s.stage);
  const docked = useAnimateUi(ui, (s) => s.docked);
  const menu = useAnimateUi(ui, (s) => s.menu);
  const renaming = useAnimateUi(ui, (s) => s.renaming);
  const settings = useAnimateUi(ui, (s) => s.settings);
  const units = useAnimateUi(ui, (s) => s.units);
  if (docked === null) return null;
  const clip = docked.kind === 'clip' ? (app.store.get('clips', docked.clip) ?? null) : null;
  if (docked.kind === 'clip' && clip === null) return null;
  const thread = threadContext(app);
  const dot =
    docked.kind === 'keyDot' && thread !== null
      ? keysAtFrame(app, docked.frame).every((k) => app.store.get('keys', k.key as never)?.breakdown === true)
      : false;
  const petals = petalsOf(app, docked, ui, clip, dot);
  const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
  const runCalls = async (calls: readonly OpCall[]): Promise<void> => {
    for (const call of calls) {
      const result = await ctx.run(call.op, call.args);
      if (result.status !== 'finished') return;
    }
  };
  const select = (id: string): void => {
    const petal = petals.find((p) => p.id === id);
    if (petal === undefined) return;
    const { action } = petal;
    if ('menu' in action) {
      count();
      ui.set({ menu: menu === id ? null : id });
      return;
    }
    count();
    ui.set({ menu: null });
    if ('local' in action) {
      if (docked.kind === 'clip' && id === 'settings') {
        // the clip settings in the animation's own Halo (§10.6): fps, range, loop, travel, contact, tags
        ui.set({ settings: ui.get().settings === docked.clip ? null : docked.clip });
        return;
      }
      action.local();
      return;
    }
    if ('form' in action) {
      // the shell's pre-run form (§5.6): its chips with ✓ to run
      store.set({
        form: { op: action.form.op, ...(action.form.args === undefined ? {} : { args: action.form.args }) },
      });
      return;
    }
    void runCalls(action.calls).then(() => {
      if (action.close === true) ui.set({ docked: null });
    });
  };
  const open = petals.find((p) => p.id === menu);
  const items: VerbItem[] = petals.map((petal) => {
    const reason = pollOf(app, petal.poll);
    return {
      id: petal.id,
      label: petal.label,
      icon: <AnimateGlyph name={petal.icon} />,
      ...('menu' in petal.action ? { hasMenu: true } : {}),
      ...(reason === undefined ? {} : { disabledReason: reason }),
      ...(petal.changed === true ? { changed: true } : {}),
    };
  });
  const noun = threadNoun(
    docked.kind,
    docked.kind === 'clip' ? docked.clip : null,
    titleOf(app, docked, clip, units),
    animateCharacter(app),
  );
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-docked"
      data-noun={docked.kind}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of controls, not a form (<fieldset>)
      role="group"
      aria-label={noun.label}
      className="pointer-events-auto flex w-full flex-col items-stretch gap-1.5 p-[5px]"
    >
      {renaming !== null && clip !== null && renaming === clip.id ? (
        <RenameRow key={clip.id} controller={controller} ui={ui} clip={clip} />
      ) : clip !== null && settings === clip.id ? (
        // ST-T7-19: open Settings take the verbs' row (back, the title, ✕), so the Halo stays within 36 targets
        <div className="flex min-w-0 items-center gap-1.5">
          <TouchIconButton
            label={w.settings.back}
            icon={<AnimateGlyph name="back" />}
            data-testid="halo-clip-settings-back"
            onClick={() => {
              count();
              ui.set({ settings: null });
            }}
          />
          <span className="min-w-0 flex-1 truncate px-2 font-medium text-fg" data-testid="halo-docked-title">
            {compact ? w.clip.settings : `${w.clip.settings} · ${noun.label}`}
          </span>
          <TouchIconButton
            label={w.dock.close}
            icon={<AnimateGlyph name="close" />}
            data-testid="halo-docked-close"
            onClick={() => ui.set({ docked: null, menu: null, renaming: null, settings: null })}
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          {compact ? null : (
            <span className="max-w-[180px] shrink-0 truncate px-2 font-medium text-fg" data-testid="halo-docked-title">
              {noun.label}
            </span>
          )}
          <VerbBar
            className="min-w-0 flex-1"
            data-testid="halo-docked-verbs"
            label={noun.label}
            verbs={items}
            onSelect={select}
            onMore={() => {
              count();
              ui.set({ more: docked, menu: null });
            }}
            onReason={(_id, reason) => ctx.toasts.push({ key: 'reason', text: reason })}
          />
          <TouchIconButton
            label={w.dock.close}
            icon={<AnimateGlyph name="close" />}
            data-testid="halo-docked-close"
            onClick={() => ui.set({ docked: null, menu: null, renaming: null })}
          />
        </div>
      )}
      {clip !== null && settings === clip.id ? (
        <ClipSettings key={clip.id} controller={controller} clip={clip} />
      ) : null}
      {open !== undefined && 'menu' in open.action ? (
        <div
          role="menu"
          aria-label={open.label}
          className="flex flex-wrap items-center gap-1.5"
          data-testid="halo-docked-menu"
        >
          {open.action.menu.map((choice) => (
            <TouchButton
              key={choice.label}
              role="menuitem"
              data-testid={`halo-docked-choice-${choice.label}`}
              onClick={() => {
                count();
                ui.set({ menu: null });
                void runCalls(choice.calls);
              }}
            >
              {choice.label}
            </TouchButton>
          ))}
        </div>
      ) : null}
    </Cluster>
  );
}
