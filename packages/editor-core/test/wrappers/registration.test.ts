// Registration of the UI wrappers (STUDIO-TOUCH-SPEC §20.3 item 7, T5a): a lazy chunk `loadUiWrappers` registers once
// per app with the M-AI operators they call; Studio Pro's eager registration does not contain them; they are public
// (menus, palette, search), undoable, declare no ParamDefs and are never adjustable or repeatable, so Repeat Last and
// Adjust Last behave as before; the operators they wrap stay internal; every agent run of a wrapper is refused.
import { describe, expect, it } from 'vitest';
import { BUILTIN_OPERATORS } from '../../src/operators/builtin';
import { AGENT_OPERATOR_IDS } from '../../src/operators/builtin/agentChunk';
import { loadUiWrappers, UI_WRAPPER_IDS } from '../../src/operators/builtin/uiWrapperChunk';
import { AGENT_REFUSAL } from '../../src/operators/builtin/uiWrappers';
import { opsApp, refusal, runOk, select, WAVE } from './support';

const AGENT = { source: 'api', actor: { kind: 'agent', id: 'agt_T5aWrapperTest', name: 'T5a' }, access: 'edit' };
const WRAPPED = ['pose.transfer', 'pose.setAt', 'pose.goals', 'clip.makeLoop', 'key.adjust', 'key.retime'];

describe('loadUiWrappers', () => {
  it('registers the ten wrappers once, public and undoable, without ParamDefs', async () => {
    const app = opsApp();
    for (const id of UI_WRAPPER_IDS) expect(app.operators.get(id)).toBeUndefined();
    const first = loadUiWrappers(app);
    expect(loadUiWrappers(app)).toBe(first);
    await first;
    expect(UI_WRAPPER_IDS).toHaveLength(10);
    for (const id of UI_WRAPPER_IDS) {
      const def = app.operators.get(id);
      expect([id, def?.flags]).toEqual([id, { undo: true }]);
      expect([id, def?.params, def?.tool, def?.agent]).toEqual([id, undefined, undefined, undefined]);
      expect([id, (def?.label ?? '').length > 0, (def?.description ?? '').length > 0]).toEqual([id, true, true]);
      expect([id, def?.undoLabel !== undefined]).toEqual([id, true]);
    }
    // The operators they wrap are registered with them and stay internal (agents keep them, menus never list them).
    for (const id of WRAPPED) {
      expect(AGENT_OPERATOR_IDS.has(id)).toBe(true);
      expect([id, app.operators.get(id)?.flags?.internal]).toEqual([id, true]);
    }
  });

  it("is not part of Studio Pro's eager registration", () => {
    const eager = new Set(BUILTIN_OPERATORS.map((def) => def.id));
    for (const id of UI_WRAPPER_IDS) expect([id, eager.has(id)]).toEqual([id, false]);
    const app = opsApp();
    for (const id of UI_WRAPPER_IDS) expect([id, app.operators.poll(id, {}, {}) === true]).toEqual([id, false]);
  });

  it('refuses every agent run, and never becomes Repeat Last or Adjust Last', async () => {
    const app = opsApp();
    await loadUiWrappers(app);
    for (const id of UI_WRAPPER_IDS) expect([id, await refusal(app, id, {}, AGENT)]).toEqual([id, AGENT_REFUSAL]);
    select(app, [WAVE.lowerArmL]);
    const lastRun = app.session.getState().lastRun;
    const repeat = app.operators.poll('edit.repeatLast', {}, undefined);
    await runOk(app, 'key.scaleValues', { factor: 2 });
    expect(app.session.getState().lastRun).toBe(lastRun);
    expect(app.operators.poll('edit.repeatLast', {}, undefined)).toEqual(repeat);
  });
});
