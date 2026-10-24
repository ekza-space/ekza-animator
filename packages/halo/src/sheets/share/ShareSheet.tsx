// The Share sheet (STUDIO-TOUCH-SPEC §13.3, wireframe F of §4.2, §7.3, J1 steps 6–8, J6 step 3; T11): a sheet over any
// stage. The header's `For:` picks the destination (the Rig checks' profile follows it, as Health's chips do); the card
// says *Ready ✓* or *n things to fix* from the one readiness list (§7.2), fixes in its row what one operator fixes
// (the licence, an explicit choice with none pre-selected; the author, asked once) and sends hands-on problems to
// their stage (*Go fix ▸*). Choosing a card prepares its file at once (`./bake`); the export button names the file it
// writes and delivers it from its own tap (the two-step save of iOS). An export never clears the unsaved dot; its toast
// offers *Also save the project*. The footer shows the project's state and *Save project to Files*. Advanced ▾ holds
// the format, the profile and the export options; More formats ▸ the other files Studio Pro and Auto-Rig write.
import type { CharacterId } from '@ekza-studio/doc';
import { type EditorApp, prepareExport } from '@ekza-studio/editor-core';
import { isIosWebKit } from '@ekza-studio/editor/host';
import { Segmented, SheetGroup, ToggleChip, type ToastStore, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { en } from '../../i18n/en';
import { haloFlowHost } from '../../intake/flowHost';
import type { HaloSheetProps } from '../../manifest/sheets';
import { type DestinationId, DESTINATIONS, destinationOf } from '../../path/destinations';
import { readiness, type ReadinessRow } from '../../path/readiness';
import { profileSwitch } from '../health/model';
import { FieldRow, HaloSheet, useAppVersion } from '../more/kit';
import { type Baker, type BakeState, createBaker } from './bake';
import { GameTarget } from './GameTarget';
import {
  callKey,
  callProblem,
  DEFAULT_OPTIONS,
  destinationChoice,
  MORE_FORMATS,
  type MoreFormatId,
  moreFormatChoice,
  optionsFor,
  type ShareChoice,
  type ShareOptions,
  type ShareWords,
  shareSubject,
} from './model';

/** What the frame's Share host adds to a sheet's context (`../../home/start.ts`). */
export interface ShareShell {
  /** The journeys' touch counter (AS-ST-4). */
  readonly touch: () => void;
  readonly toasts: ToastStore;
  /** *Save project to Files* (the project menu's and the footer's): `file.save`, then the storage card. */
  readonly saveProject: () => Promise<void>;
  /** The author remembered on this device (asked once, §13.3). */
  readonly author: { readonly get: () => string | null; readonly set: (name: string) => void };
  /** Where the sheet keeps its baker, so a prepared file outlives the sheet (and the test API reads its state). */
  readonly holder: { baker: Baker | null };
  /** The storage card's state on this device (§17: after the first project save, iOS only). */
  readonly storage: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly get: () => StorageCard;
    readonly keep: () => Promise<void>;
    readonly dismiss: () => void;
  };
}

export type StorageCard = 'hidden' | 'keep' | 'homeScreen';

export type ShareSheetProps = HaloSheetProps & { readonly shell: ShareShell };

export const SHARE_WORDS: ShareWords = {
  noCharacter: en.share.problems.noCharacter,
  noScene: en.share.problems.noScene,
  madeHere: en.share.problems.madeHere,
  isVrm: en.share.problems.isVrm,
  notVrm: en.share.problems.notVrm,
  notVrm0: en.share.problems.notVrm0,
  notBound: en.share.problems.notBound,
};

const INPUT =
  'min-h-(--touch-hit) w-full rounded-touch border border-line bg-field px-3 text-[16px] text-fg placeholder:text-fg-3 aria-invalid:border-warn';

const LICENCES = [
  { value: 'cc0', label: 'Free for anyone (CC0)' },
  { value: 'cc-by-4.0', label: 'Credit me (CC BY 4.0)' },
  { value: 'personal', label: 'Personal use only' },
  { value: 'custom', label: 'Custom…' },
] as const;

const STAGE_NAME: Readonly<Record<string, string>> = {
  make: en.stage.make,
  paint: en.stage.paint,
  rig: en.stage.rig,
  animate: en.stage.animate,
  share: en.share.title,
};

