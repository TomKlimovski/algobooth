import { describe, expect, it } from 'vitest';
import { lineAt, lineLabels, patternLines, refindTarget } from './lines';

// The service's golden output, loaded as text by vite (the app's tsconfig has no Node types).
const golden = import.meta.glob<string>('../../../../service/tests/golden/solomun.strudel', { query: '?raw', import: 'default', eager: true });

describe('patternLines', () => {
  it('numbers the Solomun golden labels and mute state, skipping setcpm and comments', () => {
    const code = Object.values(golden)[0];
    expect(code).toBeTruthy();
    const lines = patternLines(code);
    expect(lines.map((l) => l.label)).toEqual(['drums', 'claps', 'hats', 'fills', 'bass', 'bass2', 'chords', 'melody']);
    expect(lines.map((l) => l.muted)).toEqual([false, false, false, true, false, true, false, false]);
    expect(lines.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gives `$:` and unlabelled lines a null label', () => {
    const lines = patternLines('$: s("bd")\ns("hh")');
    expect(lines.map((l) => l.label)).toEqual([null, null]);
    expect(lines.map((l) => l.muted)).toEqual([false, false]);
  });

  it('spans a bare label and its chained body as one line', () => {
    const code = 'setcpm(30)\nbass:\n  note("a")\n  .lpf(800)\nnext: s("bd")';
    const [bass, next] = patternLines(code);
    expect(bass).toMatchObject({ label: 'bass', n: 1, firstLine: 1, lastLine: 3 });
    expect(code.slice(bass.from, bass.to)).toBe('bass:\n  note("a")\n  .lpf(800)');
    expect(next).toMatchObject({ label: 'next', n: 2, firstLine: 4 });
  });

  it('keeps a leading-dot continuation with the line above', () => {
    const lines = patternLines('a: s("bd")\n  .lpf(800)\nb: s("hh")');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ firstLine: 0, lastLine: 1 });
  });

  it('keeps a line ending in an operator, comma or open bracket open', () => {
    const lines = patternLines('a: stack(\n  s("bd"),\n  s("hh")\n)\nb: s("x") +\n  1');
    expect(lines.map((l) => [l.firstLine, l.lastLine])).toEqual([[0, 3], [4, 5]]);
  });

  it('holds a template literal across lines', () => {
    const code = 'a: note(`\nc d\ne f`)\nb: s("hh")';
    const lines = patternLines(code);
    expect(lines.map((l) => [l.firstLine, l.lastLine])).toEqual([[0, 2], [3, 3]]);
    expect(code.slice(lines[0].from, lines[0].to)).toBe('a: note(`\nc d\ne f`)');
  });

  it('marks a muted label and strips the underscore', () => {
    const [l] = patternLines('_fills: s("bd")');
    expect(l).toMatchObject({ label: 'fills', muted: true });
  });

  it('is empty for no code', () => {
    expect(patternLines('')).toEqual([]);
  });
});

describe('lineLabels', () => {
  it('lists labelled lines in order, without `$:`', () => {
    expect(lineLabels(patternLines('drums: s("bd")\n$: s("x")\ns("y")\n_b: s("z")'))).toEqual(['drums', 'b']);
  });
});

describe('refindTarget', () => {
  const three = patternLines('drums: s("a")\nhats: s("b")\nbass: s("c")');
  it('follows the label', () => {
    expect(refindTarget({ n: 3, label: 'hats' }, three)?.n).toBe(2);
  });
  it('falls back to the same n when the label is gone', () => {
    const renamed = patternLines('drums: s("a")\nhh: s("b")\nbass: s("c")');
    expect(refindTarget({ n: 2, label: 'hats' }, renamed)?.n).toBe(2);
  });
  it('clamps n after deletion', () => {
    const one = patternLines('drums: s("a")');
    expect(refindTarget({ n: 2, label: 'hats' }, one)?.n).toBe(1);
  });
  it('is null with no lines', () => {
    expect(refindTarget({ n: 1, label: null }, [])).toBeNull();
  });
  it('is null with no previous target', () => {
    expect(refindTarget(null, three)).toBeNull();
  });
});

describe('lineAt', () => {
  const code = 'setcpm(30)\na: s("bd")\n  .lpf(1)\nb: s("x")';
  const lines = patternLines(code);
  it('finds the line holding an offset, including continuations', () => {
    expect(lineAt(lines, code.indexOf('.lpf'))?.label).toBe('a');
    expect(lineAt(lines, code.indexOf('b:'))?.label).toBe('b');
  });
  it('is null on the setcpm line', () => {
    expect(lineAt(lines, 3)).toBeNull();
  });
});

describe('setup blocks and bare labels', () => {
  it('swallows a multi-line samples({...}) block: pattern lines start at drums', () => {
    const code = 'samples({\n  bd: "x.wav",\n})\ndrums: s("bd")\nhats: s("hh")';
    expect(patternLines(code).map((l) => [l.n, l.label, l.firstLine, l.lastLine])).toEqual([[1, 'drums', 3, 3], [2, 'hats', 4, 4]]);
  });

  it('swallows a multi-line const block', () => {
    const code = 'const x = stack(\n  s("bd"),\n  s("hh")\n)\ndrums: x\n_hats: s("hh")';
    expect(patternLines(code).map((l) => [l.n, l.label, l.firstLine])).toEqual([[1, 'drums', 4], [2, 'hats', 5]]);
  });

  it('a bare label followed by blank or comment lines, then another label, is a line with an empty body', () => {
    for (const code of ['_fills:\n\nbass: s("bd")', '_fills:\n// later\nbass: s("bd")']) {
      const lines = patternLines(code);
      expect(lines.map((l) => [l.label, l.muted, l.firstLine, l.lastLine])).toEqual([['fills', true, 0, 0], ['bass', false, 2, 2]]);
    }
  });
});
