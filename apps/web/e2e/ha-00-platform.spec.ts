// ha-00 — Halo T0, platform (STUDIO-TOUCH-SPEC §19, §20.7, §21 T0 exit; AS-ST-1's compatibility part). Runs on
// `chrome`, `chrome-touch` and `webkit-ipad`:
// - `/editor` and `/autorig` boot and render (the e2e test API, WebGL frames, a drawn sample), in landscape and, on
//   WebKit, in portrait; the page's memory profile is named on the GL host (`ios` on the iPad, `standard` elsewhere);
// - the memory profile's canvas: DPR capped at 1.5 above 4 MP, MSAA off above 5 MP (a 13-inch iPad on WebKit);
// - the device preference override never reaches storage;
// - file pickers carry no `accept` on the iPad (the bytes are sniffed) and keep it elsewhere;
// - a file the page saves waits for the save prompt on the iPad and leaves through the (mocked) share sheet on a tap;
//   elsewhere it downloads at once;
// - export bytes are identical with the memory profile on and off, with a texture above the 2048 cap (Chrome).
// `webkit-ipad` is desktop WebKit: it proves compatibility only, not iOS gestures, Web Share, Files or memory.
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { openAutoRig } from './helpers/autorig';
import { exportOne, sampleBytes } from './helpers/g4-export';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, loadFile, openEditor, renderedFrames, runOk } from './helpers/test-api';

const DEG = Math.PI / 180;
const isIpad = (info: TestInfo): boolean => info.project.name === 'webkit-ipad';

/** Uncaught page errors from now on (a boot on WebKit must have none). */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

/** The memory profile the GL host names. */
function profileOf(page: Page): Promise<string | null> {
  return page.getByTestId('gl-host').getAttribute('data-memory-profile');
}

/** Distinct colours in the middle of the first pane once it has rendered (a drawn scene has many). */
async function distinctColours(page: Page): Promise<number> {
  const panes = await call(page, 'panes');
  const pane = panes[0];
  if (pane === undefined) return 0;
  const { x, y, w, h } = pane.rect;
  const block = await call(page, 'pixels', pane.id, x + w / 2 - 40, y + h / 2 - 40, 80, 80);
  if (block === null) return 0;
  const colours = new Set<number>();
  for (let i = 0; i + 3 < block.data.length; i += 4) {
    colours.add(((block.data[i] ?? 0) << 16) | ((block.data[i + 1] ?? 0) << 8) | (block.data[i + 2] ?? 0));
  }
  return colours.size;
}

/** The canvas's pixel ratio and MSAA, as created. */
function canvasFacts(page: Page): Promise<{ ratio: number; antialias: boolean | null }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="gl-host"] canvas');
    if (canvas === null) return { ratio: 0, antialias: null };
    const context = canvas.getContext('webgl2');
    return { ratio: canvas.width / canvas.clientWidth, antialias: context?.getContextAttributes()?.antialias ?? null };
  });
}

/** What the memory profile decides for this page's screen (the rule of `host/memoryProfile.ts`, ST-20). */
function expectedCanvas(page: Page): Promise<{ maxDpr: number; antialias: boolean; dpr: number }> {
  return page.evaluate(() => {
    const css = Math.max(screen.width * screen.height, innerWidth * innerHeight);
    const mp = (css * devicePixelRatio * devicePixelRatio) / 1_000_000;
    return { maxDpr: mp > 4 ? 1.5 : 2, antialias: mp <= 5, dpr: devicePixelRatio };
  });
}

