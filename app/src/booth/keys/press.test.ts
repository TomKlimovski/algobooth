import { describe, expect, it } from 'vitest';
import type { Binding } from './bindings';
import { patternLines } from './lines';
import { REFUSED_ARG, REFUSED_LINE, applyEdits, flipMute, isOn, nudge, toggle } from './press';

const golden = import.meta.glob<string>('../../../../service/tests/golden/solomun.strudel', { query: '?raw', import: 'default', eager: true });
const SOLOMUN = Object.values(golden)[0];

const method = (name: string, snippet: string, argRange: [number, number] | null): Binding => ({ kind: 'method', name, snippet, argRange });
const lpenv = method('lpenv', '.lpenv(2)', [7, 8]);
const lpf = method('lpf', '.lpf(800)', [5, 8]);
const find = (code: string, label: string) => patternLines(code).find((l) => l.label === label)!;
const run = (code: string, label: string, f: (l: ReturnType<typeof find>) => ReturnType<typeof toggle>) => {
  const o = f(find(code, label));
  if (!o.ok) return o;
  return { ...o, code: applyEdits(code, o.edits) };
};

describe('toggle', () => {
  it('adds the method after the last call on bass', () => {
    const r = run(SOLOMUN, 'bass', (l) => toggle(SOLOMUN, l, lpenv)) as { ok: true; on: boolean; code: string };
    expect(r.on).toBe(true);
    expect(r.code).toContain('.gain(0.55).orbit(2).lpenv(2)\n');
    expect(r.code.replace('.lpenv(2)', '')).toBe(SOLOMUN);
  });

  it('removes it again, whatever its argument became', () => {
    for (const arg of ['2', '0.75, 3', 'sine.range(1,4)']) {
      const code = SOLOMUN.replace('.orbit(2)\n', `.orbit(2).lpenv(${arg})\n`);
      const r = run(code, 'bass', (l) => toggle(code, l, lpenv)) as { ok: true; on: boolean; code: string };
      expect(r.on).toBe(false);
      expect(r.code).toBe(SOLOMUN);
    }
  });

  it('ignores a name inside a string or comment', () => {
    const code = 'a: s("x.lpenv(2)").lpf(1) // .lpenv(3)';
    const l = find(code, 'a');
    expect(isOn(code, l, lpenv)).toBe(false);
    const r = toggle(code, l, lpenv);
    expect(r.ok && applyEdits(code, r.edits)).toBe('a: s("x.lpenv(2)").lpf(1).lpenv(2) // .lpenv(3)');
  });

  it('refuses a line that cannot take a method', () => {
    for (const code of ['a: x =>', 'a: stack(']) {
      expect(toggle(code, find(code, 'a'), lpenv)).toEqual({ ok: false, reason: REFUSED_LINE });
    }
  });

  it('refuses removal of an unbalanced call', () => {
    const code = 'a: s("x").lpenv(2';
    expect(toggle(code, find(code, 'a'), lpenv)).toEqual({ ok: false, reason: REFUSED_LINE });
  });

  it('lands on the last physical line of a multi-line pattern line', () => {
    const code = 'bass:\n  note("a")\n  .lpf(800)\nnext: s("bd")';
    const r = run(code, 'bass', (l) => toggle(code, l, lpenv)) as { ok: true; code: string };
    expect(r.code).toBe('bass:\n  note("a")\n  .lpf(800).lpenv(2)\nnext: s("bd")');
  });

  it('writes and removes a macro as a whole', () => {
    const macro: Binding = {
      kind: 'macro',
      parts: [
        { name: 'lpf', snippet: '.lpf(300)', argRange: [5, 8] },
        { name: 'room', snippet: '.room(0.8)', argRange: [6, 9] },
      ],
    };
    const code = 'a: s("x")';
    const l = find(code, 'a');
    const on = toggle(code, l, macro);
    expect(on.ok && applyEdits(code, on.edits)).toBe('a: s("x").lpf(300).room(0.8)');
    const half = 'a: s("x").lpf(300)';
    expect(isOn(half, find(half, 'a'), macro)).toBe(false);
    const full = 'a: s("x").lpf(300).room(0.8)';
    const off = toggle(full, find(full, 'a'), macro);
    expect(off.ok && off.on).toBe(false);
    expect(off.ok && off.edits).toHaveLength(2);
    expect(off.ok && applyEdits(full, off.edits)).toBe('a: s("x")');
  });
});