function useBaker(baker: Baker): BakeState {
  return useSyncExternalStore(baker.subscribe, baker.get, baker.get);
}

/** A text field that commits once, on Enter or blur (a filled field counts one touch when tapped). */
function CommitField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly missing?: boolean;
  readonly testId: string;
  readonly onTouch: () => void;
  readonly onCommit: (text: string) => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<{ readonly of: string; readonly text: string }>({
    of: props.value,
    text: props.value,
  });
  const text = draft.of === props.value ? draft.text : props.value;
  const commit = (): void => {
    if (text.trim() !== props.value.trim()) props.onCommit(text.trim());
  };
  return (
    <div className="flex flex-col gap-1 px-2.5 py-1.5">
      <label htmlFor={id} className="font-medium text-fg">
        {props.label}
      </label>
      <input
        id={id}
        type="text"
        value={text}
        placeholder={props.placeholder}
        aria-invalid={props.missing === true || undefined}
        className={INPUT}
        data-testid={props.testId}
        onFocus={props.onTouch}
        onChange={(event) => setDraft({ of: props.value, text: event.currentTarget.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft({ of: props.value, text: props.value });
        }}
      />
      {props.hint === undefined ? null : (
        <span className={props.missing === true ? 'text-touch-label text-warn' : 'text-touch-label text-fg-3'}>
          {props.hint}
        </span>
      )}
    </div>
  );
}

/**
 * A row of choices as native radios (keyboard and screen readers for free), shown as chips: none chosen is allowed
 * (the licence starts unchosen, Q-SKIN-3); a choice acts at once. `wide` chips carry a second line.
 */
