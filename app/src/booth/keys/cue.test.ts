import { describe, expect, it } from 'vitest';
import { clearCode, cueBlock, cueOf, cuedLabel, cueSounding, goCode, slugOf } from './cue';

describe('slugOf', () => {
  it('lower-cases and joins words with underscores', () => expect(slugOf('Acid line')).toBe('acid_line'));
  it('cuts at the first word boundary at or after 12 characters', () =>
    expect(slugOf('Solomun – Live at Alexandra Palace, London (2026) (Official Film) 36:40')).toBe('solomun_live'));
  it('keeps a hyphenated name whole when the 12th character lands inside its last word', () =>
    expect(slugOf('Acid-switch-angel')).toBe('acid_switch_angel'));
  it('keeps a long first word', () => expect(slugOf('Supercalifragilistic bass')).toBe('supercalifragilistic'));
  it('prefixes a slug that starts with a digit', () => expect(slugOf('909 kick')).toBe('p_909_kick'));
  it('falls back to cued for a name with no word characters', () => expect(slugOf('🎛 · …')).toBe('cued'));
});

const ACID = { name: 'Acid line', cpm: 126, code: 'setcpm(126/4)\n\n$: note("c2(5,8)").s("sawtooth").lpf(300)' };
const SOLOMUN = {
  name: 'Solomun – Live at Alexandra Palace, London (2026) (Official Film) 36:40',
  cpm: 129,
  code: '// Solomun 36:40 · 129 cpm\nsetcpm(129/4)\n\ndrums: s("bd*4").bank("tr909")\n// bars 1–9 add these hits\n_fills: s("<bd ~>")\nbass: note("g1")\n  .s("sawtooth")',
};
const MARKER_ACID = '// cued: Acid line · 126 cpm · its lines are on the home row · Go finishes, Clear drops';

describe('cueBlock', () => {
  it('writes the marker and one bare-slug line for a one-line $: pattern, dropping setcpm and blanks', () => {
    expect(cueBlock(ACID)).toBe(`${MARKER_ACID}\n_acid_line: note("c2(5,8)").s("sawtooth").lpf(300)`);
  });
  it('prefixes labelled lines, keeps muted ones muted once, keeps comments and continuations, drops setcpm', () => {
    expect(cueBlock(SOLOMUN)).toBe(
      [
        '// cued: Solomun – Live at Alexandra Palace, London (2026) (Official Film) 36:40 · 129 cpm · its lines are on the home row · Go finishes, Clear drops',
        '// Solomun 36:40 · 129 cpm',
        '_solomun_live_drums: s("bd*4").bank("tr909")',
        '// bars 1–9 add these hits',
        '_solomun_live_fills: s("<bd ~>")',
        '_solomun_live_bass: note("g1")',
        '  .s("sawtooth")',
      ].join('\n'),
    );
  });
  it('numbers several unlabelled lines in order and keeps a const line in place', () => {
    const p = { name: 'Two', cpm: 120, code: 'const k = 1\n$: s("bd")\ns("hh")' };
    expect(cueBlock(p)).toBe('// cued: Two · 120 cpm · its lines are on the home row · Go finishes, Clear drops\nconst k = 1\n_two_1: s("bd")\n_two_2: s("hh")');
  });
  it('drops an old marker from a pattern saved mid-mix and prefixes its cued lines again', () => {
    const p = { name: 'Mix', cpm: 120, code: `bass: note("g1")\n${MARKER_ACID}\n_acid_line: note("c2")` };
    expect(cueBlock(p)).toBe('// cued: Mix · 120 cpm · its lines are on the home row · Go finishes, Clear drops\n_mix_bass: note("g1")\n_mix_acid_line: note("c2")');
  });
});

describe('cueOf', () => {
  const SOLO = 'setcpm(129/4)\ndrums: s("bd*4")\nbass: note("g1")';
  it('is null without a marker', () => expect(cueOf(SOLO)).toBeNull());
  it('reads the name, cpm and slug back and lists the cued lines after the marker', () => {
    const code = `${SOLO}\n\n${cueBlock(ACID)}`;
    const cue = cueOf(code)!;
    expect(cue.name).toBe('Acid line');
    expect(cue.cpm).toBe(126);
    expect(cue.slug).toBe('acid_line');
    expect(cue.markerLine).toBe(4);
    expect(code.slice(cue.markerFrom, cue.markerTo)).toBe(MARKER_ACID);
    expect(cue.lines.map((l) => l.label)).toEqual(['acid_line']);
  });
  it('reads a name that itself contains the separator', () => {
    const cue = cueOf(cueBlock({ name: 'A · B', cpm: 120, code: '$: s("bd")' }))!;
    expect(cue.name).toBe('A · B');
    expect(cue.cpm).toBe(120);
    expect(cue.lines.map((l) => l.label)).toEqual(['a_b']);
  });
  it('keeps a hand-typed line with the prefix and ignores one without', () => {
    const code = `${SOLO}\n${cueBlock(ACID)}\n_acid_line_pad: s("pad")\nextra: s("x")`;
    expect(cueOf(code)!.lines.map((l) => l.label)).toEqual(['acid_line', 'acid_line_pad']);
  });
  it('still has a cue when the marker is alone', () => {
    const cue = cueOf(`${SOLO}\n${MARKER_ACID}`)!;
    expect(cue.lines).toEqual([]);
  });
  it('takes the first marker when there are two', () => {
    const code = `${cueBlock(ACID)}\n${cueBlock({ name: 'Two', cpm: 120, code: '$: s("bd")' })}`;
    expect(cueOf(code)!.name).toBe('Acid line');
  });
  it('reads a hand-edited marker as a name with no cpm', () => {
    const cue = cueOf('// cued: Acid line')!;
    expect(cue.name).toBe('Acid line');
    expect(cue.cpm).toBeNull();
    expect(cue.slug).toBe('acid_line');
  });
});

