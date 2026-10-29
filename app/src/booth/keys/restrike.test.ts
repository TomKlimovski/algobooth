import { describe, expect, it, vi } from 'vitest';
import { patternLines } from './lines';
import { changedLabels, CUT_FADE, cutVoices, isPitched, labelOf, planRestrike, Voices, type HapLike, type Voice } from './restrike';

const CODE = 'setcpm(30)\ndrums: s("bd*4")\nchords: chord("<Gm7 Cm7>").voicing()\n_bass: note("g1*8")';

/** A hap from `begin` to `end` (cycles) whose mini-notation starts at `at` in the code. */
function hap(begin: number, end: number, value: object = { note: 60 }, at?: number): HapLike {
  return {
    whole: { begin, end },
    value,
    context: at === undefined ? {} : { locations: [{ start: at, end: at + 1 }] },
    hasOnset: () => true,
  };
}

const param = () => ({ value: 0.6, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });

function voice(label: string, begin: number, end: number, cycles: number, pitched = true): Voice {
  return { label, begin, end, cycles, pitched, post: { gain: param() } };
}

/** One cycle a second from 0, so seconds and cycles read the same. */
const clock = { cps: 1, toSeconds: (c: number) => c };

describe('labelOf', () => {
  it('finds the line of a hap by its first mini-notation location', () => {
    const lines = patternLines(CODE);
    expect(labelOf(hap(0, 1, {}, CODE.indexOf('"bd*4"')), lines)).toBe('drums');
    expect(labelOf(hap(0, 1, {}, CODE.indexOf('"<Gm7'))!, lines)).toBe('chords');
    // muted lines keep their label without the underscore
    expect(labelOf(hap(0, 1, {}, CODE.indexOf('"g1*8"')), lines)).toBe('bass');
  });

  it('is null for a hap with no locations or outside every line', () => {
    const lines = patternLines(CODE);
    expect(labelOf(hap(0, 1), lines)).toBeNull();
    expect(labelOf(hap(0, 1, {}, 2), lines)).toBeNull(); // inside setcpm
  });
});

describe('changedLabels', () => {
  it('names a line whose text changed, one that was muted, and one that came or went', () => {
    const after = 'setcpm(30)\ndrums: s("bd*4").crush(6)\nchords: chord("<Gm7 Cm7>").voicing()\nbass: note("g1*8")\nhats: s("hh*8")';
    expect(changedLabels(CODE, after)).toEqual(new Set(['drums', 'bass', 'hats']));
    expect(changedLabels(after, CODE)).toEqual(new Set(['drums', 'bass', 'hats']));
  });

  it('is empty when only setup, comments or spacing changed', () => {
    expect(changedLabels(CODE, CODE.replace('setcpm(30)', 'setcpm(31)\n// note'))).toEqual(new Set());
  });
});

describe('isPitched', () => {
  it('is true for notes and frequencies, false for drum sounds', () => {
    expect(isPitched({ note: 'g1', s: 'sawtooth' })).toBe(true);
    expect(isPitched({ freq: 220 })).toBe(true);
    expect(isPitched({ s: 'bd', n: 3 })).toBe(false);
    expect(isPitched(null)).toBe(false);
  });
});