function ChoiceChips<T extends string>(props: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { readonly value: T; readonly label: string; readonly detail?: string }[];
  readonly testId: (value: T) => string;
  readonly wide?: boolean;
  readonly onChoose: (value: T) => void;
}): JSX.Element {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0" aria-label={props.label}>
      {props.options.map((option) => {
        const on = option.value === props.value;
        return (
          <label
            key={option.value}
            data-testid={props.testId(option.value)}
            data-checked={on || undefined}
            className={`flex cursor-pointer rounded-touch border px-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${props.wide === true ? 'min-h-[52px] min-w-[140px] flex-1 flex-col items-start justify-center py-1' : 'min-h-(--touch-hit) items-center text-touch font-medium'} ${on ? 'border-accent/60 bg-accent-soft text-fg' : 'border-line bg-field text-fg-2'}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={on}
              onChange={() => props.onChoose(option.value)}
              className="sr-only"
            />
            <span className={props.wide === true ? 'font-medium text-fg' : ''}>{option.label}</span>
            {option.detail === undefined ? null : <span className="text-touch-label text-fg-3">{option.detail}</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

/** The licence as an explicit choice (Q-SKIN-3, ST-40): *Free for anyone (CC0)* first, none pre-selected. */
function LicenceRow(props: { readonly value: string | null; readonly onChoose: (value: string) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 px-2.5 py-1.5" data-testid="halo-share-licence">
      <span className="font-medium text-fg">{props.value === null ? en.share.licence : en.share.licenceChosen}</span>
      <ChoiceChips
        label={en.share.licenceChosen}
        value={LICENCES.find((option) => option.value === props.value)?.value ?? null}
        options={LICENCES}
        testId={(value) => `halo-share-licence-${value}`}
        onChoose={props.onChoose}
      />
      {props.value === null ? <span className="text-touch-label text-warn">{en.share.licenceHint}</span> : null}
    </div>
  );
}

/** One problem of the card: its words and, when one operator fixes it, the fix in place; else *Go fix ▸*. */
function ProblemRow(props: {
  readonly row: ReadinessRow;
  readonly onFix: (row: ReadinessRow) => void;
  readonly onGo: (row: ReadinessRow) => void;
}): JSX.Element {
  const { row } = props;
  return (
    <div
      className="flex min-h-[52px] flex-wrap items-center gap-2 px-2.5 py-1.5"
      data-testid="halo-share-problem"
      data-code={row.code}
    >
      <span aria-hidden="true" className={row.severity === 'error' ? 'text-danger' : 'text-warn'}>
        ⚠
      </span>
      <span className="min-w-0 flex-1 text-fg">{row.text}</span>
      {row.fix !== null ? (
        <TouchButton data-op={row.fix.op} data-testid="halo-share-fix" onClick={() => props.onFix(row)}>
          {row.fix.label}
        </TouchButton>
      ) : row.stage === 'share' ? null : (
        <TouchButton variant="ghost" data-testid="halo-share-go" onClick={() => props.onGo(row)}>
          {en.share.goTo(STAGE_NAME[row.stage] ?? en.share.goFix)}
        </TouchButton>
      )}
    </div>
  );
}

/** The card's own words for the export button (§13.3: it names the file it writes). */
function exportLabel(state: BakeState, hasCall: boolean): string {
  if (!hasCall) return en.share.nothing;
  if (state.status === 'ready' && state.fileName !== null) return en.share.export(state.fileName);
  if (state.status === 'blocked') return en.share.fixFirst;
  if (state.status === 'failed') return en.share.tryAgain;
  return en.share.preparing(state.fileName);
}

interface ShareState {
  readonly subject: ReturnType<typeof shareSubject>;
  readonly choice: ShareChoice;
  readonly poll: string | null;
  readonly ready: ReturnType<typeof readiness>;
}

/**
 * The card's state, read again only when what it reads changed — the document, the character in hand, the selected
 * objects, the preferences, the card and its options — not on every time or selection change of a playing animation.
 */
const memo = new WeakMap<EditorApp, { readonly key: readonly unknown[]; readonly value: ShareState }>();
function shareState(
  app: EditorApp,
  destination: DestinationId,
  format: MoreFormatId | null,
  options: ShareOptions,
): ShareState {
  const s = app.session.getState();
  const key = [
    app.store.version,
    s.activeCharacter,
    s.rig.character,
    s.selection.objects,
    s.workspace,
    app.prefs.getState(),
    app.rig.loaded,
    destination,
    format,
    options,
  ];
  const hit = memo.get(app);
  if (hit !== undefined && hit.key.length === key.length && hit.key.every((v, i) => Object.is(v, key[i]))) {
    return hit.value;
  }
  const choice =
    format === null
      ? destinationChoice(app, destination, options, SHARE_WORDS)
      : moreFormatChoice(app, format, options, SHARE_WORDS);
  const value: ShareState = {
    subject: shareSubject(app),
    choice,
    poll: choice.call === null ? null : callProblem(app, choice.call),
    ready: readiness(app, destination),
  };
  memo.set(app, { key, value });
  return value;
}

/** *Try again* prepares the same call once more (a new key each time). */
let retries = 0;

/** The licence and author rows are answered in place: they never send anyone to a stage. */
const IN_PLACE = new Set(['vrm.licence-unset', 'vrm.meta-required']);

export default function ShareSheet({ ctx, shell }: ShareSheetProps): JSX.Element {
  const app: EditorApp = ctx.host.app;
  const version = useAppVersion(app);
  const destination = destinationOf(ctx.destination);
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_OPTIONS);
  const [format, setFormat] = useState<MoreFormatId | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [formats, setFormats] = useState(false);
  const [saving, setSaving] = useState(false);
  const storage = useSyncExternalStore(shell.storage.subscribe, shell.storage.get, shell.storage.get);
  const baker = useMemo(() => {
    shell.holder.baker ??= createBaker(app, (op, args) => ctx.run(op, args));
    return shell.holder.baker;
  }, [app, ctx, shell.holder]);
  const bake = useBaker(baker);
  // every render follows the document, the session and the preferences (`useAppVersion`): the subject, the call and
  // the one readiness list are read again (cheap, pure)
  const { subject, choice, poll, ready } = shareState(app, destination.id, format, options);
  // the card's rows: the one readiness list (Health and the status pill show the same count)
  const rows = ready.rows;
  const total = rows.length;
  // the gate is the export's own (its Validation and read-back lints, §13.3): a blocked file is never offered
  const unavailable = choice.call === null || poll !== null;
  const blocked = bake.status === 'blocked';
  const model = subject.character !== null && subject.kind === 'model' ? subject.character : null;
  const meta = model?.vrm ?? null;
  const preparedFor = useRef<string | null>(null);

  // §13.3: choosing a card prepares its file at once, and again when the document or the options change
  // the key is the call's arguments and the document's version: a selection or a time change prepares nothing
  const key = choice.call === null || poll !== null ? null : callKey(app, choice.call);
  const latest = useRef(choice.call);
  useEffect(() => {
    latest.current = choice.call;
  });
  useEffect(() => {
    const call = latest.current;
    if (key === null || call === null) {
      baker.clear();
      return;
    }
    const timer = setTimeout(() => baker.prepare(call, key), 120);
    return () => clearTimeout(timer);
  }, [baker, key]);

  // the first time a model character is shared (§13.3, Auto-Rig ⑤'s first entry): the automatic thumbnail and the
  // remembered author, one undo step each
  useEffect(() => {
    if (model === null || destination.id === 'exploring' || preparedFor.current === model.id) return;
    preparedFor.current = model.id;
    void prepareExport(haloFlowHost({ app, run: (op, args) => ctx.run(op, args) }), model, shell.author.get());
  }, [app, ctx, model, destination.id, shell.author]);

  const setMeta = (character: CharacterId, patch: Record<string, unknown>): void => {
    void ctx.run('char.setVrmMeta', { character, patch });
  };
  const chooseDestination = (id: DestinationId): void => {
    shell.touch();
    setFormat(null);
    ctx.setDestination(id);
    const switchProfile = profileSwitch(app, id);
    if (switchProfile !== null) void ctx.run(switchProfile.op, switchProfile.args);
  };
  const fix = (row: ReadinessRow): void => {
    shell.touch();
    if (row.fix !== null) void ctx.run(row.fix.op, row.fix.args);
  };
  const go = (row: ReadinessRow): void => {
    shell.touch();
    if (row.stage !== 'share') ctx.setStage(row.stage);
    ctx.close();
    if (row.show !== null) void ctx.run(row.show.op, row.show.args);
  };
  const exportNow = (): void => {
    shell.touch();
    if (bake.status === 'failed' && choice.call !== null) {
      retries += 1;
      baker.prepare(choice.call, `${callKey(app, choice.call)}#retry${retries}`);
      return;
    }
    void baker.deliver().then((how) => {
      if (how === null || how === 'cancelled') return;
      shell.toasts.push({
        key: 'share',
        text: how === 'shared' ? en.share.shared : en.share.downloaded(baker.get().fileName ?? ''),
        durationMs: 8000,
        action: { label: en.share.alsoSave, run: () => void shell.saveProject() },
      });
    });
  };
  const saveProject = (): void => {
    shell.touch();
    setSaving(true);
    void shell.saveProject().finally(() => setSaving(false));
  };

  const dirty = app.session.getState().dirty;
  const ios = isIosWebKit();
  const projectLine = dirty ? (ios ? en.share.projectDirtyIos : en.share.projectDirty) : en.share.projectClean;
  const applicable = optionsFor(choice.call);
  const exploring = destination.id === 'exploring' && format === null;
  const clips =
    subject.character === null
      ? []
      : app.store.query
          .clipsOfCharacter(subject.character.id)
          .filter((clip) => clip.deleted === null && clip.source.kind !== 'test');

  const footer = (
    <div className="flex w-full flex-col gap-2" data-testid="halo-share-footer">
      {exploring ? null : (
        <TouchButton
          variant="primary"
          className="w-full"
          disabled={unavailable || blocked || (bake.status !== 'ready' && bake.status !== 'failed')}
          data-testid="halo-share-export"
          data-state={unavailable ? 'unavailable' : bake.status}
          data-file={bake.fileName ?? ''}
          onClick={exportNow}
        >
          {exportLabel(bake, !unavailable)}
        </TouchButton>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-touch-label text-fg-3" data-testid="halo-share-project">
          {projectLine}
        </span>
        <TouchButton
          variant={exploring ? 'primary' : 'ghost'}
          disabled={saving}
          data-op="file.save"
          data-testid="halo-share-save"
          onClick={saveProject}
        >
          {saving ? en.share.saving : en.share.saveProject}
        </TouchButton>
      </div>
      {storage === 'hidden' ? null : (
        <div
          className="flex flex-col gap-2 rounded-touch-card border border-line bg-panel p-3"
          data-testid="halo-share-storage"
          data-card={storage}
        >
          <p className="m-0 text-touch text-fg">{storage === 'keep' ? en.share.keepTitle : en.share.homeScreen}</p>
          {storage === 'keep' ? <p className="m-0 text-touch-label text-fg-3">{en.share.keepText}</p> : null}
          <div className="flex flex-wrap gap-2">
            {storage === 'keep' ? (
              <TouchButton variant="primary" data-testid="halo-share-keep" onClick={() => void shell.storage.keep()}>
                {en.share.keepAction}
              </TouchButton>
            ) : null}
            <TouchButton variant="ghost" onClick={() => shell.storage.dismiss()}>
              {en.share.dismiss}
            </TouchButton>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <HaloSheet
      ctx={ctx}
      id="share"
      title={en.share.title}
      description={exploring ? en.share.pickFirst : `For ${destination.name}`}
      footer={footer}
    >
      <div className="flex flex-col gap-1" data-testid="halo-share-body" data-destination={destination.id}>
        <SheetGroup>{en.share.forWhat}</SheetGroup>
        <div className="px-2.5 pb-1">
          <ChoiceChips<DestinationId>
            label={en.share.forWhat}
            value={format === null ? destination.id : null}
            options={DESTINATIONS.map((d) => ({
              value: d.id,
              label: d.name,
              detail: en.share.destinations[d.id] ?? '',
            }))}
            testId={(value) => `halo-share-dest-${value}`}
            wide
            onChoose={chooseDestination}
          />
        </div>

        {exploring ? (
          <section className="flex flex-col gap-2 px-2.5 py-2" data-testid="halo-share-exploring">
            <p className="m-0 text-fg-2">{en.share.exploringText}</p>
          </section>
        ) : (
          <section
            className="mx-2.5 flex flex-col gap-1 rounded-touch-card border border-line bg-panel py-1.5"
            data-testid="halo-share-card"
            data-call={choice.call?.op ?? ''}
            aria-label={format === null ? destination.name : (en.share.formats[format]?.[0] ?? format)}
          >
            <div className="flex flex-wrap items-center gap-2 px-2.5">
              <span className="min-w-0 flex-1 font-semibold text-fg">
                {format === null ? destination.name : (en.share.formats[format]?.[0] ?? format)}
              </span>
              {total === 0 && unavailable ? null : (
                <output
                  className={total === 0 ? 'text-touch-label text-ok' : 'text-touch-label text-warn'}
                  data-testid="halo-share-status"
                  data-total={total}
                >
                  {total === 0 ? `${en.share.ready} ✓` : en.share.toFix(total)}
                </output>
              )}
            </div>
            {format === null ? null : (
              <TouchButton variant="ghost" className="mx-2.5 self-start" onClick={() => setFormat(null)}>
                {en.share.back}
              </TouchButton>
            )}
            {choice.problem !== null && choice.problem !== '' ? (
              <div
                className="flex min-h-[52px] flex-wrap items-center gap-2 px-2.5"
                data-testid="halo-share-unavailable"
              >
                <span aria-hidden="true" className="text-warn">
                  ⚠
                </span>
                <span className="min-w-0 flex-1 text-fg">{choice.problem}</span>
                {choice.go?.stage !== undefined ? (
                  <TouchButton
                    variant="ghost"
                    onClick={() => {
                      shell.touch();
                      ctx.setStage(choice.go?.stage ?? 'rig');
                      ctx.close();
                    }}
                  >
                    {en.share.goTo(STAGE_NAME[choice.go.stage] ?? '')}
                  </TouchButton>
                ) : choice.go?.destination !== undefined ? (
                  <TouchButton variant="ghost" onClick={() => chooseDestination(choice.go?.destination ?? 'omoba')}>
                    {en.share.goTo(destinationOf(choice.go.destination).name)}
                  </TouchButton>
                ) : null}
              </div>
            ) : null}
            {poll === null ? null : (
              <div className="flex min-h-[52px] items-center gap-2 px-2.5" data-testid="halo-share-refused">
                <span aria-hidden="true" className="text-warn">
                  ⚠
                </span>
                <span className="min-w-0 flex-1 text-fg">{poll}</span>
              </div>
            )}
            {rows
              .filter((row) => !(model !== null && IN_PLACE.has(row.code)))
              .map((row) => (
                <ProblemRow key={row.id} row={row} onFix={fix} onGo={go} />
              ))}
            {model === null ? null : (
              <>
                <LicenceRow
                  value={meta?.licensePreset ?? null}
                  onChoose={(value) => {
                    shell.touch();
                    setMeta(model.id, { licensePreset: value });
                  }}
                />
                <CommitField
                  label={en.share.author}
                  hint={en.share.authorHint}
                  value={(meta?.authors ?? []).filter((a) => a.trim() !== '').join(', ')}
                  missing={(meta?.authors ?? []).every((a) => a.trim() === '')}
                  testId="halo-share-author"
                  onTouch={shell.touch}
                  onCommit={(text) => {
                    const authors = text
                      .split(',')
                      .map((a) => a.trim())
                      .filter((a) => a !== '');
                    if (authors.length > 0) shell.author.set(authors[0] as string);
                    setMeta(model.id, { authors });
                  }}
                />
                <CommitField
                  label={en.share.name}
                  value={meta?.name ?? model.name}
                  testId="halo-share-name"
                  onTouch={shell.touch}
                  onCommit={(text) => {
                    if (text !== '') setMeta(model.id, { name: text });
                  }}
                />
                <FieldRow label={en.share.thumbnail} pro={en.share.thumbnailAuto}>
                  <TouchButton
                    variant="ghost"
                    data-testid="halo-share-about"
                    onClick={() => {
                      shell.touch();
                      ctx.open('about');
                    }}
                  >
                    {en.share.about}
                  </TouchButton>
                </FieldRow>
              </>
            )}
            {model !== null && destination.id === 'omoba' && format === null ? (
              <GameTarget
                app={app}
                character={model.id}
                bound={subject.bound}
                version={version}
                run={(op, args) => void ctx.run(op, args)}
                touch={shell.touch}
              />
            ) : null}
            {subject.character === null ? null : (
              <div className="flex flex-col gap-1 px-2.5 py-1.5" data-testid="halo-share-animations">
                <span className="font-medium text-fg">{en.share.animations}</span>
                {clips.length === 0 ? (
                  <span className="text-touch-label text-fg-3">{en.share.noAnimations}</span>
                ) : (
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {clips.map((clip) => (
                      <li
                        key={clip.id}
                        className="rounded-touch border border-line bg-field px-2.5 py-1 text-touch-label text-fg-2"
                      >
                        {clip.name}
                        {clip.slot === null || clip.slot === '' ? ` · ${en.share.noSlot}` : ' ✓'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        <button
          type="button"
          className="flex min-h-[52px] items-center gap-2 px-2.5 text-left"
          aria-expanded={advanced}
          aria-label={`${en.share.advanced}: ${en.share.advancedDetail}`}
          data-testid="halo-share-advanced"
          onClick={() => setAdvanced((open) => !open)}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-fg">{en.share.advanced} ▾</span>
            <span className="text-touch-label text-fg-3">{en.share.advancedDetail}</span>
          </span>
        </button>
        {advanced && choice.call !== null ? (
          <section className="flex flex-col gap-1" data-testid="halo-share-advanced-body">
            <FieldRow label={en.share.format}>
              <span className="text-fg-2" data-testid="halo-share-format">
                {choice.call.format}
              </span>
            </FieldRow>
            <FieldRow label={en.share.profile}>
              <span className="text-fg-2" data-testid="halo-share-profile">
                {choice.call.profile ?? en.share.noProfile}
              </span>
            </FieldRow>
            {applicable.includes('reduce') ? (
              <FieldRow label={en.share.reduce} pro={en.share.reduceHint}>
                <ToggleChip
                  label={(options.reduce ?? app.prefs.getState().exportReduce.enabled) ? 'On' : 'Off'}
                  pressed={options.reduce ?? app.prefs.getState().exportReduce.enabled}
                  onPressedChange={(pressed) => setOptions((o) => ({ ...o, reduce: pressed }))}
                  data-testid="halo-share-opt-reduce"
                />
              </FieldRow>
            ) : null}
            {applicable.includes('closeLoop') ? (
              <FieldRow label={en.share.closeLoop} pro={en.share.closeLoopHint}>
                <ToggleChip
                  label={options.closeLoop === false ? 'Off' : 'Auto'}
                  pressed={options.closeLoop !== false}
                  onPressedChange={(pressed) => setOptions((o) => ({ ...o, closeLoop: pressed ? null : false }))}
                  data-testid="halo-share-opt-close"
                />
              </FieldRow>
            ) : null}
            {applicable.includes('constantTracks') ? (
              <FieldRow label={en.share.constantTracks}>
                <ToggleChip
                  label={options.constantTracks ? 'On' : 'Off'}
                  pressed={options.constantTracks}
                  onPressedChange={(pressed) => setOptions((o) => ({ ...o, constantTracks: pressed }))}
                  data-testid="halo-share-opt-constant"
                />
              </FieldRow>
            ) : null}
            {applicable.includes('acknowledge') ? (
              <FieldRow label={en.share.acknowledge} pro={en.share.acknowledgeHint}>
                <ToggleChip
                  label={options.acknowledge ? 'On' : 'Off'}
                  pressed={options.acknowledge}
                  onPressedChange={(pressed) => setOptions((o) => ({ ...o, acknowledge: pressed }))}
                  data-testid="halo-share-opt-ack"
                />
              </FieldRow>
            ) : null}
            {applicable.includes('material') ? (
              <div className="px-2.5 py-1.5">
                <Segmented<'each' | 'unlit' | 'lit'>
                  label={en.share.material}
                  value={options.material ?? 'each'}
                  onValueChange={(value) => setOptions((o) => ({ ...o, material: value === 'each' ? null : value }))}
                  items={[
                    { value: 'each', label: en.share.materialEach },
                    { value: 'unlit', label: en.share.unlit },
                    { value: 'lit', label: en.share.lit },
                  ]}
                  data-testid="halo-share-opt-material"
                />
              </div>
            ) : null}
            {applicable.includes('colourOutput') ? (
              <div className="px-2.5 py-1.5">
                <Segmented<'each' | 'palette-texture' | 'vertex-colour' | 'material-per-colour'>
                  label={en.share.colours}
                  value={options.colourOutput ?? 'each'}
                  onValueChange={(value) =>
                    setOptions((o) => ({ ...o, colourOutput: value === 'each' ? null : value }))
                  }
                  items={[
                    { value: 'each', label: en.share.coloursEach },
                    { value: 'palette-texture', label: en.share.paletteTexture },
                    { value: 'vertex-colour', label: en.share.vertexColours },
                    { value: 'material-per-colour', label: en.share.materialPerColour },
                  ]}
                  data-testid="halo-share-opt-colours"
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <button
          type="button"
          className="flex min-h-[52px] items-center gap-2 px-2.5 text-left"
          aria-expanded={formats}
          aria-label={`${en.share.moreFormats}: ${en.share.moreFormatsDetail}`}
          data-testid="halo-share-more-formats"
          onClick={() => setFormats((open) => !open)}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-fg">{en.share.moreFormats} ▸</span>
            <span className="text-touch-label text-fg-3">{en.share.moreFormatsDetail}</span>
          </span>
        </button>
        {formats ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="halo-share-formats">
            {MORE_FORMATS.map((id) => {
              const other = moreFormatChoice(app, id, options, SHARE_WORDS);
              const [label, detail] = en.share.formats[id] ?? [id, ''];
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={other.call === null}
                    aria-pressed={format === id}
                    data-testid={`halo-share-format-${id}`}
                    data-op={other.call?.op ?? ''}
                    className={`flex min-h-[52px] w-full flex-col items-start justify-center px-2.5 text-left disabled:opacity-50 ${format === id ? 'bg-accent-soft' : ''}`}
                    onClick={() => {
                      shell.touch();
                      setFormat(id);
                    }}
                  >
                    <span className="font-medium text-fg">{label}</span>
                    <span className="text-touch-label text-fg-3">{other.problem ?? detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {bake.lints.length === 0 ? null : (
          <ul className="m-0 flex list-none flex-col gap-0.5 px-2.5 py-1.5" data-testid="halo-share-lints">
            {bake.lints
              .filter((lint) => lint.severity !== 'info')
              .map((lint) => (
                <li key={`${lint.code}:${lint.message}`} className="text-touch-label text-fg-2" data-code={lint.code}>
                  {lint.severity === 'error' ? '⚠ ' : '· '}
                  {lint.message}
                </li>
              ))}
          </ul>
        )}
        {bake.status === 'failed' && bake.reason !== null ? (
          <p className="m-0 px-2.5 text-touch-label text-danger" role="alert" data-testid="halo-share-failed">
            {bake.reason}
          </p>
        ) : null}
      </div>
    </HaloSheet>
  );
}
