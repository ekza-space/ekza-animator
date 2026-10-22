import type { StudioHostProps } from '@ekza-studio/editor/host';

/** Inlined at build time: e2e builds expose the test API on `?e2e=1` (MVP-SPEC §4.8). */
const E2E_BUILD = process.env.NEXT_PUBLIC_EKZA_E2E === '1';

/** The host's props on both routes (M6A-SPEC §3 rule 8: development and e2e builds validate every mesh commit). */
export function hostProps(navigate: (href: string) => void): StudioHostProps {
  return {
    decoderPath: '/decoders/',
    samplesPath: '/samples/',
    libraryPath: '/library/',
    e2e: E2E_BUILD,
    kernelDebug: process.env.NODE_ENV !== 'production' || E2E_BUILD,
    navigate,
  };
}
