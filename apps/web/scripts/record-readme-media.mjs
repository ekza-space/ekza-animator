#!/usr/bin/env node
// Records the README GIFs of milestone M2a (M2A-SPEC §8 Integration: "GIFs of IK walk, Dope Sheet retime and tween
// recorded from the e2e build"). Drives the e2e build through its test API and real pointer input in real Chrome,
// records each scene as a video, and converts it to a GIF with ffmpeg (palette pass).
//
// Usage: serve the e2e build (`NEXT_PUBLIC_EKZA_E2E=1 next build && next start -p <port>`), then
//   node scripts/record-readme-media.mjs --base http://localhost:<port> --out ../../docs/media
// Needs `ffmpeg` on PATH. Not part of any gate.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const base = option('--base', 'http://localhost:3100');
const out = resolve(option('--out', '../../docs/media'));
const only = option('--only', null);
const VIEW = { width: 1280, height: 800 };

const call = (page, name, ...rest) => page.evaluate(([n, r]) => window.__EKZA_ANIMATOR_TEST__[n](...r), [name, rest]);

async function run(page, op, opArgs) {
  const result = await page.evaluate(([o, a]) => window.__EKZA_ANIMATOR_TEST__.run(o, a), [op, opArgs]);
  if (result.status !== 'finished')
    throw new Error(`${op}: ${result.status} ${result.reason ?? result.error?.message ?? ''}`);
  return result.value;
}

async function open(page) {
  await page.goto(`${base}/editor?e2e=1&platform=mac`);
  await page.waitForFunction(() => window.__EKZA_ANIMATOR_TEST__ !== undefined);
  await page.evaluate(async () => {
    await window.__EKZA_ANIMATOR_TEST__.ready;
  });
}

async function controlId(page, key) {
  const control = (await call(page, 'controls')).find((c) => c.key === key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

async function key(page, control, frame, values) {
  await run(page, 'select.controls', { ids: [control], mode: 'replace' });
  await run(page, 'time.setFrame', { frame });
  await run(page, 'channel.setValues', {
    edits: Object.entries(values).map(([channel, value]) => ({ control, channel, value })),
  });
  await run(page, 'key.set', {});
}

async function settle(page, ms = 400) {
  await page.waitForTimeout(ms);
}

async function smoothDrag(page, from, to, steps = 24, stepMs = 25) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(stepMs);
  }
  await page.mouse.up();
}

/** A walk cycle as E2E-M2A-23 builds it (leg IK, cog bob and sway, half-cycle mirror), played in the split view. */
async function walk(page) {
  await run(page, 'file.loadSample', { sample: 'polybot' });
  await run(page, 'clip.new', { name: 'walk' });
  const clip = (await call(page, 'state')).activeClip;
  await run(page, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true, slot: 'walk' });
  const ik = await controlId(page, 'ik.leg.L');
  const cog = await controlId(page, 'cog');
  for (const [frame, tz, ty] of [
    [0, 0.15, 0],
    [12, -0.15, 0],
    [18, 0, 0.06],
    [24, 0.15, 0],
  ]) {
    await key(page, ik, frame, { tz, ty });
  }
  for (const [frame, ty, tx] of [
    [0, -0.05, 0],
    [6, -0.02, 0.02],
    [12, -0.05, 0],
    [18, -0.02, -0.02],
    [24, -0.05, 0],
  ]) {
    await key(page, cog, frame, { ty, tx });
  }
  await run(page, 'select.controls', { ids: [ik], mode: 'replace' });
  await run(page, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle' });
  await run(page, 'select.controls', { ids: [], mode: 'replace' });
  await run(page, 'time.setFrame', { frame: 0 });
  await settle(page, 800);
  return {
    async act() {
      await run(page, 'time.play');
      await page.waitForTimeout(3300);
      await run(page, 'time.togglePlay');
      await settle(page, 300);
    },
  };
}

