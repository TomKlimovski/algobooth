import { describe, expect, it } from 'vitest';
import { cueBlock, slugOf } from './cue';

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
