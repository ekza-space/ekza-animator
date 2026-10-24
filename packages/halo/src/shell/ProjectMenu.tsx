// The project menu (STUDIO-TOUCH-SPEC §4.1): `◂ Project • ▾` — New, Open, Import, Samples, Save project to Files,
// Recover, Scene, History, Settings, Help, Full screen, Hide UI and Home (and ▤ Pro layout on Compact containers,
// §4.4). A lazy chunk. Files open through the host's pipeline (projects, models, animations; sniffed by their bytes on
// iOS, S10); saving and the sheets are other packages' surfaces (T11's Share / Save, T6b's sheets).
import { Cluster, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import { en } from '../i18n/en';
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
  const pickFiles = (): void => {
    file?.click();
  };
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  const sheet = (id: string) => () => store.set({ sheet: id, halo: null });
  const p = en.project;
  const entries: readonly { readonly label: string; readonly run: () => void; readonly testId?: string }[] = [
    { label: p.new, run: () => void ctx.run('file.new') },
    { label: p.open, run: pickFiles, testId: 'halo-project-open' },
    { label: p.import, run: pickFiles },
    { label: p.samples, run: () => void ctx.run('file.loadSample', { sample: 'polybot' }) },
    { label: p.saveProject, run: () => void commitSession(ctx).then(sheet('share')) },
    { label: p.recover, run: () => store.set({ home: true }) },
    { label: p.scene, run: sheet('scene') },
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
        className="pointer-events-auto absolute top-[64px] left-(--touch-inset-left) z-(--z-popover) flex w-[260px] flex-col p-1.5"
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
          if (files.length > 0) void ctx.host.files.openFiles(files);
        }}
      />
    </>
  );
}
