// ⑤ Export view (AUTORIG-SPEC §5.6; D6), a lazy chunk. Over the pane, the left column of the §5.6 mock: the targets
// as one radio group (the OMOBA kit under *For developers*), *Continue in Studio ▸*, and for a model character's VRM
// the avatar metadata (C10's `VrmMetaFields`) and its thumbnail (C10's `ThumbnailPreview`) — every edit one operator
// run. In the side panel, the checklist of the target (`./labels`: plain sentences over `characterExportRows` and,
// after a download, the written file's byte rows and measures), each error with its row's Fix, and the OMOBA notes.
// The footer's primary is *Download* (`autorig.export`): disabled while an error row is open; a blocking byte lint
// saves nothing and the column shows it. *Publish to Ekza Hub* is absent (§5.6.5, `./hub`).
import { ThumbnailPreview, useCharacterRows, VrmMetaFields } from '@ekza-studio/editor/bodies';
import {
  type AutoRigExportResult,
  type AutoRigExportTarget,
  type EditorApp,
  isModelCharacter,
  type RigValidationRow,
} from '@ekza-studio/editor-core';
import { buttonClass, cn, RadioGroup, RadioGroupItem } from '@ekza-studio/ui';
import type { CharacterRecord, ClipRecord } from '@ekza-studio/doc';
import { type JSX, type MouseEvent, useCallback, useEffect, useState } from 'react';
import { messages } from '../../i18n';
import { useDocument, useSession, type WizardContext } from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import { type SmallStore, smallStore, useSmall } from '../../shell/store';
import type { AutoRigSession } from '../../types';
import { rememberAuthor } from './author';
import { exportCharacter } from './enter';
import { expectedFileName } from './files';
import { publishToHub } from './hub';
import { type ChecklistItem, checklistOf, firstError } from './labels';
import { clipName, freeSlots, leftOutClips, suggestedSlot } from './leftOut';
import { fileSize, measureArtifact } from './measure';
import { chooseTarget, currentDownload, recordDownload, shownTarget } from './slice';
import './strings';

const t = (): ReturnType<typeof messages>['export'] => messages().export;
const coarse = 'pointer-coarse:min-h-11';
const SPACE = 'ekza/space-avatar-v1';
const LOCAL = 'local/generic';
const TARGETS: readonly AutoRigExportTarget[] = ['ekza-vrm', 'glb', 'vrma', 'omoba-kit'];
/** Studio's Animate workspace (*Continue in Studio*: same-page switch through the navigation port, §5.6.6). */
const STUDIO_ANIMATE = '/editor?ws=animate';
const selectExport = (s: AutoRigSession): AutoRigSession['export'] => s.export;

// ---------------------------------------------------------------------------------------------------------------------
// the step's own U state (per wizard): the last download and the For developers disclosure

interface LastDownload {
  readonly character: string;
  readonly target: AutoRigExportTarget;
  /** The document version it was written from (a later edit makes its byte rows stale: they are dropped). */
  readonly version: number;
  readonly result: AutoRigExportResult;
  readonly saved: boolean;
  readonly bytes: number | null;
}

interface ExportUi {
  readonly last: LastDownload | null;
  readonly developers: boolean;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<ExportUi>>();

function exportUi(ctx: Pick<WizardContext, 'session'>): SmallStore<ExportUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<ExportUi>({ last: null, developers: false });
    uis.set(ctx.session, store);
  }
  return store;
}

// ---------------------------------------------------------------------------------------------------------------------
// what the step reads

