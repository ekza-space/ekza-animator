// CommonJS twin of index.mjs (see that file for the rationale).
module.exports = function sharp() {
  throw new Error(
    'sharp is not installed in Ekza Studio (ADR 0009): image decoding through ndarray-pixels is unavailable in Node.',
  );
};
