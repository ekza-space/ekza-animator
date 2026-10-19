// MCP-SPEC §9.2 `check:size` (P1, MAI-P1-16): the explicit-target operators' full polls and applies load on first use.
// Before the load a bare poll answers the shape check (an editable document and an existing clip) and starts the load;
// a run's outcome never depends on it, because the runner polls again after `prepare`, which awaits the load. This
// file must not load the implementation before its first test (vitest isolates the module registry per file).
import { describe, expect, it } from 'vitest';
import { loadAgentImpl, loadedAgentImpl } from '../../src/operators/builtin/agentLoad';
import { agentRefusal, asAgent, opsApp, WAVE } from './support';

describe('agent operators load on first use', () => {
  it('answers the shape check before the load and the full check after it; runs refuse with the full reason', async () => {
    expect(loadedAgentImpl()).toBeNull();
    const app = opsApp();
    const empty = { clip: WAVE.clip, keys: [] };
    expect(app.operators.poll('key.write', asAgent(), {})).toEqual({ ok: false, reason: 'expects { clip, … }' });
    expect(app.operators.poll('key.write', asAgent(), { clip: 'clip_nope' })).toEqual({
      ok: false,
      reason: 'The clip does not exist',
    });
    // Shape only: the empty key list is the full check's refusal.
    expect(app.operators.poll('key.write', asAgent(), empty)).toBe(true);
    expect(await agentRefusal(app, 'key.write', empty)).toBe('keys is empty');
    expect(loadedAgentImpl()).not.toBeNull();
    expect(app.operators.poll('key.write', asAgent(), empty)).toEqual({ ok: false, reason: 'keys is empty' });
    expect(await loadAgentImpl()).toBe(loadedAgentImpl());
  });
});
