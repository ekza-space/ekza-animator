// The landing page `/` = the entry chooser (AUTORIG-SPEC §3.1–§3.3, D2): two cards, Auto-Rig first (the newcomer path),
// Studio second. The cards are plain links, so they work without JavaScript, open in new tabs and are keyboard-reachable;
// `EntryChooser` (client, small) adds *Remember my choice*, and `REDIRECT_SCRIPT` (inline, runs while the page is
// parsed) applies a remembered choice unless `?chooser=1`. The credits and the third-party notice link stay.
import type { JSX } from 'react';
import { EntryChooser } from './EntryChooser';
import { ENTRY_ROUTES, REDIRECT_SCRIPT } from './entry';

const SAMPLE_CREDITS = [
  { work: '"Seed-san" VRM 1.0 model', author: 'VirtualCast, Inc.', license: 'VRM Public License 1.0' },
  { work: '"Polybot" VRM 0.x model', author: 'Polygonal Mind (100Avatars)', license: 'CC0 1.0' },
  { work: 'Universal Animation Library', author: 'Quaternius', license: 'CC0 1.0' },
  // AUTORIG-SPEC §5.2: Auto-Rig's Cube Lad sample (the M6b fixture).
  { work: '"Cube Lad" model', author: 'Ekza Studio contributors', license: 'MIT' },
] as const;

const CARDS = [
  {
    choice: 'autorig',
    glyph: '⟐',
    title: 'Auto-Rig',
    tagline: 'Rig a character in minutes',
    body: 'Upload a model, place a few markers, get a skinned skeleton, try animations, export a VRM for OMOBA and Ekza Space.',
    action: 'Start Auto-Rig',
    note: 'GLB · VRM · desktop and tablet',
  },
  {
    choice: 'studio',
    glyph: '▦',
    title: 'Studio',
    tagline: 'The full 3D package',
    body: 'Model, rig & skin, animate with the Graph Editor, export glTF, VRM and VRMA. Industry-standard DCC hotkeys and docked panels.',
    action: 'Open Studio',
    note: 'Best on a desktop',
  },
] as const;

const linkClass =
  'text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent-text';

export default function LandingPage(): JSX.Element {
  return (
    <>
      {/* Runs while the page is parsed: a remembered choice replaces `/` before the chooser paints (§3.3). */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script of this app, no user input. */}
      <script dangerouslySetInnerHTML={{ __html: REDIRECT_SCRIPT }} />
      <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-8 px-4 py-12 min-[720px]:px-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="mr-2 text-accent-text">
              ◆
            </span>
            Ekza Studio
          </h1>
          {/* The wireframe's "Source code" link waits for a public repository URL (wp-notes AR-D2-9). */}
          <nav aria-label="About" className="flex gap-4 text-sm">
            <a className={linkClass} href="#credits">
              Credits
            </a>
          </nav>
        </header>
        <section aria-labelledby="entry-question" className="flex flex-col gap-5">
          <h2 id="entry-question" className="text-xl font-medium text-fg-2">
            What do you want to do?
          </h2>
          <ul className="grid gap-4 min-[720px]:grid-cols-2" data-testid="entry-chooser">
            {CARDS.map((card) => (
              <li key={card.choice} className="flex">
                {/* A plain link (AUTORIG-SPEC §3.2): works without JavaScript; a full page load into the app. */}
                {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- the chooser's cards must work without JS. */}
                <a
                  href={ENTRY_ROUTES[card.choice]}
                  data-entry={card.choice}
                  data-testid={`entry-${card.choice}`}
                  className="group flex w-full flex-col gap-3 rounded-dialog border border-line bg-panel p-5 outline-offset-2 hover:border-line-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent-text"
                >
                  <span className="flex items-baseline gap-3">
                    <span aria-hidden="true" className="text-xl text-accent-text">
                      {card.glyph}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold uppercase tracking-wider text-fg">{card.title}</span>
                      <span className="text-fg-2">{card.tagline}</span>
                    </span>
                  </span>
                  <span className="flex-1 text-sm text-fg-3">{card.body}</span>
                  <span className="self-start rounded bg-accent-fill px-4 py-2 font-medium text-white group-hover:bg-accent">
                    {card.action} <span aria-hidden="true">→</span>
                  </span>
                  <span className="text-xs text-fg-3">{card.note}</span>
                </a>
              </li>
            ))}
          </ul>
          <EntryChooser />
          <p className="text-sm text-fg-3">Everything runs in your browser. Your files are never uploaded.</p>
        </section>
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
            <a className={linkClass} href="/THIRD_PARTY_NOTICES.txt">
              THIRD_PARTY_NOTICES.txt
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
