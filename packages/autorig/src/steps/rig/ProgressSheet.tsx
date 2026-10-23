// The rigging progress sheet (AUTORIG-SPEC §5.4 "Progress", §4.5 exclusivity, §8.2; D4): a modal sheet over the whole
// wizard while `session.busy` is set — the stages (Skeleton, Skinning with the meshes' fraction, Straightening for an
// A-posed input, Checking) as ✓ / ▸ / ○ rows in a polite live region, and *Cancel* during the bind only
// (`autorig.cancel`; the straighten is one synchronous transaction). A native modal `<dialog>` (`showModal`): the rest
// of the page is inert (the header's undo/redo, the stepper, the panel, the footer), the focus stays in the sheet with
// *Cancel* reachable, and `Esc` does not close it (rigging is not stopped by a key). The keyboard is off too: the
// sheet carries `data-ar-exclusive`, so the key guard (`./exclusive`, registered before the frame's key scope) stops
// every key but `Tab` and `Enter` / `Space` on *Cancel* (no `Alt+1…5`, no `Mod+Enter`, no undo, no step keys), and an
// explicit `role="dialog"` makes the host's keyboard adapter (`isInOverlay`) treat it as an overlay.
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, useEffect, useRef } from 'react';
import { formatNumber, messages } from '../../i18n';
import { useDocument, useSession, type WizardContext } from '../../shell/context';
import { useSmall } from '../../shell/store';
import type { AutoRigSession, AutoRigStage } from '../../types';
import { resolveSubject } from '../../progress';
import { cancelAutoRig } from './run';
import { rigUi } from './ui';
import './strings';

const selectBusy = (s: AutoRigSession): AutoRigSession['busy'] => s.busy;
const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;

const PRESETS: Readonly<Record<string, string>> = {
  lite17: 'Lite 17',
  core21: 'Core 21',
  standard33: 'Standard 33',
  full52: 'Full 52',
};

const ORDER: readonly AutoRigStage[] = ['skeleton', 'skin', 'straighten', 'check'];

export function ProgressSheet(props: { readonly ctx: WizardContext }): JSX.Element | null {
  const { ctx } = props;
  const busy = useSession(ctx.session, selectBusy);
  const subject = useSession(ctx.session, selectSubject);
  const plan = useSmall(rigUi(ctx), (ui) => ui.plan);
  const rebinding = useSmall(rigUi(ctx), (ui) => ui.rebinding);
  const sheet = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const open = busy !== null;
  const stage = busy?.stage ?? null;
  const canCancel = stage === 'skin';
  const info = useDocument(ctx.app, () => {
    const resolved = resolveSubject(ctx.app.store, subject);
    const character = resolved.character;
    const name =
      character?.vrm?.name ||
      character?.name ||
      resolved.meshes.map((id) => ctx.app.store.get('meshes', id)?.name).find((value) => value !== undefined) ||
      messages().frame.untitled;
    const skeleton = character === null ? undefined : ctx.app.store.query.skeletonOfCharacter(character.id);
    const joints =
      skeleton === undefined
        ? 0
        : ctx.app.store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null).length;
    const meshes = character === null ? resolved.meshes.length : ctx.app.store.query.meshesOfOwner(character.id).length;
    return { name, joints, preset: skeleton?.preset ?? null, meshes };
  });

  useEffect(() => {
    const element = sheet.current;
    if (!open || element === null) return undefined;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);
  useEffect(() => {
    if (open) (cancel.current ?? sheet.current)?.focus();
  }, [open, canCancel]);

  if (!open || stage === null) return null;
  const r = messages().rig;
  const stages = ORDER.filter(
    (row) =>
      (row !== 'skeleton' || !rebinding) &&
      (row !== 'skin' || plan === null || plan.bind) &&
      (row !== 'straighten' || (plan?.straighten ?? false)),
  );
  const at = ORDER.indexOf(stage);
  const label = (row: AutoRigStage): string => {
    switch (row) {
      case 'skeleton':
        return ORDER.indexOf(row) < at && info.joints > 0
          ? r.stageSkeletonDone(info.joints, PRESETS[info.preset ?? ''] ?? info.preset ?? '')
          : r.stageSkeleton;
      case 'skin': {
        if (row !== stage) return r.stageSkin;
        const total = Math.max(1, info.meshes);
        const done = busy?.fraction === null || busy?.fraction === undefined ? 0 : Math.round(busy.fraction * total);
        return r.stageSkinMeshes(Math.min(total, done + 1), total);
      }
      case 'straighten':
        return r.stageStraighten;
      case 'check':
      case 'import':
      case 'export':
        return r.stageCheck;
    }
  };
  const fraction = busy?.fraction ?? null;
  return (
    <dialog
      ref={sheet}
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- the host's `isInOverlay` matches `[role="dialog"]`, not a native <dialog>
      role="dialog"
      aria-modal="true"
      aria-labelledby="ar-rig-sheet-title"
      data-ar-exclusive=""
      tabIndex={-1}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 rounded-dialog border border-line bg-popover p-4 text-fg shadow-popover outline-none backdrop:bg-scrim open:flex"
      data-testid="ar-rig-sheet"
      data-stage={stage}
      onCancel={(e) => e.preventDefault()}
    >
      <h2 id="ar-rig-sheet-title" className="text-dialog-title font-semibold">
        {r.sheetTitle(info.name)}
      </h2>
      <ol className="flex flex-col gap-1" aria-live="polite" data-testid="ar-rig-stages">
        {stages.map((row) => {
          const index = ORDER.indexOf(row);
          const state = index < at ? 'done' : index === at ? 'running' : 'pending';
          return (
            <li
              key={row}
              className={cn('flex flex-col gap-1', state === 'pending' ? 'text-fg-3' : 'text-fg')}
              data-stage={row}
              data-state={state}
            >
              <span>
                <span aria-hidden>{state === 'done' ? '✓' : state === 'running' ? '▸' : '○'} </span>
                {label(row)}
              </span>
              {row === 'skin' && state === 'running' ? (
                <progress
                  className="h-2 w-full"
                  aria-label={r.stageSkin}
                  {...(fraction === null ? {} : { value: fraction, max: 1 })}
                  data-testid="ar-rig-progress"
                >
                  {fraction === null ? null : `${formatNumber(fraction * 100, { maximumFractionDigits: 0 })} %`}
                </progress>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canCancel ? (
        <button
          ref={cancel}
          type="button"
          className={cn(buttonClass('default', 'md'), 'self-end pointer-coarse:min-h-11')}
          data-testid="ar-rig-cancel"
          onClick={() => cancelAutoRig(ctx)}
        >
          {r.cancel}
        </button>
      ) : null}
    </dialog>
  );
}
