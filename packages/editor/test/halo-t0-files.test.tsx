// Halo T0 file services (STUDIO-TOUCH-SPEC S9, S10, S24, §20.4; ST-21): byte sniffing and the names sniffed files open
// under, the picker `accept` policy, SaveTicket on the iOS and non-iOS paths (share, dismissed sheet, refused share,
// the 10 s fallback, bytes still baking), the file service's iOS hand-off to the page's save prompt, and the prompt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { SavePrompt } from '../src/host/SavePrompt';
import { createDownloadService, hasSaveTickets } from '../src/services/files';
import {
  type FileKind,
  isIosWebKit,
  nameForKind,
  pickerAccept,
  sniffFileKind,
  UNSUPPORTED_FILE_TEXT,
} from '../src/services/fileTypes';
import { createSaveQueue, createSaveTicket, type SavePlatform, SHARE_TIMEOUT_MS } from '../src/services/saveTicket';
import { byTestId, render, update } from './render';

const encoder = new TextEncoder();

async function fixture(path: string): Promise<Uint8Array> {
  const base64 = await commands.readFile(`../../${path}`, 'base64');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A GLB with this JSON chunk (no binary chunk). */
function glb(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const chunk = encoder.encode(text);
  const out = new Uint8Array(20 + chunk.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, chunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  return out;
}

/** The first local header of a zip whose first entry is `name`. */
function zipHead(name: string): Uint8Array {
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(30 + nameBytes.byteLength + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(26, nameBytes.byteLength, true);
  out.set(nameBytes, 30);
  return out;
}

const IPAD_SAFARI = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  maxTouchPoints: 5,
};
const MAC_SAFARI = { ...IPAD_SAFARI, maxTouchPoints: 0 };
const IPHONE = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  maxTouchPoints: 5,
};
const CHROME_WINDOWS = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  maxTouchPoints: 10,
};

describe('sniffFileKind (S10)', () => {
  it('tells the fixtures apart by their bytes', async () => {
    expect(sniffFileKind(await fixture('fixtures/models/polybot.vrm'))).toBe('vrm'); // VRM 0.x
    expect(sniffFileKind(await fixture('fixtures/models/seed-san.vrm'))).toBe('vrm'); // VRM 1.0
    expect(sniffFileKind(await fixture('fixtures/models/cube-lad.glb'))).toBe('glb');
    expect(sniffFileKind(await fixture('apps/web/public/library/animations/idle.vrma'))).toBe('vrma');
  });

  it('reads glTF extensions from either list, projects from the zip’s first entry, JSON by its fields', () => {
    const cases: readonly (readonly [Uint8Array, FileKind])[] = [
      [glb({ asset: { version: '2.0' }, extensionsUsed: ['VRMC_vrm_animation'] }), 'vrma'],
      [glb({ asset: { version: '2.0' }, extensions: { VRMC_vrm: {} } }), 'vrm'],
      [glb({ asset: { version: '2.0' }, extensions: { VRM: {} } }), 'vrm'],
      [glb({ asset: { version: '2.0' }, skins: [{}] }), 'glb'],
      [zipHead('manifest.json'), 'project'],
      [zipHead('notes.txt'), 'zip'],
      [encoder.encode('﻿ \n{"format":"ekza-animator-doc","schemaVersion":1}'), 'projectJson'],
      [encoder.encode('{"asset":{"version":"2.0"},"scenes":[]}'), 'gltf'],
      [encoder.encode('{"hello":1}'), 'json'],
      [encoder.encode('{"truncated":'), 'unknown'],
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), 'unknown'], // a PNG
      [new Uint8Array([1, 2]), 'unknown'],
    ];
    for (const [bytes, kind] of cases) expect(sniffFileKind(bytes)).toBe(kind);
  });

  it('a GLB with a damaged JSON chunk is still a GLB (the importer reports the damage)', () => {
    const bytes = glb({ asset: { version: '2.0' } });
    bytes[24] = 0x7d; // '}' in the middle of the JSON
    expect(sniffFileKind(bytes)).toBe('glb');
  });

  it('names a sniffed file for its importer, keeping a suitable extension', () => {
    expect(nameForKind('Polybot.vrm', 'vrm')).toBe('Polybot.vrm');
    expect(nameForKind('Polybot.glb', 'vrm')).toBe('Polybot.glb');
    expect(nameForKind('Polybot', 'vrm')).toBe('Polybot.vrm');
    expect(nameForKind('scan.bin', 'glb')).toBe('scan.glb');
    expect(nameForKind('wave.glb', 'vrma')).toBe('wave.glb');
    expect(nameForKind('wave.vrm', 'vrma')).toBe('wave.vrma');
    expect(nameForKind('My Character.zip', 'project')).toBe('My Character.ekzanim');
    expect(nameForKind('debug.json', 'projectJson')).toBe('debug.json');
    expect(nameForKind('debug.txt', 'projectJson')).toBe('debug.txt.ekzanim.json');
    expect(nameForKind('.bin', 'glb')).toBe('file.glb');
    expect(nameForKind('photo.jpg', 'unknown')).toBe('photo.jpg');
    expect(UNSUPPORTED_FILE_TEXT).toMatch(/\.vrm/);
  });
});