test.describe('ha-00: /editor and /autorig boot and render', () => {
  test('/editor boots, renders a sample and names its memory profile', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await openEditor(page);
    await expectKernelStarted(page);
    const webgl = await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.webgl.ok ?? false);
    expect(webgl, 'WebGL 2').toBe(true);
    await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);
    expect(await profileOf(page)).toBe(isIpad(testInfo) ? 'ios' : 'standard');
    await seedSample(page, 'polybot');
    await expect.poll(() => distinctColours(page), { timeout: 30_000 }).toBeGreaterThan(16);
    if (isIpad(testInfo)) {
      const expected = await expectedCanvas(page);
      const facts = await canvasFacts(page);
      expect(facts.ratio).toBeCloseTo(Math.min(expected.dpr, expected.maxDpr), 1);
      expect(facts.antialias).toBe(expected.antialias);
      testInfo.annotations.push({ type: 'canvas', description: JSON.stringify({ ...facts, ...expected }) });
    }
    expect(errors).toEqual([]);
  });

  test('/autorig boots, renders and names its memory profile; its pickers follow the accept policy', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await openAutoRig(page);
    await expect(page.locator('[data-shell="ekza-autorig-shell"]')).toBeVisible();
    await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);
    expect(await profileOf(page)).toBe(isIpad(testInfo) ? 'ios' : 'standard');
    await expect.poll(() => distinctColours(page), { timeout: 30_000 }).toBeGreaterThan(1);
    const picker = page.locator('input[type="file"]').first();
    await expect(picker).toHaveCount(1);
    if (isIpad(testInfo)) expect(await picker.getAttribute('accept')).toBeNull();
    else expect(await picker.getAttribute('accept')).toContain('.vrm');
    expect(errors).toEqual([]);
  });
});

test.describe('ha-00: iPad portrait', () => {
  test.use({ viewport: { width: 834, height: 1194 } });

  test('/editor boots and renders in portrait', async ({ page }, testInfo) => {
    test.skip(!isIpad(testInfo), 'WebKit iPad only');
    test.setTimeout(120_000);
    await openEditor(page);
    await expectKernelStarted(page);
    await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);
    await seedSample(page, 'polybot');
    await expect.poll(() => distinctColours(page), { timeout: 30_000 }).toBeGreaterThan(16);
  });
});

test.describe('ha-00: a 13-inch iPad (5.6 MP)', () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test('the canvas caps its DPR at 1.5 and has no MSAA', async ({ page }, testInfo) => {
    test.skip(!isIpad(testInfo), 'WebKit iPad only');
    test.setTimeout(120_000);
    await openEditor(page);
    await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);
    const facts = await canvasFacts(page);
    expect(facts.ratio).toBeCloseTo(1.5, 1);
    expect(facts.antialias).toBe(false);
  });
});

test('ha-00: the device override never reaches the stored preferences', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const ns = `ha00-${testInfo.project.name}-${Date.now()}`;
  await openEditor(page, `&ns=${ns}${isIpad(testInfo) ? '' : '&memoryProfile=ios'}`);
  expect(await profileOf(page)).toBe('ios');
  await runOk(page, 'view.setNavProfile', { profile: 'trackpad' });
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as { navProfile: string; modeling: unknown } | null,
    `ekza-animator:ns:${ns}:ekza-animator.prefs`,
  );
  expect(stored?.navProfile).toBe('trackpad');
  expect(stored?.modeling).toMatchObject({ undoBudgetMB: 256, journalBudgetMB: 64 });
});

test('ha-00: a saved file waits for the save prompt on the iPad and leaves on a tap; elsewhere it downloads', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  if (isIpad(testInfo)) {
    // Web Share mocked: WebKit on macOS cannot show the iPad's share sheet.
    await page.addInitScript(() => {
      const shared: { name: string; size: number; type: string }[] = [];
      (window as unknown as { __ha00Shared: typeof shared }).__ha00Shared = shared;
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: (data?: { files?: File[] }) => (data?.files ?? []).length > 0,
      });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: (data?: { files?: File[] }) => {
          for (const file of data?.files ?? []) shared.push({ name: file.name, size: file.size, type: file.type });
          return Promise.resolve();
        },
      });
    });
  }
  await openEditor(page);
  if (!isIpad(testInfo)) {
    const download = page.waitForEvent('download');
    await runOk(page, 'file.saveJson', {});
    expect((await download).suggestedFilename()).toMatch(/\.ekzanim\.json$/);
    await expect(page.getByTestId('save-prompt')).toHaveCount(0);
    return;
  }
  await runOk(page, 'file.saveJson', {});
  const prompt = page.getByTestId('save-prompt');
  await expect(prompt).toBeVisible();
  const name = (await page.getByTestId('save-prompt-file').textContent())?.replace(/ is ready$/, '') ?? '';
  expect(name).toMatch(/\.ekzanim\.json$/);
  const deliver = page.getByTestId('save-prompt-deliver');
  const box = await deliver.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await deliver.tap();
  await expect(page.getByTestId('save-prompt-note')).toHaveText('Shared · iPad does not confirm where it went');
  const shared = await page.evaluate(() => (window as unknown as { __ha00Shared: { name: string }[] }).__ha00Shared);
  expect(shared.map((file) => file.name)).toEqual([name]);
  // the recorder saw it when its bytes were ready, before the tap
  expect((await call(page, 'lastExport'))?.fileName).toBe(name);
});