describe('planRestrike', () => {
  const labels = new Set(['chords']);

  it('cuts a ringing chord and strikes its new form at t0 for the rest of its length', () => {
    const old = voice('chords', 1, 2, 1);
    const fresh = hap(1, 2, { note: 'G3' });
    const plan = planRestrike({ labels, voices: [old], haps: [{ hap: fresh, label: 'chords' }], t0: 1.4, c0: 1.4, end: 1.55, ...clock });
    expect(plan.cut).toEqual([old]);
    expect(plan.play).toEqual([{ hap: fresh, t: 1.4, duration: expect.closeTo(0.6) }]);
  });

  it('takes back notes handed over in the old form and plays the new ones at their own times', () => {
    const pending = voice('chords', 1.5, 2, 0.5);
    const onset = hap(1.5, 2);
    const later = hap(1.6, 2); // past what Cyclist had queried: its next tick plays it
    const plan = planRestrike({
      labels,
      voices: [pending],
      haps: [{ hap: onset, label: 'chords' }, { hap: later, label: 'chords' }],
      t0: 1.45, c0: 1.45, end: 1.55, ...clock,
    });
    expect(plan.cut).toEqual([pending]);
    expect(plan.play).toEqual([{ hap: onset, t: 1.5, duration: 0.5 }]);
  });

  it('leaves a ringing drum hit, and a note nearly over, to finish', () => {
    const kick = voice('drums', 1, 1.25, 0.25, false);
    const ending = voice('drums', 1, 1.43, 0.43);
    const plan = planRestrike({
      labels: new Set(['drums']),
      voices: [kick, ending],
      haps: [{ hap: hap(1, 1.25, { s: 'bd' }), label: 'drums' }, { hap: hap(1, 1.43), label: 'drums' }],
      t0: 1.4, c0: 1.4, end: 1.55, ...clock,
    });
    expect(plan).toEqual({ cut: [], play: [] });
  });

  it('a mute only cuts; an unmute strikes the current chord', () => {
    const old = voice('chords', 1, 2, 1);
    expect(planRestrike({ labels, voices: [old], haps: [], t0: 1.4, c0: 1.4, end: 1.55, ...clock })).toEqual({ cut: [old], play: [] });
    const fresh = hap(1, 2);
    expect(planRestrike({ labels, voices: [], haps: [{ hap: fresh, label: 'chords' }], t0: 1.4, c0: 1.4, end: 1.55, ...clock }).play).toHaveLength(1);
  });

  it('touches nothing on a line that did not change, or with no label', () => {
    const drums = voice('drums', 1.5, 1.75, 0.25, false);
    const plan = planRestrike({
      labels,
      voices: [drums],
      haps: [{ hap: hap(1.5, 1.75), label: 'drums' }, { hap: hap(1.5, 2), label: null }],
      t0: 1.4, c0: 1.4, end: 1.55, ...clock,
    });
    expect(plan).toEqual({ cut: [], play: [] });
  });

  it('plays the heard length of a clipped note, and leaves one already silent alone', () => {
    const clipped = { ...hap(1.5, 2), duration: { valueOf: () => 0.25 } };
    const over = { ...hap(1, 2), duration: { valueOf: () => 0.25 } }; // a legato(0.25) chord, silent from 1.25
    const plan = planRestrike({
      labels, voices: [], haps: [{ hap: clipped, label: 'chords' }, { hap: over, label: 'chords' }],
      t0: 1.45, c0: 1.45, end: 1.55, ...clock,
    });
    expect(plan.play).toEqual([{ hap: clipped, t: 1.5, duration: 0.25 }]);
  });

  it('strikes nothing a trigger hook sends elsewhere', () => {
    const midi = { ...hap(1, 2), context: { onTrigger: () => {}, dominantTrigger: true } };
    expect(planRestrike({ labels, voices: [], haps: [{ hap: midi, label: 'chords' }], t0: 1.4, c0: 1.4, end: 1.55, ...clock }).play).toEqual([]);
  });

  it('converts cycles through the deck clock', () => {
    const fresh = hap(4.5, 5);
    const plan = planRestrike({
      labels, voices: [], haps: [{ hap: fresh, label: 'chords' }], t0: 10, c0: 4.4, end: 4.6, cps: 0.5,
      toSeconds: (c) => 10 + (c - 4.4) / 0.5,
    });
    expect(plan.play).toEqual([{ hap: fresh, t: expect.closeTo(10.2), duration: 1 }]);
  });
});

describe('cutVoices', () => {
  it('ramps each voice to silence from t0', () => {
    const v = voice('chords', 0, 2, 1);
    cutVoices([v], 1);
    expect(v.post.gain.cancelScheduledValues).toHaveBeenCalledWith(1);
    expect(v.post.gain.setValueAtTime).toHaveBeenCalledWith(0.6, 1);
    expect(v.post.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1 + CUT_FADE);
  });
});

describe('Voices', () => {
  it('drops ended and cut voices and lists the live ones', () => {
    const vs = new Voices();
    vs.add(voice('a', 0, 1, 1), 0);
    vs.add(voice('b', 0.5, 3, 1), 2);
    expect(vs.live(2).map((v) => v.label)).toEqual(['b']);
    const b = vs.live(2)[0];
    vs.remove([b]);
    expect(vs.live(2)).toEqual([]);
    vs.add(b, 2);
    vs.clear();
    expect(vs.live(0)).toEqual([]);
  });
});
