import type { Metadata, Viewport } from 'next';
import type { JSX, ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Ekza Animator',
    template: '%s · Ekza Animator',
  },
  description: 'Open-source, browser-based character animator for glTF and VRM with a Maya-grade workflow.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b1c1f',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-app text-fg antialiased">{children}</body>
    </html>
  );
}
