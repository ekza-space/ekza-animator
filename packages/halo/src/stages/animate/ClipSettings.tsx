// An animation's Settings (STUDIO-TOUCH-SPEC §10.6, §15.9 row 9.2; T7): the clip settings in the animation's docked
// Halo — frames per second (keeping its seconds or its frames), the range in seconds, loop, how the root travels, the
// contact frame and the tags. Every change is one `clip.setSettings` run (one undo step), the operator Studio Pro's
// clip settings popover runs; the numbers are Pro's (P14), shown in the Thread's units.
import type { ClipRecord } from '@ekza-studio/doc';
import { Segmented, ToggleChip, TouchButton, ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { currentFrame, threadContext } from '../../thread/strip/model';
import { framesOf, secondsOf } from './model';

const w = animateWords.settings;

/** The frame rates the Settings offer (any other the clip has stays listed). */
export const FPS_CHOICES = [24, 30, 60] as const;

/** Tags as `clip.setSettings` takes them: lowercase `a-z 0-9 _ -`, unique, at most 8. */
export function cleanTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (tag !== '' && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 8);
}

export function ClipSettings({
  controller,
  clip,
}: {
  readonly controller: HaloController;
  readonly clip: ClipRecord;
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const [tags, setTags] = useState(clip.tags.join(' '));
  const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
  const set = (patch: Record<string, unknown>): void => {
    count();
    void ctx.run('clip.setSettings', { clip: clip.id, ...patch });
  };
  const fps = clip.fps.num / clip.fps.den;
  const [keep, setKeep] = useState<'keep-seconds' | 'keep-frames'>('keep-seconds');
  const choices = [...new Set<number>([...FPS_CHOICES, Math.round(fps)])].sort((a, b) => a - b);
  const startS = secondsOf(clip.range.start, clip.fps);
  const endS = secondsOf(clip.range.end, clip.fps);
  const thread = threadContext(app);
  const playhead = thread !== null && thread.clip.id === clip.id ? Math.round(currentFrame(app, thread)) : null;
  return (
    <div className="flex flex-col gap-2 px-1 pb-1" data-testid="halo-clip-settings">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-3">{w.fps}</span>
        <Segmented<string>
          label={w.fps}
          data-testid="halo-clip-fps"
          value={String(Math.round(fps))}
          onValueChange={(next) => set({ fps: { num: Number(next), den: 1 }, fpsMode: keep })}
          items={choices.map((value) => ({ value: String(value), label: String(value) }))}
        />
        <Segmented<'keep-seconds' | 'keep-frames'>
          label={w.fpsMode}
          data-testid="halo-clip-fps-mode"
          value={keep}
          onValueChange={(next) => {
            count();
            setKeep(next);
          }}
          items={[
            { value: 'keep-seconds', label: w.keepSeconds },
            { value: 'keep-frames', label: w.keepFrames },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ValueChip
          label={w.start}
          value={startS}
          step={0.01}
          min={0}
          max={Math.max(0, endS - 1 / fps)}
          unit="s"
          data-testid="halo-clip-start"
          onCommit={(seconds) => {
            const start = framesOf(seconds, clip.fps);
            if (start < clip.range.end) set({ range: { start, end: clip.range.end } });
          }}
        />
        <ValueChip
          label={w.end}
          value={endS}
          step={0.01}
          min={startS + 1 / fps}
          max={600}
          unit="s"
          data-testid="halo-clip-end"
          onCommit={(seconds) => {
            const end = framesOf(seconds, clip.fps);
            if (end > clip.range.start) set({ range: { start: clip.range.start, end } });
          }}
        />
        <ToggleChip
          label={w.loop}
          pressed={clip.loop}
          data-testid="halo-clip-loop"
          onPressedChange={(loop) => set({ loop })}
        />
        <Segmented<'hips' | 'in-place'>
          label={w.travel}
          data-testid="halo-clip-travel"
          value={clip.rootMotion}
          onValueChange={(rootMotion) => set({ rootMotion })}
          items={[
            { value: 'hips', label: w.travels },
            { value: 'in-place', label: w.inPlace },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-3">{w.contact}</span>
        <span className="tabular-nums text-fg" data-testid="halo-clip-contact">
          {clip.contact === null ? w.none : `${secondsOf(clip.contact, clip.fps).toFixed(2)} s`}
        </span>
        <TouchButton
          disabled={playhead === null}
          data-testid="halo-clip-contact-here"
          onClick={() => set({ contact: playhead })}
        >
          {w.atPlayhead}
        </TouchButton>
        {clip.contact === null ? null : (
          <TouchButton data-testid="halo-clip-contact-clear" onClick={() => set({ contact: null })}>
            {w.clear}
          </TouchButton>
        )}
        <label className="flex min-w-[200px] flex-1 items-center gap-2">
          <span className="text-fg-3">{w.tags}</span>
          <input
            className="h-(--touch-hit) min-w-0 flex-1 rounded-touch-inner border border-line bg-field px-3 text-(length:--touch-input-text) text-fg"
            value={tags}
            placeholder={w.tagsHint}
            aria-label={w.tags}
            data-testid="halo-clip-tags"
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const next = cleanTags(tags);
              if (next.join(' ') !== clip.tags.join(' ')) set({ tags: next });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      </div>
    </div>
  );
}
