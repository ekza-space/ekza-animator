// The Animate stage's words follow the shell's vocabulary rules (STUDIO-TOUCH-SPEC §1.3, ST-32; T7): *Animation* is
// only a clip, *Move* is only translation and never a clip, the selection meanings are the Thumb key's, and no DCC
// jargon sits at L0 or L1 (Pro's names come from the registry, one layer down). The shell's own lint
// (`rules.test.ts`) covers `i18n/en.ts`; this one covers `i18n/animate.ts` and `i18n/channels.ts` (P-T7-3).
import { describe, expect, it } from 'vitest';
import { animateWords } from '../src/i18n/animate';
import { CHANNEL_LABELS } from '../src/i18n/channels';

function strings(node: unknown, path: string[] = []): { readonly path: string; readonly text: string }[] {
  if (typeof node === 'string') return [{ path: path.join('.'), text: node }];
  if (typeof node === 'function') return [{ path: path.join('.'), text: String((node as (v: unknown) => unknown)(2)) }];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, [...path, String(i)]));
  if (typeof node === 'object' && node !== null)
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...path, k]));
  return [];
}

describe('the Animate stage’s vocabulary (§1.3)', () => {
  const all = strings(animateWords);

  it('“Animation” names a clip: only the row, + New, an animation’s verbs and the Library speak of animations', () => {
    for (const s of all.filter((x) => /\banimations?\b/i.test(x.text))) {
      expect(s.path).toMatch(/^(dock\.|clip\.|library\.|thread\.(clearRange|noClip)$)/);
    }
  });

  it('“Move” is translation, never a clip: no string pairs a move with an animation', () => {
    expect(all.filter((s) => /\bmoves?\b/i.test(s.text) && /animation|clip/i.test(s.text))).toEqual([]);
    // the Library's kind that walks and runs is not called "Moves"
    expect(animateWords.library.categories['move']).not.toMatch(/\bmoves?\b/i);
  });

  it('no DCC jargon at L0 or L1', () => {
    const jargon =
      /\b(extrude|tween|breakdown|ripple|euler|tangents?|IK|FK|influences?|bind pose|lambert|blinn|tris|keyframes?|dope sheet|graph editor)\b/i;
    expect(all.filter((s) => jargon.test(s.text)).map((s) => `${s.path}: ${s.text}`)).toEqual([]);
  });

  it('the selection meanings stay the Thumb key’s', () => {
    expect(all.filter((s) => /\bselect more\b|\bpick or unpick\b|\bunselect\b/i.test(s.text))).toEqual([]);
  });

  it('plain channel labels are names only; the Pro names are Pro’s Channels (§10.1)', () => {
    expect(CHANNEL_LABELS.rx).toEqual({ plain: 'Bend', pro: 'Rotate X', unit: '°' });
    expect(CHANNEL_LABELS.ry.plain).toBe('Twist');
    expect(CHANNEL_LABELS.rz).toEqual({ plain: 'Side', pro: 'Rotate Z', unit: '°' });
    expect(CHANNEL_LABELS.ty).toEqual({ plain: 'Move Y', pro: 'Translate Y', unit: 'm' });
  });
});
