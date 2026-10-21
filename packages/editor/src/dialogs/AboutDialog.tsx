// About (research 09 §4.1 Help; ADR 0009, ADR 0012): version, licence, sample credits and third-party notices.
import { Dialog, DialogContent, ExternalLink } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useShell } from '../shell/context';
import { EDITOR_VERSION, SAMPLES } from './samples';

export const THIRD_PARTY_NOTICES_URL = '/THIRD_PARTY_NOTICES.txt';

export function AboutDialog(): JSX.Element {
  const shell = useShell();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title="About Ekza Studio" width="md" data-testid="about-dialog">
        <div className="flex flex-col gap-4 text-ui text-fg-2">
          <p>
            Ekza Studio <span className="ekza-numeric text-fg">{EDITOR_VERSION}</span> — an open-source, browser-based
            3D studio for glTF and VRM characters (modeling, rigging, animation) with a Maya-grade workflow. Public
            alpha.
          </p>
          <p>
            The editor's code is MIT licensed by the Ekza Studio contributors; the AnimX curve port is Apache-2.0 (©
            Autodesk, Inc.). Fonts: Inter and JetBrains Mono (SIL Open Font License 1.1).
          </p>
          <section className="flex flex-col gap-1.5">
            <h3 className="font-semibold text-fg">Sample credits</h3>
            <ul className="flex flex-col gap-1" data-testid="about-credits">
              {SAMPLES.map((sample) => (
                <li key={sample.id}>
                  {sample.credit},{' '}
                  <a
                    className="text-accent-text underline-offset-4 hover:underline"
                    href={sample.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {sample.license}
                  </a>
                  .
                </li>
              ))}
            </ul>
          </section>
          <a
            className="inline-flex items-center gap-1.5 self-start text-accent-text underline-offset-4 hover:underline"
            href={THIRD_PARTY_NOTICES_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="about-notices"
          >
            Third-party notices
            <ExternalLink size={12} />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