/** Re-renders once the rig-workspace chunk is there (the export operator and the Validation rows live in it). */
function useRigLoaded(app: EditorApp): boolean {
  const [loaded, setLoaded] = useState(app.rig.loaded);
  useEffect(() => {
    if (app.rig.loaded) return;
    let live = true;
    app.rig
      .load()
      .then(() => live && setLoaded(true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [app]);
  return loaded || app.rig.loaded;
}

/** The targets the subject character can export to now (the operator's poll), in the step's order. */
function availableTargets(app: EditorApp, record: CharacterRecord | null): readonly AutoRigExportTarget[] {
  if (record === null || app.operators.get('autorig.export') === undefined) return [];
  return TARGETS.filter(
    (target) =>
      app.operators.poll('autorig.export', undefined, { character: record.id, target, fileName: '' }) === true,
  );
}

interface ExportView {
  readonly record: CharacterRecord | null;
  readonly model: boolean;
  readonly available: readonly AutoRigExportTarget[];
  readonly target: AutoRigExportTarget | null;
  readonly clips: number;
  /** The export name of the first exportable clip (its slot, else its name), or null. */
  readonly firstClip: string | null;
  /** Why the recommended target (VRM, or GLB for a glTF avatar) is not offered, or null (§5.6.1, AR-D6-19). */
  readonly unavailable: string | null;
  /** The exportable clips, in the document's order. */
  readonly clipRecords: readonly ClipRecord[];
  /** An imported VRM 0.x avatar: its bake keeps the version (AR-D8-5). */
  readonly vrm0: boolean;
}

/** The recommended target of a character: the Ekza avatar, or the GLB for an imported glTF avatar. */
const recommendedOf = (record: CharacterRecord): AutoRigExportTarget =>
  isModelCharacter(record) || record.format !== 'gltf' ? 'ekza-vrm' : 'glb';

/** The poll's reason when the recommended target is unavailable, else null. */
function unavailableReason(app: EditorApp, record: CharacterRecord | null): string | null {
  if (record === null || app.operators.get('autorig.export') === undefined) return null;
  const poll = app.operators.poll('autorig.export', undefined, {
    character: record.id,
    target: recommendedOf(record),
    fileName: '',
  });
  return poll === true ? null : poll.reason;
}

function useExportView(ctx: WizardContext): ExportView {
  const { app } = ctx;
  const rigLoaded = useRigLoaded(app);
  const slice = useSession(ctx.session, selectExport);
  const record = useDocument(app, () => exportCharacter(ctx));
  const available = useDocument(app, () => (rigLoaded ? availableTargets(app, record) : []));
  const clipRecords = useDocument(app, () =>
    record === null
      ? []
      : app.store.query
          .clipsOfCharacter(record.id)
          .filter(
            (clip) =>
              clip.deleted === null &&
              clip.source.kind !== 'test' &&
              (clip.source.kind !== 'new' || app.store.list('curves').some((curve) => curve.clip === clip.id)),
          ),
  );
  const names = clipRecords.map(clipName);
  const unavailable = useDocument(app, () => (rigLoaded ? unavailableReason(app, record) : null));
  return {
    record,
    model: record !== null && isModelCharacter(record),
    available,
    target: shownTarget(slice, available),
    clips: names.length,
    firstClip: names[0] ?? null,
    unavailable,
    clipRecords,
    vrm0: record !== null && !isModelCharacter(record) && record.format === 'vrm0',
  };
}

/** Why nothing can be exported: the plain no-clips line, else the recommended target's reason. */
function noTargetsText(view: ExportView): string {
  const m = t();
  if (view.record === null) return m.hintNoCharacter;
  return view.clips === 0 || view.unavailable === null ? m.noTargets : m.noTargetsBecause(view.unavailable);
}

/** The display name the file is named after (as `autorig.export` names it). */
const avatarName = (record: CharacterRecord): string =>
  (isModelCharacter(record) ? (record.vrm?.name ?? '').trim() : '') || record.name;

// ---------------------------------------------------------------------------------------------------------------------
// over the pane: targets, Continue in Studio, metadata

function TargetLabel(props: {
  readonly target: AutoRigExportTarget;
  readonly vrm0?: boolean;
  readonly clips?: number;
}): JSX.Element {
  const m = t();
  if (props.target === 'ekza-vrm') {
    return (
      <>
        {props.vrm0 === true ? m.targetVrm0 : m.targetVrm} <span className="text-fg-3">{m.targetVrmRecommended}</span>
      </>
    );
  }
  if (props.target === 'glb') return <>{props.clips === 0 ? m.targetGlbRigged : m.targetGlb}</>;
  return <>{props.target === 'vrma' ? m.targetVrma : m.targetKit}</>;
}

function hintOf(target: AutoRigExportTarget, view: ExportView): string {
  const m = t();
  switch (target) {
    case 'ekza-vrm':
      return view.vrm0 ? m.targetVrm0Hint : m.targetVrmHint;
    case 'glb':
      return m.targetGlbHint;
    case 'vrma':
      return m.targetVrmaHint(
        view.clips,
        view.record === null ? '' : expectedFileName('vrma', avatarName(view.record), view.clips, view.firstClip),
      );
    case 'omoba-kit':
      return m.targetKitHint;
  }
}

function ContinueInStudio(props: { readonly ctx: WizardContext }): JSX.Element {
  const m = t();
  const go = (newTab: boolean): void => {
    void props.ctx.host.navigation.go({
      to: 'studio',
      workspace: 'animate',
      from: 'autorig',
      ...(newTab ? { newTab: true } : {}),
    });
  };
  return (
    <p className="text-fg-2">
      {m.continueStudio}{' '}
      <a
        href={STUDIO_ANIMATE}
        className="font-semibold text-accent-text underline-offset-2 hover:underline"
        data-testid="ar-export-continue-studio"
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          go(e.metaKey || e.ctrlKey || e.shiftKey);
        }}
        onAuxClick={(e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          go(true);
        }}
      >
        {m.continueStudioLink} ▸
      </a>
    </p>
  );
}

function Targets(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const m = t();
  const view = useExportView(ctx);
  const ui = useSmall(exportUi(ctx));
  const developers = ui.developers || view.target === 'omoba-kit';
  const main = view.available.filter((target) => target !== 'omoba-kit');
  const kit = view.available.includes('omoba-kit');
  const meta = view.model && view.record !== null && (view.target === 'ekza-vrm' || view.target === 'omoba-kit');
  return (
    <div className="pointer-events-none absolute inset-0 overflow-auto p-3">
      <section
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-dialog border border-line bg-panel/95 p-4"
        aria-labelledby="ar-export-targets-title"
        data-testid="ar-export-targets"
      >
        <h2 id="ar-export-targets-title" className="font-semibold uppercase tracking-wide text-fg-2">
          {m.targetsTitle}
        </h2>
        {view.target === null ? (
          <p className="text-fg-2" data-testid="ar-export-no-targets">
            {noTargetsText(view)}
          </p>
        ) : (
          <RadioGroup
            value={view.target}
            aria-label={m.targetsLabel}
            onValueChange={(value) => chooseTarget(ctx.session, value as AutoRigExportTarget)}
          >
            {main.map((target) => (
              <RadioGroupItem
                key={target}
                value={target}
                label={<TargetLabel target={target} vrm0={view.vrm0} clips={view.clips} />}
                hint={hintOf(target, view)}
                className={coarse}
                data-testid={`ar-export-target-${target}`}
              />
            ))}
            {kit ? (
              <button
                type="button"
                className={cn(buttonClass('ghost', 'sm'), 'self-start', coarse)}
                aria-expanded={developers}
                data-testid="ar-export-developers"
                onClick={() => exportUi(ctx).set((current) => ({ ...current, developers: !developers }))}
              >
                {developers ? '▾' : '▸'} {m.developers}
              </button>
            ) : null}
            {kit && developers ? (
              <RadioGroupItem
                value="omoba-kit"
                label={<TargetLabel target="omoba-kit" />}
                hint={hintOf('omoba-kit', view)}
                className={coarse}
                data-testid="ar-export-target-omoba-kit"
              />
            ) : null}
          </RadioGroup>
        )}
        {view.target !== null && view.record !== null && view.unavailable !== null && view.clips > 0 ? (
          <p className="text-ui-dense text-fg-2" data-testid="ar-export-unavailable">
            {m.unavailable(recommendedOf(view.record) === 'glb' ? m.targetGlb : m.targetVrm, view.unavailable)}
          </p>
        ) : null}
        {view.record !== null &&
        recommendedOf(view.record) === 'ekza-vrm' &&
        (view.target === null ||
          view.target === 'ekza-vrm' ||
          view.target === 'omoba-kit' ||
          view.unavailable !== null) ? (
          <LeftOut ctx={ctx} model={view.model} clips={view.clipRecords} />
        ) : null}
        <ContinueInStudio ctx={ctx} />
        {meta && view.record !== null ? <AboutAvatar ctx={ctx} character={view.record.id} /> : null}
      </section>
    </div>
  );
}

/**
 * The clips the VRM leaves out (AR-D8-2): each with its fix — the suggested free slot in one click, or any free slot
 * from the list (`clip.setSettings`, one undo step). The GLB and the .vrma keep every clip.
 */
function LeftOut(props: {
  readonly ctx: WizardContext;
  readonly model: boolean;
  readonly clips: readonly ClipRecord[];
}): JSX.Element | null {
  const { ctx, clips } = props;
  const m = t();
  const out = leftOutClips(props.model, clips);
  if (out.length === 0) return null;
  const free = freeSlots(clips);
  const setSlot = (clip: ClipRecord, slot: string): void => {
    void ctx.run('clip.setSettings', { clip: clip.id, slot });
  };
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-3" data-testid="ar-export-left-out">
      <p className="font-semibold text-warn">{m.leftOutTitle(out.length)}</p>
      <p className="text-ui-dense text-fg-2">{m.leftOutHint}</p>
      <ul className="flex flex-col gap-1">
        {out.map((clip) => {
          const suggested = suggestedSlot(clip, free);
          return (
            <li
              key={clip.id}
              className="flex flex-wrap items-center gap-2"
              data-testid={`ar-export-left-out-${clip.id}`}
            >
              <span className="min-w-0 flex-1 truncate">{clip.name}</span>
              {suggested === null ? null : (
                <button
                  type="button"
                  className={cn(buttonClass('default', 'sm'), coarse)}
                  data-testid={`ar-export-left-out-as-${clip.id}`}
                  onClick={() => setSlot(clip, suggested)}
                >
                  {m.leftOutAs(suggested)}
                </button>
              )}
              {free.length === 0 ? (
                <span className="text-fg-3">{m.leftOutNoFree}</span>
              ) : (
                <select
                  className="h-7 min-w-0 rounded-field border border-line bg-field px-1 text-fg pointer-coarse:h-11"
                  aria-label={m.leftOutPickLabel(clip.name)}
                  value=""
                  data-testid={`ar-export-left-out-slot-${clip.id}`}
                  onChange={(e) => {
                    if (e.target.value !== '') setSlot(clip, e.target.value);
                  }}
                >
                  <option value="">{m.leftOutPick}</option>
                  {free.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AboutAvatar(props: { readonly ctx: WizardContext; readonly character: CharacterRecord['id'] }): JSX.Element {
  const { ctx, character } = props;
  const m = t();
  const run = useCallback((op: string, args: unknown) => ctx.run(op, args), [ctx]);
  return (
    <section
      className="flex flex-col gap-3 border-t border-line pt-3"
      aria-labelledby="ar-export-about-title"
      data-testid="ar-export-meta"
    >
      <h2 id="ar-export-about-title" className="font-semibold uppercase tracking-wide text-fg-2">
        {m.aboutTitle}
      </h2>
      <VrmMetaFields app={ctx.app} character={character} compact run={run} />
      <div className="flex flex-col gap-1">
        <span className="text-fg-2">{m.thumbnail}</span>
        <ThumbnailPreview app={ctx.app} character={character} run={run} size={96} testId="ar-export-thumb" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the side panel: the checklist and the notes

const GLYPH: Readonly<Record<ChecklistItem['state'], string>> = {
  ok: '✓',
  pending: '·',
  error: '✗',
  warning: '!',
  info: 'i',
};
const TONE: Readonly<Record<ChecklistItem['state'], string>> = {
  ok: 'text-ok',
  pending: 'text-fg-3',
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-fg-3',
};
const STATE_TEXT: Readonly<Record<ChecklistItem['state'], () => string>> = {
  ok: () => t().stateOk,
  pending: () => t().statePending,
  error: () => t().stateError,
  warning: () => t().stateWarning,
  info: () => t().stateInfo,
};

/** The meta rows the fields beside the checklist fix (§5.6.3): their Fix focuses the field (no Studio dialog). */
const FIELD_FIX: Readonly<Record<string, { readonly label: () => string; readonly selector: string }>> = {
  'vrm.meta-required': { label: () => messages().export.fixAuthor, selector: '[data-testid="vrm-meta-authors"]' },
  'vrm.licence-unset': { label: () => messages().export.fixLicence, selector: '[data-testid^="vrm-licence-"]' },
};

type Fix =
  | { readonly label: string; readonly op: string; readonly args: unknown }
  | { readonly label: string; readonly focus: string };

/** The Fix of an item: a meta field to focus, Render Thumbnail, or its first row's Validation Fix. */
function fixOf(
  item: ChecklistItem,
  fixes: ReadonlyMap<string, RigValidationRow['fix']>,
  character: string,
): Fix | null {
  for (const row of item.rows) {
    const field = FIELD_FIX[row.code];
    if (field !== undefined) return { label: field.label(), focus: field.selector };
    if (row.code === 'vrm.thumbnail-square') {
      return { label: messages().export.fixThumbnail, op: 'char.renderThumbnail', args: { character } };
    }
    const fix = fixes.get(row.code);
    if (fix !== null && fix !== undefined) return { label: fix.label, op: fix.op, args: fix.args };
  }
  return null;
}

/** Runs a Fix: an operator (one undo step), or the focus of a field beside the checklist. */
function runFix(ctx: WizardContext, fix: Fix): void {
  if ('focus' in fix) {
    const field = document.querySelector<HTMLElement>(fix.focus);
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
    return;
  }
  void ctx.run(fix.op, fix.args);
}

function Checklist(props: {
  readonly ctx: WizardContext;
  readonly items: readonly ChecklistItem[];
  readonly fixes: ReadonlyMap<string, RigValidationRow['fix']>;
  readonly character: string;
}): JSX.Element {
  const { ctx, items } = props;
  return (
    <ul className="flex flex-col gap-0.5" data-testid="ar-export-checks">
      {items.map((item) => {
        const fix =
          item.state === 'error' || item.state === 'warning' ? fixOf(item, props.fixes, props.character) : null;
        // the meta rows' messages name Studio's menu; their sentence and the fields beside say it
        const detail =
          item.state === 'ok' || item.state === 'pending' || FIELD_FIX[item.rows[0]?.code ?? ''] !== undefined
            ? null
            : (item.rows[0]?.message ?? null);
        return (
          <li
            key={item.id}
            className="flex flex-wrap items-start gap-x-2 gap-y-1 py-0.5"
            data-testid={`ar-export-check-${item.id}`}
            data-state={item.state}
            data-codes={item.rows.map((row) => row.code).join(' ')}
          >
            <span aria-hidden className={cn('w-3.5 text-center', TONE[item.state])}>
              {GLYPH[item.state]}
            </span>
            <span className={cn('min-w-0 flex-1', item.state === 'pending' ? 'text-fg-3' : 'text-fg')}>
              {item.label}
              <span className="sr-only">: {STATE_TEXT[item.state]()}</span>
              {detail === null || detail === item.label ? null : (
                <span className="block text-ui-dense text-fg-3">{detail}</span>
              )}
            </span>
            {fix === null ? null : (
              <button
                type="button"
                className={cn(buttonClass(item.state === 'error' ? 'primary' : 'default', 'sm'), coarse)}
                data-testid={`ar-export-fix-${item.id}`}
                onClick={() => runFix(ctx, fix)}
              >
                {fix.label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const EMPTY_ROWS: readonly never[] = [];

function Panel(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const { app } = ctx;
  const m = t();
  const view = useExportView(ctx);
  const ui = useSmall(exportUi(ctx));
  const { record, target } = view;
  const vrm = target === 'ekza-vrm' || target === 'omoba-kit';
  const profile = target === 'glb' ? LOCAL : SPACE;
  const live = useCharacterRows(
    app,
    view.model && record !== null && target !== 'vrma' ? record.id : null,
    profile,
    target === 'glb' ? 'glb' : 'vrm',
  );
  const version = useDocument(app, () => app.store.version);
  const last = currentDownload(ui.last, record?.id ?? null, target, version);
  const fixes = useDocument(app, () => {
    const map = new Map<string, RigValidationRow['fix']>();
    if (record === null || !view.model || !app.rig.loaded || target === null || target === 'vrma') return map;
    try {
      for (const row of app.rig.validation.rows(record.id, profile)) if (!map.has(row.code)) map.set(row.code, row.fix);
    } catch {
      // rows unknown: no Fix buttons
    }
    return map;
  });
  const written = last === null ? null : last.result.lints;
  const measured =
    last === null || target === 'vrma' || last.result.artifacts[0] === undefined
      ? null
      : measureArtifact(last.result.artifacts[0]);
  const items =
    target === null
      ? []
      : checklistOf({
          target,
          modelCharacter: view.model,
          vrm0: view.vrm0,
          live: target === 'vrma' ? EMPTY_ROWS : live,
          written,
          measured,
        });
  useExportFooter(ctx, view, items, last);
  const title =
    target === 'glb' ? m.checksGlb : target === 'vrma' ? m.checksVrma : view.model ? m.checksVrm : m.checksAsset;
  return (
    <div className="flex flex-col gap-3" data-testid="ar-export-panel">
      <h2 className="font-semibold uppercase tracking-wide text-fg-2">{title}</h2>
      {target === 'vrma' ? (
        <p className="text-fg-2" data-testid="ar-export-vrma-clips">
          {m.vrmaClips(view.clips)}
        </p>
      ) : null}
      {record === null || target === null ? null : (
        <Checklist ctx={ctx} items={items} fixes={fixes} character={record.id} />
      )}
      {last === null ? null : (
        <p
          className={cn('text-ui-dense', last.saved ? 'text-fg-2' : 'text-danger')}
          data-testid="ar-export-result"
          data-saved={last.saved}
        >
          {last.saved
            ? m.resultSaved(last.result.fileName, last.bytes === null ? null : fileSize(last.bytes))
            : m.resultBlocked(last.result.fileName)}
        </p>
      )}
      {vrm ? (
        <p className="text-fg-2" data-testid="ar-export-omoba-note">
          {m.omobaNote}
        </p>
      ) : null}
      {target === 'ekza-vrm' && !publishToHub() ? (
        <p className="text-fg-3" data-testid="ar-export-hub-note">
          {m.hubNote}
        </p>
      ) : null}
      {target === 'omoba-kit' ? <p className="text-fg-3">{m.kitNote}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the footer: status and Download

function useExportFooter(
  ctx: WizardContext,
  view: ExportView,
  items: readonly ChecklistItem[],
  last: LastDownload | null,
): void {
  const { record, target } = view;
  const blocking = firstError(items)?.label ?? null;
  const empty = noTargetsText(view);
  const name =
    record === null || target === null
      ? null
      : expectedFileName(target, avatarName(record), view.clips, view.firstClip);
  useEffect(() => {
    const m = t();
    const download = async (): Promise<void> => {
      if (record === null || target === null) return;
      const result = await ctx.run('autorig.export', { character: record.id, target, fileName: '' });
      if (result.status !== 'finished') return;
      const value = result.value as AutoRigExportResult;
      const saved = !value.lints.some((lint) => lint.severity === 'error');
      exportUi(ctx).set((current) => ({
        ...current,
        last: {
          character: record.id,
          target,
          version: ctx.app.store.version,
          result: value,
          saved,
          bytes: savedBytes(value),
        },
      }));
      recordDownload(ctx.session, saved);
      if (saved && (target === 'ekza-vrm' || target === 'omoba-kit') && isModelCharacter(record)) {
        rememberAuthor(ctx.app.store.get('characters', record.id)?.vrm?.authors[0]);
      }
    };
    const status =
      record === null
        ? m.hintNoCharacter
        : target === null
          ? empty
          : last !== null
            ? last.saved
              ? m.hintSaved(last.result.fileName, last.bytes === null ? null : fileSize(last.bytes))
              : m.resultBlocked(last.result.fileName)
            : blocking !== null
              ? m.hintFix(blocking)
              : m.hintReady(name ?? '');
    ctx.setFooter({
      status,
      tone: last !== null && !last.saved ? 'error' : blocking !== null ? 'warning' : 'info',
      primary: {
        label: m.download,
        disabled: record === null || target === null || blocking !== null,
        run: download,
      },
    });
  }, [ctx, record, target, blocking, last, name, empty]);
}

/** The size of the saved file: one artifact's bytes, or (zip) the sum is unknown — the result's file is reported by name. */
function savedBytes(result: AutoRigExportResult): number | null {
  if (result.target === 'ekza-vrm' || result.target === 'glb') return result.artifacts[0]?.bytes.byteLength ?? null;
  if (result.target === 'vrma' && result.artifacts.length === 1) return result.artifacts[0]?.bytes.byteLength ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------

export default function ExportStep(props: StepViewProps): JSX.Element {
  if (props.slot === 'overlay') return <Targets ctx={props.ctx} />;
  return <Panel ctx={props.ctx} />;
}
