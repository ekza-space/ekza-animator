import type { GeneratorProvenance } from '@ekza-studio/doc';
import {
  canonicalRequest,
  canTransition,
  formatSseEvent,
  type GenProvenance,
  type GenRequest,
  isCancelable,
  isTerminal,
  parseGenRequest,
  promptSha256,
  SseReader,
  sha256Hex,
  TERMINAL_STATES,
  withPostStep,
  withPromptOptIn,
} from '../src/index.ts';

const base: GenRequest = {
  provider: 'tripo',
  op: 'text-to-model',
  prompt: 'a low-poly chair',
  params: { faceLimit: 500, lowPoly: true },
  idempotencyKey: 'abcdefghijklmnop',
  maxCostUsd: 1,
  attestation: { tier: 'paid' },
};

describe('state machine', () => {
  it('terminal states have no exits', () => {
    for (const t of TERMINAL_STATES) {
      expect(isTerminal(t)).toBe(true);
      for (const to of ['queued', 'running', 'fetching', 'succeeded'] as const)
        expect(canTransition(t, to)).toBe(false);
    }
  });
  it('allows the step back of a provider queue and forbids skipping the download', () => {
    expect(canTransition('running', 'queued')).toBe(true);
    expect(canTransition('running', 'succeeded')).toBe(false);
    expect(canTransition('fetching', 'succeeded')).toBe(true);
    expect(canTransition('submitting', 'submitting')).toBe(false);
  });
  it('cancel acts before the download only', () => {
    expect(isCancelable('queued')).toBe(true);
    expect(isCancelable('running')).toBe(true);
    expect(isCancelable('fetching')).toBe(false);
  });
});

describe('parseGenRequest', () => {
  it('accepts a valid request and canonicalizes it independently of key order', () => {
    const r = parseGenRequest(JSON.parse(JSON.stringify(base)));
    expect(r.ok).toBe(true);
    const reordered = { ...base, params: { lowPoly: true, faceLimit: 500 } };
    expect(canonicalRequest(reordered)).toBe(canonicalRequest(base));
  });
  it('refuses unknown fields, bad keys and op/input mismatches', () => {
    const cases: unknown[] = [
      { ...base, extra: 1 },
      { ...base, params: { faceLimit: 10 } },
      { ...base, params: { model_version: 'latest' } },
      { ...base, idempotencyKey: 'short' },
      { ...base, maxCostUsd: 0 },
      { ...base, op: 'image-to-model' },
      { ...base, op: 'retopology' },
      { ...base, prompt: 'x'.repeat(1001) },
      { ...base, op: 'rig', prompt: undefined, source: { job: 'a', upload: 'b' } },
      { ...base, attestation: { tier: 'gold' } },
      { ...base, provider: 'https://api.example.com' },
    ];
    expect(cases.filter((c) => parseGenRequest(c).ok)).toEqual([]);
  });
  it('accepts a retopology of an uploaded mesh', () => {
    const r = parseGenRequest({
      provider: 'meshy',
      op: 'retopology',
      source: { upload: 'up_1' },
      params: { faceLimit: 3000, quad: true },
      idempotencyKey: 'abcdefghijklmnopq',
      maxCostUsd: 0.5,
      attestation: { tier: 'paid' },
    });
    expect(r.ok).toBe(true);
  });
});

describe('SSE', () => {
  it('reads events split across chunks, skipping comments', () => {
    const text = `${formatSseEvent('job', '{"a":1}', 3)}: ping\n\n${formatSseEvent('job', 'x\ny')}`;
    const reader = new SseReader();
    const events = [
      ...reader.push(text.slice(0, 7)),
      ...reader.push(text.slice(7, 30)),
      ...reader.push(text.slice(30)),
    ];
    expect(events).toEqual([
      { event: 'job', data: '{"a":1}', id: '3' },
      { event: 'job', data: 'x\ny', id: null },
    ]);
  });
});

describe('provenance', () => {
  it('is assignable to the document record (ADR 0017 §7)', async () => {
    const p: GenProvenance = {
      kind: 'ai',
      digitalSourceType: 'trainedAlgorithmicMedia',
      service: 'tripo',
      model: 'P1-20260311',
      op: 'text-to-model',
      params: { faceLimit: 500 },
      inputSha256: [],
      termsSnapshot: { outputLicense: 'LicenseRef-Test', restrictions: ['keep-ai-marks'] },
      rawSha256: await sha256Hex(new Uint8Array([1])),
      postSteps: [],
      promptSha256: await promptSha256('a low-poly chair'),
      prompt: null,
      tier: 'paid',
      taskId: 't1',
    };
    const doc: GeneratorProvenance = p;
    expect(doc.kind).toBe('ai');
    const opted = await withPromptOptIn(p, 'a low-poly chair');
    expect(opted.prompt).toBe('a low-poly chair');
    await expect(withPromptOptIn(p, 'another prompt')).rejects.toThrow(/does not match/);
    expect(withPostStep(p, 'mesh.reduce', true).postSteps).toEqual([{ op: 'mesh.reduce', aiMarksMayBeAltered: true }]);
  });
  it('hashes like the reference SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
