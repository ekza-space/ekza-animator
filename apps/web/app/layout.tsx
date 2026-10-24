import type { Metadata, Viewport } from 'next';
import type { JSX, ReactNode } from 'react';
import { isDevContour, rootMetadata } from './contour';
import './globals.css';

const DEV = isDevContour();

export const metadata: Metadata = rootMetadata(DEV);

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b1c1f',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
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