/** The Dope Sheet: three arm controls keyed 0/10/20, ripple on, the summary glyph at 10 dragged to 15, undo. */
async function dopeSheet(page) {
  await run(page, 'file.loadSample', { sample: 'polybot' });
  const arm = [];
  for (const k of ['fk.shoulder.L', 'fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L']) arm.push(await controlId(page, k));
  const deg = Math.PI / 180;
  for (const [frame, rz] of [
    [0, 0],
    [10, 35],
    [20, 70],
    [30, 20],
  ]) {
    for (const control of arm) await key(page, control, frame, { rz: rz * deg });
  }
  await run(page, 'select.controls', { ids: arm, mode: 'replace' });
  await run(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  await page.getByTestId('ds-canvas').waitFor();
  await page.waitForFunction(() => (window.__EKZA_ANIMATOR_TEST__.dopeSheet()?.canvasRect.w ?? 0) > 0);
  await run(page, 'time.setFrame', { frame: 10 });
  await settle(page, 800);
  return {
    async act() {
      await page.getByTestId('ds-ripple').click();
      await settle(page, 500);
      const glyph = await call(page, 'screenOfDopeKey', 'summary', 10);
      await page.mouse.click(glyph.x, glyph.y);
      await settle(page, 500);
      const sheet = await call(page, 'dopeSheet');
      const x15 = sheet.canvasRect.x + (15 - sheet.view.f0) * sheet.view.sx;
      await smoothDrag(page, glyph, { x: x15, y: glyph.y });
      await settle(page, 1200);
      await page.mouse.move(sheet.canvasRect.x + sheet.canvasRect.w - 20, sheet.canvasRect.y + 20);
      await page.keyboard.press('Meta+KeyZ');
      await settle(page, 1200);
    },
  };
}

/** The status-line Tween bar: an arm keyed at 0 and 20, a breakdown tweened in at 10 from 0 to +60 and back to 0. */
async function tween(page) {
  await run(page, 'file.loadSample', { sample: 'polybot' });
  const arm = await controlId(page, 'fk.upperArm.L');
  const fore = await controlId(page, 'fk.lowerArm.L');
  const deg = Math.PI / 180;
  await key(page, arm, 0, { rz: -60 * deg });
  await key(page, fore, 0, { rz: -10 * deg });
  await key(page, arm, 20, { rz: 50 * deg });
  await key(page, fore, 20, { rz: -80 * deg });
  await run(page, 'select.controls', { ids: [arm, fore], mode: 'replace' });
  await run(page, 'time.setFrame', { frame: 10 });
  await run(page, 'view.frame', { what: 'selection' });
  await settle(page, 800);
  return {
    async act() {
      const zero = await call(page, 'screenOfTween', 'status', 0);
      const right = await call(page, 'screenOfTween', 'status', 80);
      const left = await call(page, 'screenOfTween', 'status', -80);
      await page.mouse.move(zero.x, zero.y);
      await page.mouse.down();
      for (const target of [right, left, { x: (zero.x + right.x) / 2, y: zero.y }]) {
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(zero.x + ((target.x - zero.x) * i) / 20, zero.y);
          await page.waitForTimeout(30);
        }
        await settle(page, 300);
      }
      await page.mouse.up();
      await settle(page, 1200);
    },
  };
}

const SCENES = { 'm2a-ik-walk': walk, 'm2a-dope-sheet-retime': dopeSheet, 'm2a-tween': tween };

function toGif(video, gif) {
  const filters = 'fps=12,scale=800:-1:flags=lanczos';
  const palette = `${gif}.palette.png`;
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    `${filters},palettegen=stats_mode=diff`,
    palette,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    video,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gif,
  ]);
  rmSync(palette);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only !== null && only !== name) continue;
    // The whole page is recorded; the setup before the action is cut from the video afterwards.
    const dir = mkdtempSync(join(tmpdir(), `ekza-media-${name}-`));
    const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir, size: VIEW } });
    const page = await context.newPage();
    await open(page);
    const recorded = await scene(page);
    const start = Date.now();
    await recorded.act();
    const seconds = (Date.now() - start) / 1000;
    await context.close();
    const video = join(
      dir,
      readdirSync(dir).find((f) => f.endsWith('.webm')),
    );
    // Keep the last `seconds` of the video (the setup before it is cut).
    const trimmed = join(dir, 'trimmed.webm');
    const total = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString(),
    );
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(Math.max(0, total - seconds - 0.2)),
      '-i',
      video,
      trimmed,
    ]);
    const gif = join(out, `${name}.gif`);
    toGif(trimmed, gif);
    console.log(`${name}: ${seconds.toFixed(1)} s → ${gif} (${(statSync(gif).size / 1024).toFixed(0)} KiB)`);
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}
