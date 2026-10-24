// The Thread's layer 1, Keys (STUDIO-TOUCH-SPEC §10.4, §5.2.1; T7): Studio Pro's own `DopeSheetController` behind the
// curve editor's touch adapter (`attachDopeSheetTouch`, §20.3 item 8), rows Summary → body part → control → channel at
// 36 pt (the controller's 20 px rows shown 1.8× larger). A lazy chunk: the curve editor never loads with `/app`'s
// first scripts (§20.6).
// - The header: *Select · Move · Stretch* (the Dope Sheet tools, `view.tool {panel: 'dopeSheet'}`), *Push later keys*
//   (`key.toggleRipple`), *Select area* (the next drag on empty rows is a marquee even with the Move tool), the rows
//   (selected or the whole character), ‹ › one-frame nudges (`graph.keys.move`), and the key Halo docked here (above
//   the rows it edits, never over them).
// - A finger or the Pencil: a drag on empty rows is a marquee, on a key it retimes; a long-press then a drag draws a
//   band (`time.selectBand`); two fingers scroll the rows and pan or pinch time; a double-tap frames.
// The Dope Sheet's contributions (`dopeSheet.frame`, the tools, the ripple control set) are registered while the layer
// is open, unless Pro's Dope Sheet already did.
import {
  attachDopeSheetTouch,
  DOPE_SHEET_ROW_HEIGHT,
  DopeSheetController,
  type DopeSheetShow,
  registerDopeSheetContributions,
} from '@ekza-studio/curve-editor';
import { DOPE_TOOL, PANEL } from '@ekza-studio/editor-core';
import { Cluster, Segmented, ToggleChip, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { useSessionValue } from '../../shell/hooks';
import type { AnimateUiStore } from '../../stages/animate/ui';

const w = animateWords.keys;

/** Rows of 20 CSS px shown at 36 pt (§10.4). */
export const KEYS_SCALE = 36 / DOPE_SHEET_ROW_HEIGHT;
const LABEL_WIDTH = 168;

type DopeTool = (typeof DOPE_TOOL)[keyof typeof DOPE_TOOL];

const TOOLS: readonly { readonly value: DopeTool; readonly label: string }[] = [
  { value: DOPE_TOOL.select, label: w.tools.select },
  { value: DOPE_TOOL.move, label: w.tools.move },
  { value: DOPE_TOOL.scale, label: w.tools.scale },
];

/** The mounted Keys layer's controller (the test API's `thread` slice and the e2e probe). */
const mounted = new WeakMap<object, DopeSheetController>();

export function keysController(owner: object): DopeSheetController | null {
  return mounted.get(owner) ?? null;
}

function RowLabels({ sheet }: { readonly sheet: DopeSheetController }): JSX.Element {
  // rows or view changed (the controller notifies both): read both again
  const [, setTick] = useState(0);
  useEffect(() => sheet.subscribe(() => setTick((n) => n + 1)), [sheet]);
  const version = sheet.rows();
  const scrollY = sheet.view.scrollY;
  const top = 32 * KEYS_SCALE; // the controller's ruler and region strips, shown scaled
  return (
    <div className="relative h-full overflow-hidden" aria-hidden="true">
      {version.map((row, index) => (
        <div
          key={row.id}
          className="absolute right-0 left-0 flex items-center truncate border-b border-line/40 pr-2 text-touch-label text-fg-2"
          style={{
            top: top + (index * DOPE_SHEET_ROW_HEIGHT - scrollY) * KEYS_SCALE,
            height: DOPE_SHEET_ROW_HEIGHT * KEYS_SCALE,
            paddingLeft: 8 + row.depth * 12,
          }}
        >
          {row.kind === 'summary' ? w.summary : row.label}
        </div>
      ))}
    </div>
  );
}

export default function KeysLayer({
  controller,
  ui,
  height,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly height: number;
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<DopeSheetController | null>(null);
  const tool = useSessionValue(app, (s) => s.tools.dopeSheet);
  const ripple = useSessionValue(app, (s) => s.tools.ripple);
  const [show, setShow] = useState<DopeSheetShow>('character');
  const [area, setArea] = useState(false);
  const areaRef = useRef(area);
  useEffect(() => {
    areaRef.current = area;
  }, [area]);

  useEffect(() => {
    if (app.operators.get('dopeSheet.frame') !== undefined) return undefined;
    return registerDopeSheetContributions(app, () => mounted.get(controller) ?? null);
  }, [app, controller]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const next = new DopeSheetController({ app, canvas });
    next.setShow('character');
    mounted.set(controller, next);
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      next.resize(rect.width / KEYS_SCALE, rect.height / KEYS_SCALE, (window.devicePixelRatio || 1) * KEYS_SCALE);
      next.redraw(true);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    resize();
    const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
    const detach = attachDopeSheetTouch(next, canvas, {
      scale: KEYS_SCALE,
      modifiers: () => {
        const latch = store.get().thumb.latch;
        return { shift: latch !== 'off' || areaRef.current, mod: false, alt: false };
      },
      onTap: (hit) => {
        count();
        if (hit.kind === 'glyph') ui.set({ docked: { kind: 'keyDot', frame: hit.frame }, menu: null, more: null });
      },
      onLongPress: (hit) => {
        count();
        if (hit.kind === 'glyph') ui.set({ docked: { kind: 'keyDot', frame: hit.frame }, menu: null, more: null });
        else ui.set({ docked: { kind: 'playhead' }, menu: null, more: null });
      },
      onBand: (band, done) => {
        void ctx.run('time.selectBand', { band, mode: 'replace' });
        if (done) {
          count();
          if (band !== null) ui.set({ docked: { kind: 'band' }, menu: null, more: null });
        }
      },
      onFrame: count,
    });
    setSheet(next);
    return () => {
      detach();
      observer?.disconnect();
      if (mounted.get(controller) === next) mounted.delete(controller);
      next.dispose();
      setSheet(null);
    };
  }, [app, controller, ctx, store, ui]);

  useEffect(() => {
    sheet?.setShow(show);
  }, [sheet, show]);

  const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-thread-keys"
      className="pointer-events-auto flex flex-col items-stretch gap-1 p-[5px]"
      style={{ height }}
    >
      <div className="flex flex-wrap items-center gap-1.5" data-testid="halo-keys-header">
        <Segmented<DopeTool>
          label={w.toolLabel}
          data-testid="halo-keys-tool"
          value={(tool as DopeTool) ?? DOPE_TOOL.select}
          onValueChange={(next) => {
            count();
            void ctx.run('view.tool', { panel: PANEL.dopeSheet, tool: next });
          }}
          items={TOOLS}
        />
        <ToggleChip
          label={w.pushLater}
          pressed={ripple}
          data-testid="halo-keys-push"
          onPressedChange={() => {
            count();
            void ctx.run('key.toggleRipple');
          }}
        />
        <ToggleChip
          label={w.selectArea}
          pressed={area}
          data-testid="halo-keys-area"
          onPressedChange={(next) => {
            count();
            setArea(next);
          }}
        />
        <Segmented<DopeSheetShow>
          label={w.showLabel}
          data-testid="halo-keys-show"
          value={show}
          onValueChange={(next) => {
            count();
            setShow(next);
          }}
          items={[
            { value: 'selected', label: w.show.selected },
            { value: 'character', label: w.show.character },
          ]}
        />
        <TouchButton
          data-testid="halo-keys-nudge-back"
          onClick={() => {
            count();
            void ctx.run('graph.keys.move', { dFrames: -1, dValue: 0 });
          }}
        >
          {w.nudgeBack}
        </TouchButton>
        <TouchButton
          data-testid="halo-keys-nudge-on"
          onClick={() => {
            count();
            void ctx.run('graph.keys.move', { dFrames: 1, dValue: 0 });
          }}
        >
          {w.nudgeOn}
        </TouchButton>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-line" style={{ width: LABEL_WIDTH }}>
          {sheet === null ? null : <RowLabels sheet={sheet} />}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            aria-label={w.canvas}
            data-testid="halo-keys-canvas"
            className="absolute inset-0 block touch-none select-none"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </Cluster>
  );
}
