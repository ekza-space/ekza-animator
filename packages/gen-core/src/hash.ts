// SHA-256 over WebCrypto: the same code in the browser (secure contexts), workers and Node ≥ 20.
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b];
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return toHex(new Uint8Array(digest));
}

/** The prompt's hash as recorded in provenance (Q-GEN-5): SHA-256 of the UTF-8 bytes of the text exactly as sent. */
export function promptSha256(prompt: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(prompt));
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
