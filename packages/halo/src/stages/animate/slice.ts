// The Animate stage's slice of the test API's `halo()` (STUDIO-TOUCH-SPEC §20.7; T7): plain JSON for `page.evaluate` —
// the Thread (its layer, the ruler's geometry in page px, the key dots, the playhead, the band, playing, Rec and the
// Auto Key the kernel sees), the Animations row, the docked Halo and the Library's preview.
import type { HaloController } from '../../shell/controller';
import { stripProbe } from '../../thread/strip/ThreadStrip';
import { currentFrame, keyDots, threadContext } from '../../thread/strip/model';
import { PANE } from '../../shell/stage';
import { activeClip, animateCharacter, animationsOf, reachLimbOf } from './model';

/**
 * A page point on the lead selected control that Reach takes (its shape or mesh, not the manipulator), or null: the
 * nearest one around the control's pick point (e2e probes, ha-06).
 */
function reachPoint(controller: HaloController): { readonly x: number; readonly y: number } | null {
  const { app } = controller.ctx;
  const vm = controller.ctx.vm();
  const lead = app.session.getState().selection.controls.at(-1);
  if (vm === null || lead === undefined || reachLimbOf(app, lead) === null) return null;
  const rect = vm.paneRect(PANE);
  const at = vm.controlScreenPoint(PANE, lead);
  if (rect === null || at === null) return null;
  for (let r = 0; r <= 60; r += 4) {
    const steps = r === 0 ? 1 : 16;
    for (let i = 0; i < steps; i++) {
      const x = at.x + r * Math.cos((i / steps) * Math.PI * 2);
      const y = at.y + r * Math.sin((i / steps) * Math.PI * 2);
      const hit = vm.pick(PANE, x, y);
      const control = hit?.kind === 'control' ? hit.control : hit?.kind === 'mesh' ? hit.control : null;
      if (control === lead) return { x: rect.x + x, y: rect.y + y };
    }
  }
  return null;
}
import { animateUi } from './ui';

export function animateSlice(controller: HaloController): Record<string, unknown> {
  const { app, store } = controller.ctx;
  const thread = threadContext(app);
  const ui = animateUi(store).get();
  const character = animateCharacter(app);
  const { dots, faint } = thread === null ? { dots: [], faint: true } : keyDots(app, thread);
  const prefs = app.prefs.getState();
  return {
    thread: {
      layer: store.get().threadLayer,
      ruler: stripProbe(controller),
      clip: thread?.clip.name ?? null,
      range: thread?.range ?? null,
      frame: thread === null ? null : currentFrame(app, thread),
      playing: app.session.getState().time.playing,
      band: app.session.getState().time.band,
      dots: dots.map((dot) => ({ frame: dot.frame, selected: dot.selected, inBetween: dot.inBetween })),
      faint,
      rec: store.get().rec,
      autoKey: prefs.autoKey,
      autoKeyMode: prefs.autoKeyMode,
    },
    animations: animationsOf(app, character).map((clip) => clip.name),
    active: activeClip(app, character)?.name ?? null,
    docked: ui.docked,
    newCard: ui.newCard,
    transport: ui.transport,
    preview: app.library.loaded ? (app.library.service.preview?.clip ?? null) : null,
    reachPoint: reachPoint(controller),
  };
}
