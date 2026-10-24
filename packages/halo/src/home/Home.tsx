// Home (STUDIO-TOUCH-SPEC §4.2 A, §17) — the grammar's stand-in; T11 builds the real one (Continue cards from the
// autosave slots, intake with sniffing, Bring a model's routing). No modal on the first paint: one sentence, three doors
// (*Try a sample* is the primary one, since a new user may have no model file), *Rig a model for me ▸*, a single gesture
// line and a quiet ▤ Pro layout. The live canvas idles behind it.
import { Cluster, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import { type JSX, useRef, useState } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';

export function Home({
  controller,
  compact = false,
}: {
  readonly controller: HaloController;
  readonly compact?: boolean;
}): JSX.Element {
  const { ctx } = controller;
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const trySample = (): void => {
    setBusy(true);
    void ctx.run('file.loadSample', { sample: 'polybot' }).then((result) => {
      setBusy(false);
      if (result.status === 'finished') controller.leaveHome();
    });
  };
  const makeCharacter = (): void => {
    void controller.enterStage('make').then(() =>
      ctx.run('mesh.create.cube').then((result) => {
        if (result.status === 'finished') controller.leaveHome();
      }),
    );
  };
  return (
    <section
      aria-label={en.app.name}
      data-halo-chrome=""
      data-testid="halo-home"
      className="pointer-events-auto absolute inset-0 flex flex-col overflow-y-auto bg-[color-mix(in_srgb,var(--app)_72%,transparent)] px-(--touch-inset-left) pt-[max(8px,env(safe-area-inset-top))] pb-(--touch-inset-bottom) backdrop-blur-sm"
      data-touch-scroll=""
    >
      <header className="flex items-center gap-2.5">
        <span className="flex min-h-(--touch-hit) items-center gap-2 px-2 text-touch-title font-semibold whitespace-nowrap">
          <span aria-hidden="true" className="text-accent-text">
            ◆
          </span>
          {en.app.name}
        </span>
        <span className="flex-1" />
        <Cluster className="flex">
          {compact ? (
            <TouchIconButton
              label={en.top.search}
              icon={<Icon name="search" />}
              className="border-0 bg-transparent shadow-none"
              data-testid="halo-search"
              onClick={() => ctx.store.set({ palette: true })}
            />
          ) : (
            <TouchButton
              variant="ghost"
              className="gap-2 font-normal text-fg-2"
              data-testid="halo-search"
              onClick={() => ctx.store.set({ palette: true })}
            >
              <Icon name="search" />
              {en.top.search}
            </TouchButton>
          )}
        </Cluster>
        <Cluster className="flex">
          {compact ? (
            <TouchIconButton
              label={en.top.proLayout}
              icon={<Icon name="layout" />}
              className="border-0 bg-transparent shadow-none"
              data-testid="halo-pro-layout"
              onClick={() => controller.proLayout()}
            />
          ) : (
            <TouchButton
              variant="ghost"
              className="gap-2"
              data-testid="halo-pro-layout"
              onClick={() => controller.proLayout()}
            >
              <Icon name="layout" />
              {en.top.proLayout}
            </TouchButton>
          )}
        </Cluster>
      </header>
      <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col justify-center gap-6 py-8">
        <p className="m-0 text-center text-touch-title text-fg">{en.home.tagline}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TouchButton
            variant="primary"
            className="min-h-[112px] flex-col items-start justify-center gap-1 px-5 text-left"
            data-testid="halo-home-sample"
            disabled={busy}
            onClick={trySample}
          >
            <span className="flex items-center gap-2 text-touch-title">
              <Icon name="play" />
              {busy ? en.home.loading : en.home.trySample}
            </span>
            <span className="text-touch-label font-normal opacity-85">{en.home.trySampleDetail}</span>
          </TouchButton>
          <TouchButton
            className="min-h-[112px] flex-col items-start justify-center gap-1 px-5 text-left"
            data-testid="halo-home-bring"
            onClick={() => file.current?.click()}
          >
            <span className="flex items-center gap-2 text-touch-title">
              <Icon name="upload" />
              {en.home.bring}
            </span>
            <span className="text-touch-label font-normal text-fg-2">{en.home.bringDetail}</span>
          </TouchButton>
          <TouchButton
            className="min-h-[112px] flex-col items-start justify-center gap-1 px-5 text-left"
            data-testid="halo-home-make"
            onClick={makeCharacter}
          >
            <span className="flex items-center gap-2 text-touch-title">
              <Icon name="pencil" />
              {en.home.make}
            </span>
            <span className="text-touch-label font-normal text-fg-2">{en.home.makeDetail}</span>
          </TouchButton>
        </div>
        <div className="flex flex-col items-center gap-2 text-fg-2">
          <p className="m-0 flex flex-wrap items-center justify-center gap-1">
            {en.home.justRigged}
            <TouchButton
              variant="ghost"
              className="gap-1 text-accent-text"
              onClick={() => void ctx.host.navigation.go({ to: 'autorig', from: 'halo' })}
            >
              {en.home.rigForMe}
              <Icon name="right" size={16} />
            </TouchButton>
          </p>
          <p className="m-0 text-touch-label">{en.home.gestures}</p>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          if (files.length > 0) void ctx.host.files.openFiles(files).then(() => controller.leaveHome());
        }}
      />
    </section>
  );
}
