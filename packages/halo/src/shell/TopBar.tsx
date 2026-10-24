// The top bar (STUDIO-TOUCH-SPEC §4.1–§4.4): `◂ Project • ▾` (the project menu; the dot means unsaved changes), the
// Path, `⌕ Do or find…` (a button until tapped, §4.1 / S22), `Share ⤴` and `▤ Pro layout`. Regular containers put the
// Path on a second row; Compact ones move it to a bottom tab bar, fold ▤ Pro layout into the project menu and show ↶
// here. The Path's readiness glyphs are T6b's (`path/Path.tsx` replaces `PathTabs` at integration).
import type { HaloStage } from '@ekza-studio/editor-core';
import { Cluster, Segmented, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { Icon } from '../halo/icons';
import { commitSession } from '../session/sessions';
import { en } from '../i18n/en';
import type { HaloController } from './controller';
import { useSessionValue, type SizeClass } from './hooks';
import { HALO_STAGES } from './stage';
import { useHaloStore } from './store';

export function PathTabs({
  controller,
  bar = false,
}: {
  readonly controller: HaloController;
  readonly bar?: boolean;
}): JSX.Element {
  const stage = useHaloStore(controller.ctx.store, (s) => s.stage);
  return (
    <Cluster className={bar ? 'flex p-[3px]' : 'flex max-w-full overflow-x-auto p-[3px]'} data-touch-scroll="">
      <Segmented<HaloStage>
        kind="tablist"
        variant="accent"
        label={en.top.stages}
        data-testid="halo-path"
        {...(bar ? { className: 'w-full' } : {})}
        value={stage}
        onValueChange={(next) => void controller.enterStage(next)}
        items={HALO_STAGES.map((s) => ({ value: s, label: en.stage[s] }))}
      />
    </Cluster>
  );
}

export function TopBar({
  controller,
  size,
}: {
  readonly controller: HaloController;
  readonly size: SizeClass;
}): JSX.Element {
  const { ctx } = controller;
  const { store, app } = ctx;
  const dirty = useSessionValue(app, (s) => s.dirty);
  const project = useSessionValue(app, (s) => s.projectName);
  const proLine = useHaloStore(store, (s) => s.proLine);
  const compact = size === 'compact';
  const name = project.trim() === '' ? en.top.untitled : project;
  return (
    <header
      data-halo-chrome=""
      className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 px-(--touch-inset-left) pt-[max(8px,env(safe-area-inset-top))]"
    >
      <div className={compact ? 'flex items-center gap-1.5' : 'flex items-center gap-2.5'}>
        <Cluster className="pointer-events-auto flex">
          <TouchButton
            variant="ghost"
            className={compact ? 'max-w-[136px] gap-1 px-2 text-fg' : 'max-w-[220px] gap-1.5 px-3 text-fg'}
            aria-label={`${name}${dirty ? `, ${en.top.unsaved}` : ''}. ${en.top.projectMenu}`}
            aria-haspopup="menu"
            data-testid="halo-project"
            onClick={() => store.set({ projectMenu: true })}
          >
            <Icon name="left" size={18} />
            <span className="min-w-0 truncate font-semibold">{name}</span>
            {dirty ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" /> : null}
            <Icon name="down" size={18} />
          </TouchButton>
        </Cluster>
        {size === 'wide' ? (
          <div className="pointer-events-auto min-w-0">
            <PathTabs controller={controller} />
          </div>
        ) : null}
        <span className="flex-1" />
        <Cluster className="pointer-events-auto flex">
          {compact ? (
            <TouchIconButton
              label={en.top.search}
              icon={<Icon name="search" />}
              className="border-0 bg-transparent shadow-none"
              data-testid="halo-search"
              onClick={() => store.set({ palette: true })}
            />
          ) : (
            <TouchButton
              variant="ghost"
              className="min-w-[200px] justify-start gap-2 font-normal text-fg-2"
              data-testid="halo-search"
              onClick={() => store.set({ palette: true })}
            >
              <Icon name="search" />
              {en.top.search}
            </TouchButton>
          )}
        </Cluster>
        <Cluster className="pointer-events-auto flex">
          <TouchButton
            variant="ghost"
            className={compact ? 'gap-1.5 px-3 text-fg' : 'gap-2 text-fg'}
            data-testid="halo-share"
            // leaving for Share commits the open tool session (P15)
            onClick={() => void commitSession(controller.ctx).then(() => store.set({ sheet: 'share', halo: null }))}
          >
            <Icon name="share" />
            {en.top.share}
          </TouchButton>
        </Cluster>
        {compact ? (
          <TouchIconButton
            label={en.undo.undo}
            icon={<Icon name="undo" />}
            className="pointer-events-auto"
            data-testid="halo-undo"
            onClick={() => controller.grammar.undo()}
          />
        ) : (
          <div className="pointer-events-auto relative">
            <Cluster className="flex">
              <TouchButton
                variant="ghost"
                className="gap-2 text-fg"
                data-testid="halo-pro-layout"
                // From the tap handler itself: a same-page switch, the document and its undo history kept (§16.1).
                onClick={() => controller.proLayout()}
              >
                <Icon name="layout" />
                {en.top.proLayout}
              </TouchButton>
            </Cluster>
            {proLine ? <ProLine controller={controller} /> : null}
          </div>
        )}
      </div>
      {size === 'regular' ? (
        <div className="pointer-events-auto flex">
          <PathTabs controller={controller} bar />
        </div>
      ) : null}
    </header>
  );
}

/** §16.1: on a coarse-only device, one line before Pro, anchored to the button; shown once per session. */
function ProLine({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { store } = controller.ctx;
  return (
    <aside
      aria-label={en.pro.line}
      data-testid="halo-pro-line"
      className="absolute top-[calc(100%+8px)] right-0 z-(--z-popover) flex w-[320px] flex-col gap-2 rounded-touch-card border border-line bg-panel p-3 shadow-sheet"
    >
      <p className="m-0 text-touch text-fg">{en.pro.line}</p>
      <div className="flex flex-wrap gap-2">
        <TouchButton variant="primary" data-testid="halo-pro-open" onClick={() => controller.proLayout(true)}>
          {en.pro.openAnyway}
        </TouchButton>
        <TouchButton
          variant="ghost"
          onClick={() => store.set({ proLine: false, sheet: 'share' })}
          className="whitespace-normal text-left"
        >
          {en.pro.saveFirst}
        </TouchButton>
      </div>
    </aside>
  );
}
