// MCP-SPEC §5.3 (D0): the one sanitiser — controls and format characters out (bidi, zero-width, BOM, the tag block),
// whitespace collapsed, NFC last, names capped at 120 and prose at 300 characters with an ellipsis; `sanitizeDeep`
// refuses cycles and over-deep values; labels with intents.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  composeLabel,
  isClean,
  NAME_MAX_CHARS,
  NEST_MAX_DEPTH,
  PROSE_MAX_CHARS,
  quoteName,
  sanitizeDeep,
  sanitizeText,
  toWellFormed,
} from '../src';

const name = (text: string) => sanitizeText(text, { maxChars: NAME_MAX_CHARS, kind: 'name' });

describe('sanitizeText (MCP-SPEC §5.3)', () => {
  it('removes bidi controls, zero-width characters, the BOM and the tag block', () => {
    expect(name('a‪b‮c⁦d⁩e')).toBe('abcde');
    expect(name('a​b‌c‍d‎e‏f⁠g﻿h')).toBe('abcdefgh');
    expect(name('x\u{E0000}\u{E0001}\u{E0041}\u{E0049}\u{E007F}y')).toBe('xy');
    expect(name('bell\u0007 nul\u0000 del\u007F c1\u0085end')).toBe('bell nul del c1 end');
  });

  it('normalises to NFC and collapses whitespace', () => {
    expect(name('é')).toBe('é');
    expect(name('  a \t\n b\r\n  c  ')).toBe('a b c');
  });

  it('normalises after removing format characters, so a letter and its combining mark compose', () => {
    expect(name('e\u200D\u0301')).toBe('\u00e9');
    expect(name('A\u2060\u030A ring')).toBe('\u00c5 ring');
    expect(name('\u1100\u200B\u1161')).toBe('\uAC00');
  });

  it('caps names at 120 and prose at 300 characters, with an ellipsis', () => {
    const long = 'x'.repeat(1_000);
    expect(name(long)).toHaveLength(NAME_MAX_CHARS);
    expect(name(long).endsWith('…')).toBe(true);
    expect(sanitizeText(long, { maxChars: 10_000, kind: 'prose' })).toHaveLength(PROSE_MAX_CHARS);
    expect(sanitizeText(long, { maxChars: 40, kind: 'prose' })).toHaveLength(40);
    expect(name('short')).toBe('short');
  });

  it('replaces lone surrogates with U+FFFD and keeps surrogate pairs', () => {
    expect(name('a\ud800b')).toBe('a\ufffdb');
    expect(name('a\udc00b')).toBe('a\ufffdb');
    expect(name('end\udbff')).toBe('end\ufffd');
    expect(name('\udc00\ud800')).toBe('\ufffd\ufffd');
    expect(name('pair 😀 ok')).toBe('pair 😀 ok');
    expect(toWellFormed('x\ud83d\ude00\ud83dy')).toBe('x😀\ufffdy');
  });

  it('never leaves a control or format character or a lone surrogate, whatever the input', () => {
    expect(() =>
      fc.assert(
        fc.property(
          fc.string({ unit: 'binary', maxLength: 400 }),
          fc.string({ unit: 'grapheme', maxLength: 40 }),
          (text, extra) => {
            // `binary` units are whole code points; cut one in half too (a lone surrogate)
            const input = `${text}${'😀'.slice(0, 1)}${extra}`;
            const out = sanitizeText(input, { maxChars: 300, kind: 'prose' });
            return (
              isClean(out) && Array.from(out).length <= 300 && out === toWellFormed(out) && out === out.normalize('NFC')
            );
          },
        ),
        { numRuns: 500 },
      ),
    ).not.toThrow();
  });

  it('quotes document strings for prose (≤ 40 characters) and sanitises deep values', () => {
    expect(quoteName(`walk‮${'y'.repeat(60)}`)).toBe(`"walk${'y'.repeat(35)}…"`);
    expect(sanitizeDeep({ 'k​': ['a‮b', 3, null, new Uint8Array(4)] }, { maxChars: 300, kind: 'prose' })).toEqual({
      k: ['ab', 3, null, 4],
    });
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<string, unknown>;
    const clean = sanitizeDeep(hostile, { maxChars: 300, kind: 'prose' }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
    expect(Object.hasOwn(clean, '__proto__')).toBe(true);
    expect(JSON.stringify(clean)).toBe('{"__proto__":{"polluted":true},"ok":1}');
  });

  it('refuses cyclic and too deeply nested values with a RangeError, and keeps shared values', () => {
    const opts = { maxChars: 300, kind: 'prose' } as const;
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => sanitizeDeep(cyclic, opts)).toThrow(RangeError);
    const list: unknown[] = [];
    list.push(list);
    expect(() => sanitizeDeep({ list }, opts)).toThrow(RangeError);
    let deep: unknown = 'leaf';
    for (let i = 0; i < NEST_MAX_DEPTH + 1; i++) deep = [deep];
    expect(() => sanitizeDeep(deep, opts)).toThrow(RangeError);
    let fits: unknown = 'leaf';
    for (let i = 0; i < NEST_MAX_DEPTH; i++) fits = [fits];
    expect(() => sanitizeDeep(fits, opts)).not.toThrow();
    const shared = { name: 'x\u202E' };
    expect(sanitizeDeep({ a: shared, b: [shared, shared] }, opts)).toEqual({
      a: { name: 'x' },
      b: [{ name: 'x' }, { name: 'x' }],
    });
  });
});

describe('labels with intents (MCP-SPEC §5.6)', () => {
  it('puts the intent before the tool label and keeps AI: + label within 80 characters', () => {
    expect(composeLabel('Set pose (3 controls) @ f12', null)).toBe('Set pose (3 controls) @ f12');
    expect(composeLabel('Set pose (3 controls) @ f12', 'Slow walk 1.5×')).toBe(
      'Slow walk 1.5× · Set pose (3 controls) @ f12',
    );
    const label = composeLabel(
      'Set keys (14 on 6 curves)',
      'make the whole arm swing a lot wider and later than before please',
    );
    expect(`AI: ${label}`.length).toBeLessThanOrEqual(80);
    expect(label.endsWith(' · Set keys (14 on 6 curves)')).toBe(true);
    expect(label.startsWith('make the whole arm swing')).toBe(true);
  });
});
