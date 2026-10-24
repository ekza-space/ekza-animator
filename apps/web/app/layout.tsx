import type { Metadata, Viewport } from 'next';
import type { JSX, ReactNode } from 'react';
import { buildCsp, GATEWAY_URL_ENV, gatewayOrigin } from '../csp';
import { isDevContour, rootMetadata } from './contour';
import './globals.css';

const DEV = isDevContour();
/**
 * M7 G-b (ADR 0017 §1): a static export has no response headers, so its policy is a meta tag (server builds send the
 * header from `next.config.ts`). Rendered at build time; the gateway origin is the one fixed in the build config.
 */
const STATIC_CSP =
  process.env['STUDIO_STATIC_EXPORT'] === '1' || process.env['ANIMATOR_STATIC_EXPORT'] === '1'
    ? buildCsp({ dev: false, gatewayOrigin: gatewayOrigin(process.env[GATEWAY_URL_ENV]), header: false })
    : null;

export const metadata: Metadata = rootMetadata(DEV);

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b1c1f',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      {STATIC_CSP === null ? null : (
        <head>
          <meta httpEquiv="Content-Security-Policy" content={STATIC_CSP} />
        </head>
      )}
      <body className="min-h-dvh bg-app text-fg antialiased">
        {children}
        {DEV ? (
          // The DEV copy (studio.dev.ekza.io) is marked on every route; it never captures input.
          <div
            aria-hidden="true"
            data-contour="dev"
            title="Development copy (studio.dev.ekza.io), not the live Ekza Studio"
            style={{
              position: 'fixed',
              left: '50%',
              bottom: 2,
              transform: 'translateX(-50%)',
              zIndex: 2147483647,
              pointerEvents: 'none',
              padding: '1px 6px',
              borderRadius: 3,
              background: '#f59e0b',
              color: '#111',
              font: '600 10px/14px system-ui, sans-serif',
              letterSpacing: '0.08em',
            }}
          >
            DEV
          </div>
        ) : null}
      </body>
    </html>
  );
}
