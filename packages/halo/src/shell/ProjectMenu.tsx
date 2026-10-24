// The project menu (STUDIO-TOUCH-SPEC §4.1): `◂ Project • ▾` — New, Open, Import, Samples, Save project to Files,
// Recover, Scene, View, Health, History, Settings, Help, Full screen, Hide UI and Home (and ▤ Pro layout on Compact
// containers, §4.4). View and Health are the visible twins (§18) of the View puck's long-press and of the Path's ⚠ and
// the status pill, which show only when there is something to fix (T6-INT). A lazy chunk. Files open through the host's pipeline (projects, models, animations; sniffed by their bytes on
// iOS, S10); saving and the sheets are other packages' surfaces (T11's Share / Save, T6b's sheets).
import { Cluster, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import { en } from '../i18n/en';
import { homeServices } from '../home/start';
import { commitSession } from '../session/sessions';
import type { HaloController } from './controller';

function MenuItem({
  label,
  onSelect,
  testId,
}: {
  readonly label: string;
  readonly onSelect: () => void;
  readonly testId?: string;
}): JSX.Element {
  return (
    <TouchButton
      role="menuitem"
      variant="ghost"
      className="justify-start"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      onClick={onSelect}
    >
      {label}
    </TouchButton>
  );
}

export default function ProjectMenu({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { ctx } = controller;
  const { store } = ctx;
  const [file, setFile] = useState<HTMLInputElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (): void => store.set({ projectMenu: false });
  // T11: Open starts a new project (the work stays in autosave), Import adds to this one
  const mode = useRef<'new' | 'add'>('new');
  const pickFiles = (as: 'new' | 'add') => (): void => {
    mode.current = as;
    file?.click();
  };
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  const sheet = (id: string) => () => store.set({ sheet: id, sheetArgs: null, sheetNoun: null, halo: null });
  const p = en.project;
  const entries: readonly { readonly label: string; readonly run: () => void; readonly testId?: string }[] = [
    { label: p.new, run: () => void ctx.run('file.new') },
    { label: p.open, run: pickFiles('new'), testId: 'halo-project-open' },
    { label: p.import, run: pickFiles('add'), testId: 'halo-project-import' },
    { label: p.samples, run: () => void ctx.run('file.loadSample', { sample: 'polybot' }) },
    // T11: *Save project to Files* saves (`file.save`; on iOS the host's save prompt delivers it), Recover shows Home
    { label: p.saveProject, run: () => void homeServices(controller).saveProject(), testId: 'halo-project-save' },
    { label: p.recover, run: () => store.set({ home: true, halo: null }), testId: 'halo-project-recover' },
    { label: p.scene, run: sheet('scene') },
    // §18: the visible twins of the View puck's long-press and of the Path's ⚠ and the status pill
    { label: p.view, run: sheet('view'), testId: 'halo-project-view' },
    { label: p.health, run: sheet('health'), testId: 'halo-project-health' },
    { label: p.history, run: sheet('history') },
    { label: p.settings, run: sheet('settings') },
    { label: p.help, run: sheet('help') },
    { label: p.fullScreen, run: () => void ctx.run('view.toggleFullscreen') },
    { label: p.hideUi, run: () => store.set({ hideUi: true, halo: null }), testId: 'halo-hide-ui' },
    { label: p.home, run: () => void commitSession(ctx).then(() => store.set({ home: true, halo: null })) },
    { label: p.proLayout, run: () => controller.proLayout() },
  ];
  return (
    <>
      <button
        type="button"
        aria-label={en.dialogs.cancel}
        tabIndex={-1}
        data-halo-uncounted=""
        className="pointer-events-auto absolute inset-0 cursor-default"
        onClick={close}
      />
      <Cluster
        ref={menu}
        role="menu"
        aria-label={en.top.projectMenu}
        data-testid="halo-project-menu"
        className="pointer-events-auto absolute top-[64px] left-(--touch-inset-left) z-(--z-popover) flex max-h-[calc(100%-76px)] w-[260px] flex-col overflow-y-auto p-1.5"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        {entries.map((entry) => (
          <MenuItem
            key={entry.label}
            label={entry.label}
            {...(entry.testId === undefined ? {} : { testId: entry.testId })}
            onSelect={() => {
              close();
              entry.run();
            }}
          />
        ))}
      </Cluster>
      <input
        ref={setFile}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          // T11: the same intake as Home's *Bring a model* (the bytes sniffed, the shared routing)
          if (files.length > 0) {
            void import('../intake/intake').then(({ bringFiles }) =>
              bringFiles(controller, files, {
                ask: () => Promise.resolve(mode.current),
                done: () => controller.leaveHome(),
              }),
            );
          }
        }}
      />
    </>
  );
}