describe('nudge', () => {
  it('doubles and halves', () => {
    const up = 'a: s("x").lpenv(2)';
    const r = nudge(up, find(up, 'a'), lpenv, 'up');
    expect(r.ok && applyEdits(up, r.edits)).toBe('a: s("x").lpenv(4)');
    const dn = 'a: s("x").lpf(800)';
    const d = nudge(dn, find(dn, 'a'), lpf, 'down');
    expect(d.ok && applyEdits(dn, d.edits)).toBe('a: s("x").lpf(400)');
    const s = nudge(dn, find(dn, 'a'), lpf, 'down');
    expect(s.ok && s.on).toBe(true);
  });

  it('floors at 0.001 and rounds to 3 figures', () => {
    const f = 'a: s("x").lpf(0.001)';
    const d = nudge(f, find(f, 'a'), lpf, 'down');
    expect(d.ok && applyEdits(f, d.edits)).toBe(f);
    const t = 'a: s("x").lpf(0.3)';
    const u = nudge(t, find(t, 'a'), lpf, 'up');
    expect(u.ok && applyEdits(t, u.edits)).toBe('a: s("x").lpf(0.6)');
    const r = 'a: s("x").lpf(333)';
    const rr = nudge(r, find(r, 'a'), lpf, 'up');
    expect(rr.ok && applyEdits(r, rr.edits)).toBe('a: s("x").lpf(666)');
    const q = 'a: s("x").lpf(1.23)';
    const qq = nudge(q, find(q, 'a'), lpf, 'down');
    expect(qq.ok && applyEdits(q, qq.edits)).toBe('a: s("x").lpf(0.615)');
  });

  it('refuses a non-literal argument or an absent method', () => {
    const c = 'a: s("x").lpf(1/3)';
    expect(nudge(c, find(c, 'a'), lpf, 'up')).toEqual({ ok: false, reason: REFUSED_ARG });
    const s = 'a: s("x").lpf(sine)';
    expect(nudge(s, find(s, 'a'), lpf, 'up')).toEqual({ ok: false, reason: REFUSED_ARG });
    const n = 'a: s("x")';
    expect(nudge(n, find(n, 'a'), lpf, 'up')).toEqual({ ok: false, reason: REFUSED_ARG });
  });

  it('nudges the first argument only', () => {
    const c = 'a: s("x").lpenv(0.75, 3)';
    const r = nudge(c, find(c, 'a'), lpenv, 'up');
    expect(r.ok && applyEdits(c, r.edits)).toBe('a: s("x").lpenv(1.5, 3)');
  });
});

describe('flipMute', () => {
  it('unmutes and mutes', () => {
    const l = find(SOLOMUN, 'fills');
    const r = flipMute(SOLOMUN, l);
    expect(r.ok && r.on).toBe(true);
    expect(r.ok && applyEdits(SOLOMUN, r.edits)).toContain('\nfills:');
    const d = find(SOLOMUN, 'drums');
    const m = flipMute(SOLOMUN, d);
    expect(m.ok && m.on).toBe(false);
    expect(m.ok && applyEdits(SOLOMUN, m.edits)).toContain('\n_drums:');
  });

  it('refuses `$:` and unlabelled lines', () => {
    const code = '$: s("bd")\ns("hh")';
    for (const l of patternLines(code)) expect(flipMute(code, l)).toEqual({ ok: false, reason: REFUSED_LINE });
  });

  it('a line binding toggles the mute and isOn is "playing"', () => {
    const b: Binding = { kind: 'line', label: 'fills' };
    const l = find(SOLOMUN, 'fills');
    expect(isOn(SOLOMUN, l, b)).toBe(false);
    expect(toggle(SOLOMUN, l, b)).toEqual(flipMute(SOLOMUN, l));
  });
});

describe('applyEdits', () => {
  it('applies several edits from the end', () => {
    expect(applyEdits('abcdef', [{ from: 0, to: 1, insert: 'XX' }, { from: 4, to: 6, insert: '' }])).toBe('XXbcd');
  });
});

describe('review fixes', () => {
  it('refuses a bare label with no body rather than editing the next pattern line', () => {
    for (const code of ['_fills:\nsamples("x")\nbass: s("bd")', '_fills:\n\nbass: s("bd")']) {
      expect(toggle(code, find(code, 'fills'), lpenv)).toEqual({ ok: false, reason: REFUSED_LINE });
    }
  });

  it('a macro part nested in an earlier part\'s argument does not count, and no overlapping edits come out', () => {
    const macro: Binding = { kind: 'macro', parts: [{ name: 'lpf', snippet: '.lpf(800)', argRange: [5, 8] }, { name: 'room', snippet: '.room(1)', argRange: [6, 7] }] };
    const code = 'a: s("bd").lpf(x.room(1))';
    const line = find(code, 'a');
    expect(isOn(code, line, macro)).toBe(false);
    const o = toggle(code, line, macro);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const sorted = [...o.edits].sort((p, q) => p.from - q.from);
    sorted.slice(1).forEach((e, i) => expect(e.from).toBeGreaterThanOrEqual(sorted[i].to));
    expect(applyEdits(code, o.edits)).toBe('a: s("bd").lpf(x.room(1)).lpf(800).room(1)');
  });
});
