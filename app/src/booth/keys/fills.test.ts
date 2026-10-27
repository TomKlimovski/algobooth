import { vi } from 'vitest';
import { FILLS, fillById, fillLine, fillOf, isDrumLine, withFill, withoutFill } from './fills';
import { expectShippedSounds } from '../../test/shippedSounds';

// Evaluating a pattern needs no audio, so webaudio is mocked as in library/examples.test.ts.
vi.mock('@strudel/webaudio', () => ({}));

const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');
const tonal = await import('@strudel/tonal/dist/index.mjs');
const { transpiler } = await import('@strudel/transpiler/dist/index.mjs');
await core.evalScope(core, mini, tonal);

const DECK = [
  'setcpm(129/4)',
  'drums: s("bd*4").bank("tr909").gain(0.65)',
  'claps: s("~ cp ~ cp").bank("tr909")',
  '_fills: s("~ ~ ~ [sd sd]").bank("tr909")',
  'bass: note("g1*8").s("sawtooth")',
].join('\n');

const snare = fillById('snare_roll')!;
const drop = fillById('drop')!;

describe('isDrumLine', () => {
  it('reads drum names out of the sound string', () => {
    expect(isDrumLine('drums: s("bd:3*4").bank("tr909")')).toBe(true);
    expect(isDrumLine("hats: sound('[~ oh:1]*4')")).toBe(true);
    expect(isDrumLine('bass: note("g1").s("sawtooth")')).toBe(false);
    expect(isDrumLine('chords: chord("<Gm Eb>").voicing().s("piano")')).toBe(false);
  });
});

describe('withFill and withoutFill', () => {
  it('injects at the end and comes back out to the same text', () => {
    const on = withFill(DECK, snare, 'inject', 8);
    expect(on).toBe(`${DECK}\n// fill: Snare roll · 2 bars · inject · goes out on its own\nfill: ${snare.code}`);
    expect(withoutFill(on)).toBe(DECK);
  });

  it('keeps a trailing newline the way it was', () => {
    const on = withFill(DECK + '\n', snare, 'inject', 0);
    expect(on.endsWith(`fill: ${snare.code}\n`)).toBe(true);
    expect(withoutFill(on)).toBe(DECK + '\n');
  });

  it('a switch mutes the playing drum lines and names them, and brings them back', () => {
    const on = withFill(DECK, drop, 'switch', 3);
    expect(on).toContain('\n_drums: s("bd*4")');
    expect(on).toContain('\n_claps: s("~ cp ~ cp")');
    expect(on).toContain('\nbass: note('); // not a drum line
    expect(on).toContain('\n_fills: '); // already muted, left alone
    expect(fillOf(on)!.muted).toEqual(['drums', 'claps']);
    expect(withoutFill(on)).toBe(DECK);
  });

  it('a line the user unmuted by hand during a switch stays unmuted', () => {
    const on = withFill(DECK, drop, 'switch', 0).replace('_claps:', 'claps:');
    expect(withoutFill(on)).toBe(DECK);
  });

  it('a second fill replaces the first, restoring what it muted', () => {
    const on = withFill(withFill(DECK, drop, 'switch', 0), snare, 'inject', 1);
    expect(on).toContain('\ndrums: ');
    expect(on.match(/\/\/ fill: /g)).toHaveLength(1);
    expect(withoutFill(on)).toBe(DECK);
  });

  it('leaves code with no fill alone', () => {
    expect(withoutFill(DECK)).toBe(DECK);
    expect(fillOf(DECK)).toBeNull();
  });
});

describe('fillLine', () => {
  it('aligns a fill longer than a bar to the bar it lands on', () => {
    expect(fillLine(snare, 8)).toBe(`fill: ${snare.code}`);
    expect(fillLine(snare, 9)).toBe(`fill: ${snare.code}.late(1)`);
    expect(fillLine(fillById('long_roll')!, 7)).toMatch(/\.late\(3\)$/);
    expect(fillLine(drop, 5)).toBe('fill: silence');
  });

  it('plays a two-bar fill from its first bar on an odd landing', async () => {
    const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
    const pat = (await r.evaluate(fillLine(snare, 9), false)) ?? r.scheduler.pattern;
    const count = (bar: number) => pat.queryArc(bar, bar + 1).filter((h: { whole?: unknown }) => h.whole).length;
    expect(count(9)).toBe(8);
    expect(count(10)).toBe(24); // 16ths then 32nds
  });
});

test.each(FILLS.filter((f) => f.code !== 'silence').map((f) => [f.id, f] as const))(
  '%s evaluates, sounds in each of its bars and plays shipped sounds',
  async (_id, fill) => {
    const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
    const pat = (await r.evaluate(fillLine(fill, 0), false)) ?? r.scheduler.pattern;
    for (let bar = 0; bar < fill.bars; bar++) {
      const haps = pat.queryArc(bar, bar + 1).filter((h: { whole?: unknown }) => h.whole);
      expect(haps.length, `bar ${bar + 1}`).toBeGreaterThan(0);
      expectShippedSounds(haps, fill.id);
    }
  },
);
