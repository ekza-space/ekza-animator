// The texture cap at GPU upload (STUDIO-TOUCH-SPEC S8, §20.3 item 15; ST-20): on a memory-limited device (the iOS
// memory profile) textures larger than the cap are drawn smaller when they go to the GPU — and only there. three.js
// resizes an image whose larger side exceeds `renderer.capabilities.maxTextureSize` while uploading it (through a
// canvas), so lowering that limit caps every 2D texture's GPU copy. The document's textures, the assets and every
// export keep their full bytes (a test compares export bytes with the profile on and off). Compressed (KTX2) and data
// textures are not resized by three.js and keep their size.

/** The cap of the iOS memory profile, in pixels per side. */
export const TEXTURE_CAP_PX = 2048;

/** What the cap changes of a three.js `WebGLRenderer`. */
export interface TextureCapTarget {
  readonly capabilities: { maxTextureSize: number };
}

/**
 * Caps the renderer's texture uploads at `capPx` per side (null: no cap, nothing changes); textures uploaded
 * before keep their GPU copies. The returned function restores the device limit.
 */
export function applyTextureCap(renderer: TextureCapTarget, capPx: number | null): () => void {
  if (capPx === null) return () => {};
  const capabilities = renderer.capabilities;
  const device = capabilities.maxTextureSize;
  const capped = Math.min(device, Math.max(1, Math.floor(capPx)));
  capabilities.maxTextureSize = capped;
  return () => {
    if (capabilities.maxTextureSize === capped) capabilities.maxTextureSize = device;
  };
}
