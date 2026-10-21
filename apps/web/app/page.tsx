import Link from 'next/link';
import type { JSX } from 'react';

const SAMPLE_CREDITS = [
  { work: '"Seed-san" VRM 1.0 model', author: 'VirtualCast, Inc.', license: 'VRM Public License 1.0' },
  { work: '"Polybot" VRM 0.x model', author: 'Polygonal Mind (100Avatars)', license: 'CC0 1.0' },
  { work: 'Universal Animation Library', author: 'Quaternius', license: 'CC0 1.0' },
] as const;

export default function LandingPage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Ekza Studio</h1>
        <p className="text-lg text-fg-2">
          An open-source, browser-based 3D studio for glTF and VRM characters, with a Maya-grade workflow: box modeling,
          circle controls, Channel Box, time slider and a Graph Editor, then lossless bakes back into your file.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/editor"
            className="rounded bg-accent-fill px-4 py-2 font-medium text-white outline-offset-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-accent-text"
          >
            Open editor
          </Link>
          <a className="text-accent-text underline-offset-4 hover:underline" href="#credits">
            Credits
          </a>
        </div>
      </header>
      <section id="credits" className="flex flex-col gap-3 text-sm text-fg-3">
        <h2 className="text-base font-semibold text-fg-2">Credits</h2>
        <ul className="flex flex-col gap-1">
          {SAMPLE_CREDITS.map((credit) => (
            <li key={credit.work}>
              {credit.work} by {credit.author}, {credit.license}.
            </li>
          ))}
        </ul>
        <p>
          Code is MIT licensed. Third-party licences of the shipped app:{' '}
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- a static text file, not a Next.js page. */}
          <a className="text-accent-text underline-offset-4 hover:underline" href="/THIRD_PARTY_NOTICES.txt">
            THIRD_PARTY_NOTICES.txt
          </a>
          .
        </p>
      </section>
    </main>
  );
}