describe('cuedLabel', () => {
  it('is the label without the slug prefix, or the bare slug', () => {
    const code = `${cueBlock(SOLOMUN)}\n_solomun_live: s("x")`;
    const cue = cueOf(code)!;
    expect(cue.lines.map((l) => cuedLabel(cue, l))).toEqual(['drums', 'fills', 'bass', 'solomun_live']);
  });
});

describe('goCode', () => {
  const OWN = '// Solomun 36:40\nsetcpm(129/4)\n\ndrums: s("bd*4")\n// bars 1–9 add these hits\n_fills: s("<bd ~>")\nbass: note("g1")\n  .s("sawtooth")';
  it('removes the own lines with their attached comments, keeps setcpm, strips prefixes keeping mute state', () => {
    const code = `${OWN}\n\n${cueBlock(SOLOMUN)}`.replace('_solomun_live_drums:', 'solomun_live_drums:');
    const out = goCode(code, cueOf(code)!);
    // The own comment above setcpm stays (setcpm is a setup line, not a pattern line); the cued block's own comment stays with its line.
    expect(out).toBe('// Solomun 36:40\nsetcpm(129/4)\n\n// Solomun 36:40 · 129 cpm\ndrums: s("bd*4").bank("tr909")\n// bars 1–9 add these hits\n_fills: s("<bd ~>")\n_bass: note("g1")\n  .s("sawtooth")');
  });
  it('turns a switched-on bare-slug line into $: and keeps a muted one as it is', () => {
    const on = `setcpm(129/4)\nbass: note("g1")\n\n${cueBlock(ACID)}`.replace('_acid_line:', 'acid_line:');
    expect(goCode(on, cueOf(on)!)).toBe('setcpm(129/4)\n\n$: note("c2(5,8)").s("sawtooth").lpf(300)');
    const off = `setcpm(129/4)\nbass: note("g1")\n\n${cueBlock(ACID)}`;
    expect(goCode(off, cueOf(off)!)).toBe('setcpm(129/4)\n\n_acid_line: note("c2(5,8)").s("sawtooth").lpf(300)');
  });
  it('turns a switched-on numbered line into $: and keeps a muted one', () => {
    const block = cueBlock({ name: 'Two', cpm: 120, code: '$: s("bd")\n$: s("hh")' }).replace('_two_1:', 'two_1:');
    const code = `drums: s("x")\n${block}`;
    expect(goCode(code, cueOf(code)!)).toBe('$: s("bd")\n_two_2: s("hh")');
  });
  it('keeps an own comment that has a blank line before the pattern line it would be attached to', () => {
    const code = `// a note\n\ndrums: s("x")\n${cueBlock(ACID)}`;
    expect(goCode(code, cueOf(code)!)).toBe('// a note\n\n_acid_line: note("c2(5,8)").s("sawtooth").lpf(300)');
  });
});

describe('clearCode', () => {
  it('removes the marker, the cued lines and the comments that came with them, leaving the own code as it was', () => {
    const own = 'setcpm(129/4)\n\ndrums: s("bd*4")\nbass: note("g1")';
    const code = `${own}\n\n${cueBlock(SOLOMUN)}`;
    expect(clearCode(code, cueOf(code)!)).toBe(own);
  });
  it('removes a marker that stands alone', () => {
    const own = 'drums: s("bd*4")';
    expect(clearCode(`${own}\n\n${MARKER_ACID}`, cueOf(`${own}\n\n${MARKER_ACID}`)!)).toBe(own);
  });
});

describe('cueSounding', () => {
  it('is true once any cued line is unmuted', () => {
    const off = cueBlock(ACID);
    expect(cueSounding(cueOf(off)!)).toBe(false);
    const on = off.replace('_acid_line:', 'acid_line:');
    expect(cueSounding(cueOf(on)!)).toBe(true);
  });
});