describe('the accept policy (S10)', () => {
  it('detects iOS WebKit, including iPadOS Safari’s desktop user agent, never a Mac or a touch Windows PC', () => {
    expect(isIosWebKit(IPAD_SAFARI)).toBe(true);
    expect(isIosWebKit(IPHONE)).toBe(true);
    expect(isIosWebKit({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isIosWebKit(MAC_SAFARI)).toBe(false);
    expect(isIosWebKit(CHROME_WINDOWS)).toBe(false);
  });

  it('leaves `accept` out on iOS only', () => {
    expect(pickerAccept('.glb,.vrm', IPAD_SAFARI)).toBeUndefined();
    expect(pickerAccept('.glb,.vrm', IPHONE)).toBeUndefined();
    expect(pickerAccept('.glb,.vrm', MAC_SAFARI)).toBe('.glb,.vrm');
    expect(pickerAccept('.glb,.vrm', CHROME_WINDOWS)).toBe('.glb,.vrm');
    expect(pickerAccept('.vrma')).toBe('.vrma'); // the test browser (desktop Chrome)
  });
});

interface FakePlatform extends SavePlatform {
  readonly downloads: { readonly name: string; readonly bytes: Uint8Array; readonly mime: string }[];
  readonly shared: File[];
  shareResult: () => Promise<void>;
  sharing: boolean;
  shareable: boolean;
  /** Runs the pending fallback timer. */
  fire(): void;
}

function fakePlatform(sharing: boolean): FakePlatform {
  let timer: (() => void) | null = null;
  const platform: FakePlatform = {
    downloads: [],
    shared: [],
    sharing,
    shareable: true,
    shareResult: () => Promise.resolve(),
    prefersShare: () => platform.sharing,
    canShare: () => platform.shareable,
    share(file) {
      platform.shared.push(file);
      return platform.shareResult();
    },
    download(name, bytes, mime) {
      platform.downloads.push({ name, bytes, mime });
    },
    setTimeout(fn) {
      timer = fn;
      return 1;
    },
    clearTimeout() {
      timer = null;
    },
    fire() {
      const pending = timer;
      timer = null;
      pending?.();
    },
  };
  return platform;
}

const BYTES = new Uint8Array([1, 2, 3]);
const VRM = { name: 'Polybot.vrm', mime: 'model/gltf-binary', bytes: BYTES };

describe('SaveTicket (S9, §20.4)', () => {
  it('downloads where sharing is not preferred, once', async () => {
    const platform = fakePlatform(false);
    const ticket = createSaveTicket(VRM, platform);
    expect(ticket.state).toBe('ready');
    expect(platform.downloads).toHaveLength(0); // nothing leaves before deliver()
    expect(await ticket.deliver()).toBe('downloaded');
    expect(await ticket.deliver()).toBe('downloaded');
    expect(platform.downloads).toEqual([{ name: 'Polybot.vrm', bytes: BYTES, mime: 'model/gltf-binary' }]);
    expect(ticket.state).toBe('delivered');
    expect(ticket.delivered).toBe('downloaded');
  });

  it('shares on iOS: the share starts inside the tap, before any await', async () => {
    const platform = fakePlatform(true);
    const ticket = createSaveTicket(VRM, platform);
    const delivery = ticket.deliver();
    expect(platform.shared).toHaveLength(1); // synchronously
    const file = platform.shared[0] as File;
    expect([file.name, file.type, file.size]).toEqual(['Polybot.vrm', 'model/gltf-binary', 3]);
    expect(await delivery).toBe('shared');
    expect(platform.downloads).toHaveLength(0);
    expect(ticket.delivered).toBe('shared');
  });

  it('a dismissed share sheet leaves the ticket ready for another tap', async () => {
    const platform = fakePlatform(true);
    platform.shareResult = () => Promise.reject(new DOMException('dismissed', 'AbortError'));
    const ticket = createSaveTicket(VRM, platform);
    expect(await ticket.deliver()).toBe('cancelled');
    expect(ticket.state).toBe('ready');
    platform.shareResult = () => Promise.resolve();
    expect(await ticket.deliver()).toBe('shared');
    expect(platform.shared).toHaveLength(2);
  });

  it('falls back to Downloads when canShare refuses the file or share() refuses the call', async () => {
    const refusedType = fakePlatform(true);
    refusedType.shareable = false;
    expect(await createSaveTicket(VRM, refusedType).deliver()).toBe('downloaded');
    expect(refusedType.shared).toHaveLength(0);
    const noActivation = fakePlatform(true);
    noActivation.shareResult = () => Promise.reject(new DOMException('no activation', 'NotAllowedError'));
    expect(await createSaveTicket(VRM, noActivation).deliver()).toBe('downloaded');
    expect(noActivation.downloads).toHaveLength(1);
  });

  it('falls back to Downloads when share() has not settled in time (WebKit 234187), and ignores it later', async () => {
    expect(SHARE_TIMEOUT_MS).toBe(10_000);
    const platform = fakePlatform(true);
    let settle: () => void = () => {};
    platform.shareResult = () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    const ticket = createSaveTicket(VRM, platform);
    const delivery = ticket.deliver();
    expect(ticket.deliver()).toBe(delivery); // in flight: the same delivery
    platform.fire();
    expect(await delivery).toBe('downloaded');
    settle();
    await Promise.resolve();
    expect(ticket.delivered).toBe('downloaded');
    expect(platform.downloads).toHaveLength(1);
  });

  it('waits for bytes still baking; a failed bake fails the ticket', async () => {
    const platform = fakePlatform(false);
    let bake: (bytes: Uint8Array) => void = () => {};
    const onBytes = vi.fn<(bytes: Uint8Array) => void>();
    const ticket = createSaveTicket(
      { ...VRM, bytes: new Promise<Uint8Array>((resolve) => (bake = resolve)) },
      platform,
      { onBytes },
    );
    expect(ticket.state).toBe('preparing');
    const delivery = ticket.deliver();
    bake(BYTES);
    await ticket.ready;
    expect(onBytes).toHaveBeenCalledWith(BYTES);
    expect(await delivery).toBe('downloaded');

    const failed = createSaveTicket({ ...VRM, bytes: Promise.reject(new Error('bake failed')) }, platform);
    await expect(failed.ready).rejects.toThrow('bake failed');
    expect(failed.state).toBe('failed');
    await expect(failed.deliver()).rejects.toThrow('bake failed');
  });
});

describe('the file service (S9: every export goes through tickets on iOS)', () => {
  it('downloads at once off iOS and records every file', () => {
    const platform = fakePlatform(false);
    const records: string[] = [];
    const queue = createSaveQueue();
    const service = createDownloadService((r) => records.push(r.fileName), { platform, queue });
    service.download('a.glb', BYTES, 'model/gltf-binary');
    expect(platform.downloads.map((d) => d.name)).toEqual(['a.glb']);
    expect(queue.tickets).toHaveLength(0);
    expect(records).toEqual(['a.glb']);
    expect(hasSaveTickets(service)).toBe(true);
  });

  it('on iOS a download waits in the queue for the prompt, which the service shows when none is attached', async () => {
    const platform = fakePlatform(true);
    const queue = createSaveQueue();
    const showPrompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const records: string[] = [];
    const service = createDownloadService((r) => records.push(r.fileName), { platform, queue, showPrompt });
    service.download('a.vrm', BYTES, 'model/gltf-binary');
    expect(records).toEqual(['a.vrm']); // the recorder does not wait for the tap
    expect(platform.downloads).toHaveLength(0);
    expect(queue.tickets.map((t) => t.fileName)).toEqual(['a.vrm']);
    expect(showPrompt).toHaveBeenCalledTimes(1);
    const detach = queue.attach();
    service.download('b.vrma', BYTES, 'model/gltf-binary');
    expect(showPrompt).toHaveBeenCalledTimes(1); // an attached prompt shows it
    expect(queue.tickets).toHaveLength(2);
    expect(await queue.tickets[0]?.deliver()).toBe('shared');
    expect(queue.tickets.map((t) => t.fileName)).toEqual(['b.vrma']); // delivered tickets leave
    detach();
  });

  it('downloads instead when the prompt cannot be shown', async () => {
    const platform = fakePlatform(true);
    const queue = createSaveQueue();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createDownloadService(undefined, {
      platform,
      queue,
      showPrompt: () => Promise.reject(new Error('chunk failed')),
    });
    service.download('a.vrm', BYTES, 'model/gltf-binary');
    await vi.waitFor(() => expect(platform.downloads.map((d) => d.name)).toEqual(['a.vrm']));
    expect(queue.tickets).toHaveLength(0);
    error.mockRestore();
  });

  it('save() hands the caller a ticket and records the bytes once they are there', async () => {
    const platform = fakePlatform(false);
    const records: string[] = [];
    const service = createDownloadService((r) => records.push(r.fileName), { platform, queue: createSaveQueue() });
    const ticket = service.save({ name: 'Cube Lad.ekzanim', mime: 'application/zip', bytes: Promise.resolve(BYTES) });
    await ticket.ready;
    expect(records).toEqual(['Cube Lad.ekzanim']);
    expect(platform.downloads).toHaveLength(0);
    expect(await ticket.deliver()).toBe('downloaded');
  });
});

describe('SavePrompt', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows the oldest waiting file, delivers it on a tap, then says where it went', async () => {
    const platform = fakePlatform(true);
    const queue = createSaveQueue();
    const view = await render(<SavePrompt queue={queue} />);
    expect(view.container.querySelector('[data-testid="save-prompt"]')).toBeNull();
    expect(queue.attached).toBe(1);
    let bake: (bytes: Uint8Array) => void = () => {};
    const ticket = createSaveTicket(
      { ...VRM, bytes: new Promise<Uint8Array>((resolve) => (bake = resolve)) },
      platform,
    );
    await update(() => queue.offer(ticket));
    expect(byTestId(view.container, 'save-prompt-file').textContent).toBe('Preparing Polybot.vrm…');
    expect((byTestId(view.container, 'save-prompt-deliver') as HTMLButtonElement).disabled).toBe(true);
    await update(async () => {
      bake(BYTES);
      await ticket.ready;
    });
    expect(byTestId(view.container, 'save-prompt-file').textContent).toBe('Polybot.vrm is ready');
    const deliver = byTestId(view.container, 'save-prompt-deliver') as HTMLButtonElement;
    expect(deliver.disabled).toBe(false);
    expect(deliver.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await update(() => deliver.click());
    expect(platform.shared).toHaveLength(1);
    expect(byTestId(view.container, 'save-prompt-note').textContent).toBe(
      'Shared · iPad does not confirm where it went',
    );
    await view.unmount();
    expect(queue.attached).toBe(0);
  });

  it('✕ discards the file without saving it', async () => {
    const platform = fakePlatform(true);
    const queue = createSaveQueue();
    const view = await render(<SavePrompt queue={queue} />);
    await update(() => queue.offer(createSaveTicket(VRM, platform)));
    await update(() => byTestId(view.container, 'save-prompt-dismiss').click());
    expect(queue.tickets).toHaveLength(0);
    expect(view.container.querySelector('[data-testid="save-prompt"]')).toBeNull();
    expect(platform.shared).toHaveLength(0);
    expect(platform.downloads).toHaveLength(0);
    await view.unmount();
  });
});
