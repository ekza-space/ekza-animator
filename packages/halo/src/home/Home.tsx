// Home (STUDIO-TOUCH-SPEC §4.2 A, §17, §9 J1 step 1, J2 step 1, J10; T11): the first open, on every device. No modal,
// no first-run dialog, no Recovery dialog, no empty grid: one sentence; **Continue** cards from the orphaned autosave
// slots, first when they exist; three doors — *Try a sample* (the filled one when there is nothing to continue: a new
// user may have no model file; ▾ for the other samples), *Bring a model* (Files without `accept` on iOS, the bytes
// sniffed, `../intake`) and *Make a character* (three starts); *Rig a model for me ▸* (Auto-Rig, `shell.navigate`);
// one gesture line; a quiet ▤ Pro layout. Files dropped on Home are brought in the same way. The live canvas idles
// behind it. Every tap counts one touch (AS-ST-4).
import { intakeModel, intakeSampleArgs } from '@ekza-studio/editor-core';
import { pickerAccept } from '@ekza-studio/editor/host';
import { Cluster, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import { type JSX, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import { bringFiles } from '../intake/intake';
import { haloFlowHost } from '../intake/flowHost';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import {
  continueCards,
  primaryDoor,
  SAMPLE_CHOICES,
  type SampleChoice,
  sampleCall,
  START_CHOICES,
  type StartChoice,
  startCall,
} from './model';
import { homeServices } from './start';

/** The pickers' list where `accept` is honoured (every desktop browser); iOS gets none and the bytes decide (S10). */
const ACCEPT = '.glb,.gltf,.vrm,.vrma,.ekzanim,.json,model/gltf-binary,model/gltf+json';

type Panel = null | 'samples' | 'starts';

function useRecovery(controller: HaloController) {
  const { app } = controller.ctx;
  return useSyncExternalStore(
    (listener) => app.session.subscribe(listener),
    () => app.session.getState().recovery,
    () => app.session.getState().recovery,
  );
}

export function Home({
  controller,
  compact = false,
}: {
  readonly controller: HaloController;
  readonly compact?: boolean;
}): JSX.Element {
  const { ctx } = controller;
  const { store } = ctx;
  const services = homeServices(controller);
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [question, setQuestion] = useState<((answer: 'new' | 'add' | 'cancel') => void) | null>(null);
  const [dropping, setDropping] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const recovery = useRecovery(controller);
  const cards = useMemo(() => continueCards(recovery, Date.now()), [recovery]);
  const primary = primaryDoor(cards);
  const touches = useHaloStore(store, (s) => s.touches);
  const touch = services.touch;

  const run = (label: string, work: () => Promise<unknown>): void => {
    setBusy(label);
    void work().finally(() => setBusy(null));
  };

  const trySample = (sample: SampleChoice): void => {
    touch();
    setPanel(null);
    run(`sample:${sample}`, async () => {
      const call = sampleCall(sample);
      if (call.op === 'autorig.sample') {
        // the Cube Lad is a model to rig: the shared intake (Rig & Skin), then *Rig it for me ▸*
        const outcome = await intakeModel(haloFlowHost(ctx), 'autorig.sample', intakeSampleArgs(sample));
        if (outcome.status === 'finished') {
          controller.leaveHome();
          await controller.enterStage('rig');
        } else ctx.toasts.push({ key: 'home', text: outcome.error, tone: 'error' });
        return;
      }
      const result = await ctx.run(call.op, call.args);
      if (result.status === 'finished') controller.leaveHome();
    });
  };

  const makeCharacter = (start: StartChoice): void => {
    touch();
    setPanel(null);
    run(`start:${start}`, async () => {
      const template = startCall(start);
      if (template === null) {
        const outcome = await intakeModel(haloFlowHost(ctx), 'autorig.sample', intakeSampleArgs('cube-lad'));
        if (outcome.status !== 'finished') {
          ctx.toasts.push({ key: 'home', text: outcome.error, tone: 'error' });
          return;
        }
        await controller.enterStage('make');
        controller.leaveHome();
        return;
      }
      await controller.enterStage('make');
      const result = await ctx.run(template.op, template.args);
      if (result.status === 'finished') controller.leaveHome();
    });
  };

  const ask = (): Promise<'new' | 'add' | 'cancel'> =>
    new Promise((resolve) => {
      setQuestion(() => (answer: 'new' | 'add' | 'cancel') => {
        setQuestion(null);
        resolve(answer);
      });
    });

  const bring = (files: readonly File[]): void => {
    if (files.length === 0) return;
    run('bring', () => bringFiles(controller, files, { ask, done: () => controller.leaveHome() }));
  };

  const continueSlot = (slot: string): void => {
    touch();
    run(`continue:${slot}`, async () => {
      const result = await ctx.run('file.recover', { slot });
      if (result.status !== 'finished') return;
      controller.leaveHome();
      await controller.enterStage(ctx.app.store.list('characters').length > 0 ? 'animate' : 'make');
    });
  };

  const removeSlot = (slot: string): void => {
    touch();
    void ctx.run('file.discardRecovery', { slot }).then((result) => {
      if (result.status === 'finished') ctx.toasts.push({ key: 'home', text: en.home.removed });
    });
  };

  const door = 'min-h-[112px] flex-col items-start justify-center gap-1 px-5 text-left';

  return (
    <section
      aria-label={en.app.name}
      data-halo-chrome=""
      data-testid="halo-home"
      data-touches={touches}
      data-dropping={dropping ? '' : undefined}
      className="pointer-events-auto absolute inset-0 flex flex-col overflow-y-auto bg-[color-mix(in_srgb,var(--app)_72%,transparent)] px-(--touch-inset-left) pt-[max(8px,env(safe-area-inset-top))] pb-(--touch-inset-bottom) backdrop-blur-sm data-dropping:outline-2 data-dropping:outline-accent data-dropping:-outline-offset-8"
      data-touch-scroll=""
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDropping(false);
        bring([...event.dataTransfer.files]);
      }}
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
              onClick={() => store.set({ palette: true })}
            />
          ) : (
            <TouchButton
              variant="ghost"
              className="gap-2 font-normal text-fg-2"
              data-testid="halo-search"
              onClick={() => store.set({ palette: true })}
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

        {cards.length === 0 ? null : (
          <section aria-label={en.home.continue} className="flex flex-col gap-2" data-testid="halo-home-continue">
            <h2 className="m-0 px-1 text-touch-label font-semibold tracking-wide text-fg-2 uppercase">
              {en.home.continue}
            </h2>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {cards.map((card, index) => (
                <li key={card.slot} className="flex items-stretch gap-1">
                  <TouchButton
                    variant={index === 0 ? 'primary' : 'default'}
                    className="min-h-[72px] flex-1 flex-col items-start justify-center gap-0.5 px-4 text-left"
                    data-testid="halo-home-continue-card"
                    data-slot={card.slot}
                    disabled={busy !== null}
                    onClick={() => continueSlot(card.slot)}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <Icon name="play" size={18} />
                      {card.name}
                    </span>
                    <span className="text-touch-label font-normal opacity-85">{card.detail}</span>
                  </TouchButton>
                  <TouchIconButton
                    label={en.home.remove(card.name)}
                    icon={<span aria-hidden="true">✕</span>}
                    data-testid="halo-home-continue-remove"
                    onClick={() => removeSlot(card.slot)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {question === null ? null : (
          <div
            role="alertdialog"
            aria-label={en.home.question}
            className="flex flex-col gap-2 rounded-touch-card border border-line bg-panel p-3"
            data-testid="halo-home-question"
          >
            <p className="m-0 text-touch text-fg">{en.home.question}</p>
            <div className="flex flex-wrap gap-2">
              <TouchButton variant="primary" data-testid="halo-home-new" onClick={() => question('new')}>
                {en.home.startNew}
              </TouchButton>
              <TouchButton data-testid="halo-home-add" onClick={() => question('add')}>
                {en.home.addHere}
              </TouchButton>
              <TouchButton variant="ghost" onClick={() => question('cancel')}>
                {en.home.cancel}
              </TouchButton>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-stretch gap-1">
            <TouchButton
              variant={primary === 'sample' ? 'primary' : 'default'}
              className={`${door} flex-1`}
              data-testid="halo-home-sample"
              disabled={busy !== null}
              onClick={() => trySample('polybot')}
            >
              <span className="flex items-center gap-2 text-touch-title">
                <Icon name="play" />
                {busy?.startsWith('sample:') === true ? en.home.loading : en.home.trySample}
              </span>
              <span className={`text-touch-label font-normal ${primary === 'sample' ? 'opacity-85' : 'text-fg-2'}`}>
                {en.home.trySampleDetail}
              </span>
            </TouchButton>
            <TouchIconButton
              label={en.home.otherSamples}
              icon={<Icon name="down" />}
              aria-expanded={panel === 'samples'}
              data-testid="halo-home-sample-more"
              onClick={() => {
                touch();
                setPanel((open) => (open === 'samples' ? null : 'samples'));
              }}
            />
          </div>
          <TouchButton
            className={door}
            data-testid="halo-home-bring"
            disabled={busy !== null}
            onClick={() => {
              touch();
              file.current?.click();
            }}
          >
            <span className="flex items-center gap-2 text-touch-title">
              <Icon name="upload" />
              {busy === 'bring' ? en.home.loading : en.home.bring}
            </span>
            <span className="text-touch-label font-normal text-fg-2">{en.home.bringDetail}</span>
          </TouchButton>
          <TouchButton
            className={door}
            data-testid="halo-home-make"
            aria-expanded={panel === 'starts'}
            disabled={busy !== null}
            onClick={() => {
              touch();
              setPanel((open) => (open === 'starts' ? null : 'starts'));
            }}
          >
            <span className="flex items-center gap-2 text-touch-title">
              <Icon name="pencil" />
              {busy?.startsWith('start:') === true ? en.home.loading : en.home.make}
            </span>
            <span className="text-touch-label font-normal text-fg-2">{en.home.makeDetail}</span>
          </TouchButton>
        </div>

        {panel === null ? null : (
          <ul
            className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3"
            data-testid={panel === 'samples' ? 'halo-home-samples' : 'halo-home-starts'}
          >
            {(panel === 'samples' ? SAMPLE_CHOICES : START_CHOICES).map((id) => {
              const [title, detail] =
                (panel === 'samples' ? en.home.samples[id] : en.home.starts[id]) ?? ([id, ''] as const);
              return (
                <li key={id}>
                  <TouchButton
                    className="min-h-[72px] w-full flex-col items-start justify-center gap-0.5 px-4 text-left"
                    data-testid={`halo-home-${panel === 'samples' ? 'sample' : 'start'}-${id}`}
                    disabled={busy !== null}
                    onClick={() =>
                      panel === 'samples' ? trySample(id as SampleChoice) : makeCharacter(id as StartChoice)
                    }
                  >
                    <span className="font-semibold">{title}</span>
                    <span className="text-touch-label font-normal text-fg-2">{detail}</span>
                  </TouchButton>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col items-center gap-2 text-fg-2">
          <p className="m-0 flex flex-wrap items-center justify-center gap-1">
            {en.home.justRigged}
            <TouchButton
              variant="ghost"
              className="gap-1 text-accent-text"
              data-op="shell.navigate"
              data-testid="halo-home-autorig"
              onClick={() => {
                touch();
                void ctx.run('shell.navigate', { to: 'autorig', from: 'halo' });
              }}
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
        accept={pickerAccept(ACCEPT)}
        data-testid="halo-home-file"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          bring(files);
        }}
      />
    </section>
  );
}
