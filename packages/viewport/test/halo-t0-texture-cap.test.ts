// Halo T0 (STUDIO-TOUCH-SPEC S8; ST-20): the texture cap resizes only the GPU copy of a texture larger than the cap;
// the texture's image (the document's and every export's source) keeps its size, and the device limit comes back.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTextureCap, TEXTURE_CAP_PX } from '../src/gl/textureCap';

let renderer: THREE.WebGLRenderer | null = null;
afterEach(() => {
  renderer?.dispose();
  renderer = null;
  vi.restoreAllMocks();
});

/** Renders one quad with a `width` × 8 canvas texture; returns the texture and the warnings three.js printed. */
function renderWide(target: THREE.WebGLRenderer, width: number): { texture: THREE.Texture; warnings: string[] } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 8;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#a996ff';
  context.fillRect(0, 0, width, 8);
  const texture = new THREE.CanvasTexture(canvas);
  const warnings: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture })));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  target.render(scene, camera);
  return { texture, warnings };
}

describe('applyTextureCap', () => {
  it('lowers the upload limit and restores the device limit', () => {
    const fake = { capabilities: { maxTextureSize: 16384 } };
    const restore = applyTextureCap(fake, TEXTURE_CAP_PX);
    expect(fake.capabilities.maxTextureSize).toBe(2048);
    restore();
    expect(fake.capabilities.maxTextureSize).toBe(16384);
    // never raises a smaller device limit; null changes nothing
    const small = { capabilities: { maxTextureSize: 1024 } };
    applyTextureCap(small, TEXTURE_CAP_PX);
    expect(small.capabilities.maxTextureSize).toBe(1024);
    const none = { capabilities: { maxTextureSize: 4096 } };
    applyTextureCap(none, null)();
    expect(none.capabilities.maxTextureSize).toBe(4096);
  });

  it('three.js uploads a 4096-wide texture at 2048 while its image stays 4096 wide', () => {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    if (renderer.capabilities.maxTextureSize <= TEXTURE_CAP_PX) return; // a GPU that cannot test the cap
    applyTextureCap(renderer, TEXTURE_CAP_PX);
    const { texture, warnings } = renderWide(renderer, 4096);
    expect(warnings.some((w) => w.includes('resized from (4096x8) to (2048x4)'))).toBe(true);
    expect((texture.image as HTMLCanvasElement).width).toBe(4096);
  });

  it('textures within the cap upload as they are', () => {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    applyTextureCap(renderer, TEXTURE_CAP_PX);
    const { warnings } = renderWide(renderer, 2048);
    expect(warnings.filter((w) => w.includes('resized'))).toEqual([]);
  });
});
