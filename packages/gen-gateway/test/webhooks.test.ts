import { signTripoWebhook, startMockProviders } from '../src/testing/index.ts';
import { TRIPO_WEBHOOK_WINDOW_S } from '../src/index.ts';
import { request, setup } from './helpers.ts';

const SECRET = 'whsec_test_0123456789abcdef';

describe('webhooks', () => {
  it('Tripo: HMAC over t.rawBody, 5-minute window, dedupe by delivery id; never trusts the body', async () => {
    const mock = await startMockProviders({ pollsQueued: { tripo: 100_000 } });
    const s = await setup({ mock, env: { GEN_PUBLIC_URL: 'https://gen.example', TRIPO_WEBHOOK_SECRET: SECRET } });
    try {
      const job = await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: 'a cup' }));
      let taskId = '';
      for (let i = 0; i < 500 && taskId === ''; i++) {
        taskId = [...mock.tasks.keys()][0] ?? '';
        await new Promise((r) => setTimeout(r, 2));
      }
      // A forged "success" body: the gateway only re-polls; the job stays queued at the provider.
      const body = JSON.stringify({
        id: `${taskId}:task.completed`,
        type: 'task.completed',
        data: { task_id: taskId, status: 'success', output: { model_url: 'https://evil.example/x.glb' } },
      });
      const now = Math.floor(Date.now() / 1000);
      const post = async (sig: string, delivery: string, raw = body): Promise<Response> =>
        s.fetch('/api/gen/v1/hooks/tripo', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'tripo-webhook-signature': sig,
            'tripo-webhook-delivery': delivery,
          },
          body: raw,
        });
      expect((await post(await signTripoWebhook(SECRET, body, now), 'd1')).status).toBe(200);
      expect(await (await post(await signTripoWebhook(SECRET, body, now), 'd1')).json()).toEqual({
        ok: true,
        duplicate: true,
      });
      expect((await post(await signTripoWebhook('wrong-secret-0123456789', body, now), 'd2')).status).toBe(401);
      expect((await post(await signTripoWebhook(SECRET, body, now - TRIPO_WEBHOOK_WINDOW_S - 5), 'd3')).status).toBe(
        401,
      );
      expect((await post(await signTripoWebhook(SECRET, body, now), 'd4', `${body} `)).status).toBe(401);
      expect((await post('garbage', 'd5')).status).toBe(401);
      expect(s.lines.some((l) => l.includes('webhook.accepted') && l.includes('"known":true'))).toBe(true);
      const j = await s.client.job(job.id);
      expect(j.state).not.toBe('succeeded');
      expect(mock.requests.some((r) => r.path.includes('evil'))).toBe(false);
    } finally {
      await s.close();
      await mock.close();
    }
  });

  it('Meshy: unsigned callbacks are hints only (unknown or malformed ids are ignored)', async () => {
    const s = await setup({ env: { GEN_PUBLIC_URL: 'https://gen.example' } });
    try {
      const hint = await s.fetch('/api/gen/v1/hooks/meshy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'not-a-task',
          status: 'SUCCEEDED',
          model_urls: { glb: 'https://evil.example/x.glb' },
        }),
      });
      expect(hint.status).toBe(200);
      expect(s.lines.some((l) => l.includes('webhook.accepted') && l.includes('"known":false'))).toBe(true);
      const bad = await s.fetch('/api/gen/v1/hooks/meshy', { method: 'POST', body: '{"id":"../../etc"}' });
      expect(bad.status).toBe(401);
      // Tripo without a configured secret: no endpoint at all.
      expect((await s.fetch('/api/gen/v1/hooks/tripo', { method: 'POST', body: '{}' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
