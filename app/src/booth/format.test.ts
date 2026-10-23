import { describe, expect, it } from 'vitest';
import { formatChains } from './format';

describe('formatChains', () => {
  it('puts every top-level method of a chain on its own line, indented under the first call', () => {
    expect(formatChains('bass: note("g1*4").s("sawtooth").lpf(370)')).toBe(
      'bass: note("g1*4")\n  .s("sawtooth")\n  .lpf(370)',
    );
  });

  it('leaves setup lines, comments and blank lines alone', () => {
    const code = 'setcpm(129/4)\n\n// the kick\ndrums: s("bd*4").bank("tr909")\n';
    expect(formatChains(code)).toBe('setcpm(129/4)\n\n// the kick\ndrums: s("bd*4")\n  .bank("tr909")\n');
  });

  it('keeps a chain nested inside an argument on one line', () => {
    expect(formatChains('$: note("c2").s("sawtooth").lpf(sine.range(200,3000).slow(8))')).toBe(
      '$: note("c2")\n  .s("sawtooth")\n  .lpf(sine.range(200,3000).slow(8))',
    );
  });

  it('is idempotent and rejoins a chain already spread over lines', () => {
    const once = formatChains('hats: s("hh*8").bank("tr909")\n  .gain(0.4)\n    .room(0.2)');
    expect(once).toBe('hats: s("hh*8")\n  .bank("tr909")\n  .gain(0.4)\n  .room(0.2)');
    expect(formatChains(once)).toBe(once);
  });

  it('never splits inside strings, and ignores dots in numbers', () => {
    expect(formatChains('bass: note("g1 . g2").s(\'saw.tooth\').gain(.5).lpf(1.5e3)')).toBe(
      'bass: note("g1 . g2")\n  .s(\'saw.tooth\')\n  .gain(.5)\n  .lpf(1.5e3)',
    );
  });

  it('keeps a trailing comment on the line it ended', () => {
    expect(formatChains('bass: note("g1").s("sawtooth") // plucked\n  .lpf(370) // measured')).toBe(
      'bass: note("g1")\n  .s("sawtooth") // plucked\n  .lpf(370) // measured',
    );
  });

  it('leaves a line that runs into a template literal untouched', () => {
    const code = 'melody: note(`c3\ne3`).s("triangle").gain(0.5)';
    expect(formatChains(code)).toBe(code);
  });

  it('formats the body under a bare label, and a line with one call is unchanged', () => {
    expect(formatChains('bass:\n  note("g1").s("sawtooth")\nchords: chord("G")')).toBe(
      'bass:\n  note("g1")\n    .s("sawtooth")\nchords: chord("G")',
    );
  });

  it('indents under a chain that is itself indented', () => {
    expect(formatChains('  $: s("bd").bank("tr909")')).toBe('  $: s("bd")\n    .bank("tr909")');
  });
});
