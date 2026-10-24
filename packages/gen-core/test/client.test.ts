import { createGenerationClient, formatSseEvent, GEN_PROTOCOL, type GenJob, sha256Hex } from '../src/index.ts';

const job = (revision: number, state: GenJob['state']): GenJob => ({
  id: 'j1',
  revision,
  provider: 'mock',
  op: 'text-to-model',
  model: 'm1',
  state,
  submitted: true,
  progress: null,
  typicalSeconds: null,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
  quoteUsd: 0.1,
  costUsd: null,
  error: null,
  artifacts: [],
  provenance: null,
  idempotencyKey: 'abcdefghijklmnop',
});

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GenerationClient', () => {
  it('sends the bearer token, maps error envelopes and refuses another protocol', async () => {
    const seen: Headers[] = [];
    const client = createGenerationClient({
      baseUrl: '/api/gen/',
      token: () => 'tok',
      fetch: async (url, init) => {
        seen.push(new Headers(init?.headers));
        if (urlOf(url) === '/api/gen/v1/providers') return respond(200, { protocol: 'other/v9', providers: [] });
        return respond(402, { error: { code: 'spend-cap', message: 'Daily cap reached.', retryable: false } });
      },
    });
    await expect(client.providers()).rejects.toMatchObject({ code: 'protocol' });
    await expect(client.job('j1')).rejects.toMatchObject({ code: 'spend-cap', status: 402, retryable: false });
    expect(seen[0]?.get('authorization')).toBe('Bearer tok');
  });

  it('sends a BYO key only with quotes and submits, and validates before sending', async () => {
    const keys: (string | null)[] = [];
    const client = createGenerationClient({
      baseUrl: '/g',
      providerKey: () => 'byo-secret',
      fetch: async (_url, init) => {
        keys.push(new Headers(init?.headers).get('x-gen-provider-key'));
        return respond(200, job(1, 'queued'));
      },
    });
    const req = {
      provider: 'mock',
      op: 'text-to-model' as const,
      prompt: 'a chair',
      params: {},
      idempotencyKey: 'abcdefghijklmnop',
      maxCostUsd: 1,
      attestation: { tier: 'paid' as const },
    };
    await client.submit(req);
    await client.job('j1');
    expect(keys).toEqual(['byo-secret', null]);
    await expect(client.submit({ ...req, idempotencyKey: 'x' })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('verifies artifact bytes against their SHA-256', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sha = await sha256Hex(bytes);
    let tamper = false;
    const client = createGenerationClient({
      baseUrl: '/g',
      fetch: async () => new Response(tamper ? new Uint8Array([9]) : bytes),
    });
    expect(await client.artifact(sha)).toEqual(bytes);
    tamper = true;
    await expect(client.artifact(sha)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('streams job snapshots until a terminal state, then falls back to polling when the stream fails', async () => {
    const stream = (states: GenJob['state'][]): Response =>
      new Response(
        new ReadableStream({
          start(c) {
            const enc = new TextEncoder();
            states.forEach((s, i) =>
              c.enqueue(enc.encode(formatSseEvent('job', JSON.stringify(job(i + 1, s)), i + 1))),
            );
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      const client = createGenerationClient({ baseUrl: '/g', fetch: async () => stream(['running', 'succeeded']) });
      client.watch('j1', (j) => {
        seen.push(j.state);
        if (j.state === 'succeeded') resolve();
      });
    });
    expect(seen).toEqual(['running', 'succeeded']);

    const polled: string[] = [];
    let polls = 0;
    await new Promise<void>((resolve) => {
      const client = createGenerationClient({
        baseUrl: '/g',
        pollMs: 1,
        fetch: async (url) => {
          if (urlOf(url).endsWith('/events')) return respond(503, {});
          polls++;
          return respond(200, job(polls, polls < 3 ? 'running' : 'succeeded'));
        },
      });
      client.watch('j1', (j) => {
        polled.push(j.state);
        if (j.state === 'succeeded') resolve();
      });
    });
    expect(polled).toEqual(['running', 'running', 'succeeded']);
  });

  it('declares the protocol id', () => {
    expect(createGenerationClient({ baseUrl: '/g' }).protocol).toBe(GEN_PROTOCOL);
  });
});
