// io/worker (M1-stretch): the validator protocol over a real MessageChannel with the Khronos glTF-Validator.
import { EkzaError } from '@ekza-studio/anim-core';
import { readFixture } from '@ekza-studio/doc/testing';
import * as gltfValidator from 'gltf-validator';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { makeGlb, makeHostileGlb } from '../src/testing/glb';
import { validateGltf } from '../src/validate/validate';
import {
  createValidatorClient,
  type GltfValidatorModule,
  type MessageEndpoint,
  serveGltfValidator,
  VALIDATOR_PROTOCOL,
} from '../src/worker';

const ports: MessagePort[] = [];

/** Both ends of a fresh channel as protocol endpoints (closed after each test). */
function channel(): [MessageEndpoint, MessageEndpoint] {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  return [port1 as unknown as MessageEndpoint, port2 as unknown as MessageEndpoint];
}

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

describe('io/worker validator protocol', () => {
  it('returns the same report as validateGltf and leaves the caller bytes intact', async () => {
    const [worker, main] = channel();
    serveGltfValidator(worker, gltfValidator);
    const client = createValidatorClient(main);
    const bytes = readFixture('polybot.vrm');
    const before = bytes.byteLength;
    const report = await client.validate(bytes);
    expect(report).toEqual(await validateGltf(bytes));
    expect(bytes.byteLength).toBe(before);
    client.dispose();
  });

  it('answers concurrent requests by id and passes maxIssues through', async () => {
    const [worker, main] = channel();
    serveGltfValidator(worker, gltfValidator);
    const client = createValidatorClient(main);
    const broken = makeHostileGlb(['view-out-of-range']);
    const fine = makeHostileGlb([]);
    const [a, b, c] = await Promise.all([
      client.validate(broken),
      client.validate(fine),
      client.validate(broken, { maxIssues: 1 }),
    ]);
    expect(a.errors).toBeGreaterThan(0);
    expect(b.errors).toBe(0);
    expect(c.issues).toHaveLength(1);
    client.dispose();
  });

  it('turns validator failures into EkzaErrors', async () => {
    const [worker, main] = channel();
    const failing: GltfValidatorModule = {
      validateBytes: () => Promise.reject(new Error('validator crashed')),
    };
    serveGltfValidator(worker, failing);
    const client = createValidatorClient(main);
    const error = await client.validate(makeGlb({ asset: { version: '2.0' } }, null)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EkzaError);
    expect(error).toMatchObject({ code: 'internal', message: 'validator crashed' });
    client.dispose();
  });

  it('ignores foreign messages, stops serving on request and rejects pending calls on dispose', async () => {
    const [worker, main] = channel();
    const stop = serveGltfValidator(worker, gltfValidator);
    const client = createValidatorClient(main);
    // Foreign traffic on both ends is ignored.
    worker.postMessage({ protocol: 'other', id: 1 }, []);
    main.postMessage({ protocol: VALIDATOR_PROTOCOL, id: 99, ok: true, report: null }, []);
    await expect(client.validate(makeHostileGlb([]))).resolves.toMatchObject({ errors: 0 });

    stop();
    const pending = client.validate(makeHostileGlb([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'unsupported' });
    await expect(client.validate(makeHostileGlb([]))).rejects.toMatchObject({ code: 'unsupported' });
    client.dispose();
  });
});