// ---------- export bytes with the memory profile on and off (Chrome) ----------

/** A solid RGB PNG (`width` × `height`), encoded here. */
function solidPng(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([0xa9, 0x96, 0xff], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A GLB with every image replaced by `png` (bufferViews rewritten in order, 4-byte aligned; extensions kept). */
function withImage(glb: Uint8Array, png: Buffer): Uint8Array {
  const source = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = source.readUInt32LE(12);
  const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images: { bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number; buffer: number }[];
    buffers: { byteLength: number }[];
  };
  const binStart = 20 + jsonLength + 8;
  const imageViews = new Set(json.images.map((image) => image.bufferView));
  const parts: Buffer[] = [];
  let offset = 0;
  for (const [index, view] of json.bufferViews.entries()) {
    const start = binStart + (view.byteOffset ?? 0);
    const data = imageViews.has(index) ? png : source.subarray(start, start + view.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) parts.push(Buffer.alloc(pad));
    offset += pad;
    view.byteOffset = offset;
    view.byteLength = data.length;
    parts.push(data);
    offset += data.length;
  }
  parts.push(Buffer.alloc((4 - (offset % 4)) % 4));
  const bin = Buffer.concat(parts);
  (json.buffers[0] as { byteLength: number }).byteLength = bin.length;
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonChunk = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonChunk.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonChunk.length);
  bin.copy(out, 28 + jsonChunk.length);
  return new Uint8Array(out);
}

/** Loads the wide-texture Polybot, keys a wave and bakes it; returns the export's SHA-256 and the resize warnings. */
async function bakeWithProfile(page: Page, profile: 'ios' | 'standard', model: Uint8Array) {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('Texture has been resized'))
      warnings.push(message.text());
  });
  await openEditor(page, `&memoryProfile=${profile}`);
  expect(await profileOf(page)).toBe(profile);
  await loadFile(page, 'polybot-wide.vrm', model, { auto: true });
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await expect.poll(() => distinctColours(page), { timeout: 30_000 }).toBeGreaterThan(1);
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'wave' });
  const control = await controlId(page, 'fk.lowerArm.L', character);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control, channel: 'rz', value: degrees * DEG }] });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const baked = await exportOne(page, { kind: 'bake-into-model', character, clips: [clip] });
  return { sha256: createHash('sha256').update(baked.bytes).digest('hex'), warnings };
}

test('ha-00: export bytes are identical with the memory profile on and off (a 4096-wide texture)', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'Chrome only (forced profiles)');
  test.setTimeout(240_000);
  const model = withImage(sampleBytes('polybot.vrm'), solidPng(4096, 256));
  const run = async (profile: 'ios' | 'standard') => {
    const context = await browser.newContext({
      ...(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL }),
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await context.newPage();
      const result = await bakeWithProfile(page, profile, model);
      // the cap ran on the GPU copy only (three.js says so when it resizes at upload)
      if (profile === 'ios') await expect.poll(() => result.warnings.length, { timeout: 30_000 }).toBeGreaterThan(0);
      return result;
    } finally {
      await context.close();
    }
  };
  const on = await run('ios');
  const off = await run('standard');
  expect(on.warnings[0]).toContain('from (4096x256) to (2048x128)');
  expect(off.warnings).toEqual([]);
  expect(on.sha256).toBe(off.sha256);
});
