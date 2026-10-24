// The numpad's model (STUDIO-TOUCH-SPEC §5.6): digits, minus, decimal point and expressions (+ − × ÷ ( ) =),
// ±1 / ±10 nudges, backspace. It replaces typed numeric capture, the arrow-key nudges and the phone decimal keypad
// (which has no minus). Pure: no DOM, no `eval`.

/** Parses and evaluates `+ - * / ( )` with unary minus and decimals; `×`, `÷`, `−` and `,` are accepted too. */
export function evaluateExpression(text: string): number | null {
  const src = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
  if (src === '') return null;
  let i = 0;
  const peek = (): string => src[i] ?? '';

  const number = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (m === null) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = (): number | null => {
    const c = peek();
    if (c === '-' || c === '+') {
      i++;
      const v = factor();
      return v === null ? null : c === '-' ? -v : v;
    }
    if (c === '(') {
      i++;
      const v = sum();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const v = sum();
  if (v === null || i !== src.length || !Number.isFinite(v)) return null;
  return tidy(v);
}

/** Removes binary float noise (0.1 + 0.2 → 0.3). */
export function tidy(value: number): number {
  const v = Number(value.toPrecision(12));
  return Object.is(v, -0) ? 0 : v;
}

/** A number as the numpad writes it (plain decimal, ASCII minus so it can be edited). */
export function numpadText(value: number): string {
  return String(tidy(value));
}

export type NumpadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '.'
  | '+'
  | '−'
  | '×'
  | '÷'
  | '('
  | ')'
  | '±'
  | '='
  | '⌫'
  | 'clear'
  | '-10'
  | '-1'
  | '+1'
  | '+10';

export interface NumpadState {
  /** What the field shows (the expression being typed). */
  readonly text: string;
  /** True until the first key: a digit then replaces the value instead of appending to it. */
  readonly fresh: boolean;
}

export function numpadInit(value: number): NumpadState {
  return { text: numpadText(value), fresh: true };
}

const NUDGE: Partial<Record<NumpadKey, number>> = { '-10': -10, '-1': -1, '+1': 1, '+10': 10 };

/** The next state after a key. Operators and `)` keep the current text, so `0.4` then `× 2` gives `0.4×2`. */
export function numpadReduce(state: NumpadState, key: NumpadKey): NumpadState {
  const { text, fresh } = state;
  const nudge = NUDGE[key];
  if (nudge !== undefined) {
    const v = evaluateExpression(text) ?? 0;
    return { text: numpadText(v + nudge), fresh: false };
  }
  switch (key) {
    case '⌫':
      return { text: fresh ? '' : text.slice(0, -1), fresh: false };
    case 'clear':
      return { text: '', fresh: false };
    case '=': {
      const v = evaluateExpression(text);
      return v === null ? state : { text: numpadText(v), fresh: false };
    }
    case '±': {
      const v = evaluateExpression(text);
      if (v !== null && /^-?(\d+\.?\d*|\.\d+)$/.test(text)) return { text: numpadText(-v), fresh: false };
      if (text === '') return { text: '-', fresh: false };
      if (text === '-') return { text: '', fresh: false };
      return { text: text.startsWith('-(') && text.endsWith(')') ? text.slice(2, -1) : `-(${text})`, fresh: false };
    }
    case '.': {
      if (fresh) return { text: '0.', fresh: false };
      const tail = /[\d.]*$/.exec(text)?.[0] ?? '';
      if (tail.includes('.')) return state;
      return { text: `${text}${tail === '' ? '0' : ''}.`, fresh: false };
    }
    case '+':
    case '−':
    case '×':
    case '÷':
    case ')':
      return { text: `${text}${key}`, fresh: false };
    case '(':
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      // a digit or '(' replaces a fresh value
      return { text: fresh ? key : `${text}${key}`, fresh: false };
    case '-10':
    case '-1':
    case '+1':
    case '+10':
      return state;
  }
}

/** The key a hardware keyboard key means, or null. */
export function keyFromKeyboard(key: string): NumpadKey | null {
  if (/^[0-9]$/.test(key)) return key as NumpadKey;
  switch (key) {
    case '.':
    case ',':
      return '.';
    case '+':
      return '+';
    case '-':
      return '−';
    case '*':
      return '×';
    case '/':
      return '÷';
    case '(':
      return '(';
    case ')':
      return ')';
    case 'Backspace':
      return '⌫';
    case '=':
      return '=';
    default:
      return null;
  }
}
