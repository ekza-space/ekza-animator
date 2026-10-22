// First-run dialog (research 09 §10.1; MVP-SPEC §1.4, §7 WP-8): navigation profile, Space behaviour and the
// "Getting started" card that says plainly what M1 is for. Closing it in any way marks the first run done.
// M6a (M6A-SPEC §8.8, research 16 §16.1; B13): "What do you want to do first?" — Animate an avatar or Model something
// new — sets the start workspace (`workspace.set`) and `prefs.lastWorkspace`.
// Auto-Rig (AUTORIG-SPEC §3.4, D2): a third answer, "Auto-rig a character (simple mode)": its button switches to
// `/autorig` through the host's navigation port (same page, the document kept) and remembers Auto-Rig for `/` only when
// "Open Auto-Rig next time" is ticked. Closing the dialog without the button keeps Studio (nothing switches).
import { hostNavigation } from '@ekza-studio/editor-core';
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, RadioGroup, RadioGroupItem } from '@ekza-studio/ui';
import { type JSX, useState } from 'react';
import { usePrefs } from '../hooks';
import { useShell } from '../shell/context';
import { writeEntryChoice } from './entryChoice';

type Nav = 'maya' | 'trackpad';
type Space = 'maya' | 'play';
type Start = 'animate' | 'model' | 'autorig';

const START_LABEL: Readonly<Record<Start, string>> = {
  animate: 'Start animating',
  model: 'Start modeling',
  autorig: 'Start Auto-Rig',
};

export function FirstRunDialog(): JSX.Element {
  const shell = useShell();
  const savedNav = usePrefs((p) => p.navProfile);
  const savedSpace = usePrefs((p) => p.spaceBehaviour);
  const [nav, setNav] = useState<Nav>(savedNav === 'trackpad' ? 'trackpad' : 'maya');
  const [space, setSpace] = useState<Space>(savedSpace);
  const savedStart = usePrefs((p) => p.lastWorkspace);
  const [start, setStart] = useState<Start>(savedStart === 'model' ? 'model' : 'animate');
  const [remember, setRemember] = useState(false);

  /** `go`: the primary button (the Auto-Rig answer switches only from it). */
  const finish = async (go: boolean): Promise<void> => {
    const workspace = start === 'autorig' ? null : start;
    await shell.runFromUi('prefs.set', {
      patch: {
        navProfile: nav,
        spaceBehaviour: space,
        firstRunDone: true,
        ...(workspace === null ? {} : { lastWorkspace: workspace }),
      },
    });
    if (workspace !== null && shell.app.session.getState().workspace !== workspace) {
      await shell.runFromUi('workspace.set', { workspace });
    }
    await shell.runFromUi('ui.close');
    if (workspace === null && go) {
      if (remember) writeEntryChoice('autorig');
      await hostNavigation(shell.app)?.go({ to: 'autorig', from: 'studio' });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void finish(false);
      }}
    >
      <DialogContent
        title="Welcome to Ekza Studio"
        description="Two choices, then load an avatar. Both can be changed later in Preferences."
        width="lg"
        data-testid="firstrun-dialog"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h3 className="text-ui font-semibold text-fg-2">What do you want to do first?</h3>
            <RadioGroup
              value={start}
              onValueChange={(value) => setStart(value === 'model' || value === 'autorig' ? value : 'animate')}
              aria-label="Start with"
            >
              <RadioGroupItem
                value="animate"
                label="Animate an avatar"
                hint="Load a VRM or glTF character and key its controls"
                data-testid="firstrun-start-animate"
              />
              <RadioGroupItem
                value="model"
                label="Model something new"
                hint="Low-poly props and characters from primitives or a template"
                data-testid="firstrun-start-model"
              />
              <RadioGroupItem
                value="autorig"
                label="Auto-rig a character (simple mode)"
                hint="Markers, a skinned skeleton, animations and a VRM in a few steps"
                data-testid="firstrun-start-autorig"
              />
            </RadioGroup>
            {start === 'autorig' ? (
              <Checkbox
                label="Open Auto-Rig next time"
                checked={remember}
                onChange={(event) => setRemember(event.currentTarget.checked)}
                data-testid="firstrun-remember-autorig"
              />
            ) : null}
            {start === 'model' && nav === 'trackpad' && shell.app.keymap.platform === 'mac' ? (
              <p className="text-ui-dense text-fg-3" data-testid="firstrun-mac-modes">
                Component modes: 1 · 2 · 3 (F-keys are media keys on this Mac)
              </p>
            ) : null}
            <h3 className="mt-2 text-ui font-semibold text-fg-2">How do you navigate?</h3>
            <RadioGroup
              value={nav}
              onValueChange={(value) => setNav(value === 'trackpad' ? 'trackpad' : 'maya')}
              aria-label="Navigation"
            >
              <RadioGroupItem
                value="maya"
                label="Mouse — Maya"
                hint="Alt + left drag tumble, Alt + middle drag track, Alt + right drag or wheel dolly"
                data-testid="firstrun-nav-maya"
              />
              <RadioGroupItem
                value="trackpad"
                label="Trackpad"
                hint="Two-finger scroll tumble, Shift + scroll track, pinch to dolly"
                data-testid="firstrun-nav-trackpad"
              />
            </RadioGroup>
            <h3 className="mt-2 text-ui font-semibold text-fg-2">What does Space do?</h3>
            <RadioGroup
              value={space}
              onValueChange={(value) => setSpace(value === 'play' ? 'play' : 'maya')}
              aria-label="Space key"
            >
              <RadioGroupItem
                value="maya"
                label="Maximize the panel under the pointer (Maya)"
                hint="Tap Space to maximize or restore; Alt+V plays"
                data-testid="firstrun-space-maya"
              />
              <RadioGroupItem
                value="play"
                label="Play and stop"
                hint="Like Blender and video editors"
                data-testid="firstrun-space-play"
              />
            </RadioGroup>
          </section>
          <section
            className="flex flex-col gap-2 rounded-dialog border border-line bg-field p-3 text-ui text-fg-2"
            data-testid="firstrun-getting-started"
            aria-label="Getting started"
          >
            <h3 className="text-ui font-semibold text-fg">Getting started</h3>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Drop a .vrm or .glb avatar on the window, or try a sample.</li>
              <li>Click a circle control, rotate with E, key with S.</li>
              <li>
                Shape the motion in the Graph Editor, then export: bake into the model, VRMA or animation-only GLB.
              </li>
            </ol>
            <h3 className="mt-1 text-ui font-semibold text-fg">What this alpha is for</h3>
            <p>
              Game clips: walk and run cycles, attacks, hits and emotes with planted feet, retimed in the Dope Sheet and
              polished with tweens and breakdowns. Facial expressions are not keyable yet.
            </p>
            <p>
              Legs are IK by default; arms are FK with IK one click away (Attributes › Limb or Rig › IK/FK). Moving the{' '}
              <span className="font-mono text-fg">cog</span> leaves IK feet where they are; for FK legs,{' '}
              <span className="text-fg">Pose › Plant Feet</span> still puts pinned feet back on each key.
            </p>
          </section>
        </div>
        <DialogFooter>
          <Button variant="primary" data-testid="firstrun-done" onClick={() => void finish(true)}>
            {START_LABEL[start]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
