// Ekza Studio never decodes or encodes textures in Node. ndarray-pixels (via @gltf-transform/functions)
// imports `sharp` eagerly; this stub keeps that import working without installing LGPL libvips (ADR 0009).
export default function sharp() {
  throw new Error(
    'sharp is not installed in Ekza Studio (ADR 0009): image decoding through ndarray-pixels is unavailable in Node.',
  );
}
